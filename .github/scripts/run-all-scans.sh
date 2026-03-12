#!/bin/bash
# =============================================================================
# run-all-scans.sh — Runs entirely on your GCP VM
#
# CRITICAL FIXES in this version:
#   1. server.js calls process.exit(1) on DB failure → we must pass MONGODB_URI
#   2. server.js calls initializeNotificationServices() which tries Firebase
#      and Email — both wrapped in try/catch so they degrade gracefully ✓
#   3. server.js has unhandledRejection handler that exits → we set
#      NODE_ENV=test so auth limiter is relaxed and no strict mode crashes
#   4. No-IP DNS: SonarQube/DefectDojo URLs go through No-IP hostname
#      → retry logic added for DNS flaps
#   5. ZAP health check hits /health endpoint (not /) which always returns 200
# =============================================================================

set -euo pipefail

# ── Paths ─────────────────────────────────────────────────────────────────────
WORKSPACE="${HOME}/security-scan"
APP_DIR="${WORKSPACE}/app/backend"
REPORTS_DIR="${WORKSPACE}/reports"
LOG_FILE="${REPORTS_DIR}/scan.log"

# ── Ports ─────────────────────────────────────────────────────────────────────
APP_PORT=3000
MONGO_PORT=27017
REDIS_PORT=6379

# ── State tracking ────────────────────────────────────────────────────────────
APP_PID=""
SONAR_RESULT="skipped"
DEPCHECK_RESULT="skipped"
ZAP_RESULT="skipped"
IMPORT_COUNT=0
FINAL_FORMAT="none"

# ── Logging: tee to file AND stdout so GitHub Actions sees it live ─────────────
mkdir -p "${REPORTS_DIR}"
exec > >(tee -a "${LOG_FILE}") 2>&1

log()  { echo "[$(date '+%H:%M:%S')] $*"; }
ok()   { echo "[$(date '+%H:%M:%S')] ✓ $*"; }
warn() { echo "[$(date '+%H:%M:%S')] ⚠ WARNING: $*"; }
fail() { echo "[$(date '+%H:%M:%S')] ✗ ERROR: $*"; }

# ── Make node available in non-interactive SSH (nvm isn't auto-loaded) ─────────
export NVM_DIR="${HOME}/.nvm"
[ -s "${NVM_DIR}/nvm.sh" ] && source "${NVM_DIR}/nvm.sh" --no-use
export PATH="/usr/local/bin:/usr/bin:/home/${USER}/.nvm/versions/node/$(ls ${HOME}/.nvm/versions/node/ 2>/dev/null | tail -1)/bin:${PATH}"

# ─────────────────────────────────────────────────────────────────────────────
# STARTUP BANNER + VALIDATION
# ─────────────────────────────────────────────────────────────────────────────
log "======================================================="
log " Security Scan — GCP VM"
log " SHA:    ${GIT_SHA:0:8}"
log " Branch: ${GIT_BRANCH}"
log " Date:   ${RUN_DATE}"
log " ZAP:    ${ZAP_MODE}"
log "======================================================="

# Validate all required secrets were injected via SSH
REQUIRED=(
  GIT_SHA GIT_BRANCH RUN_DATE ZAP_MODE
  SONAR_HOST_URL SONAR_TOKEN SONAR_PROJECT_KEY
  DEFECTDOJO_URL DEFECTDOJO_API_KEY
  DEFECTDOJO_ENGAGEMENT_ID DEFECTDOJO_PRODUCT_ID
)
MISSING=()
for var in "${REQUIRED[@]}"; do
  [ -z "${!var:-}" ] && MISSING+=("$var")
done
if [ ${#MISSING[@]} -gt 0 ]; then
  fail "Missing required variables: ${MISSING[*]}"
  exit 1
fi
ok "All required env vars present"

# Check Docker is installed
if ! command -v docker &>/dev/null; then
  fail "Docker not installed. SSH into VM and run:"
  fail "  sudo apt-get update && sudo apt-get install -y docker.io"
  fail "  sudo usermod -aG docker \$USER && newgrp docker"
  exit 1
fi
ok "Docker: $(docker --version | cut -d' ' -f3 | tr -d ',')"

# Check Node.js is installed
if ! command -v node &>/dev/null; then
  fail "Node.js not found. SSH into VM and run:"
  fail "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash"
  fail "  source ~/.bashrc && nvm install 18 && nvm use 18"
  exit 1
fi
ok "Node.js: $(node --version)"

# ── Check DefectDojo reachability with retry (No-IP DNS can flap) ─────────────
log "Checking DefectDojo at ${DEFECTDOJO_URL} ..."
DOJO_OK=false
for attempt in 1 2 3; do
  DOJO_HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
    --connect-timeout 15 --max-time 20 \
    "${DEFECTDOJO_URL}" 2>/dev/null || echo "000")
  if [ "${DOJO_HTTP}" != "000" ]; then
    ok "DefectDojo reachable (HTTP ${DOJO_HTTP}) on attempt ${attempt}"
    DOJO_OK=true
    break
  fi
  warn "DefectDojo attempt ${attempt}/3 failed — waiting 30s (No-IP DNS may be updating)..."
  sleep 30
done
if [ "${DOJO_OK}" = "false" ]; then
  fail "DefectDojo not reachable at ${DEFECTDOJO_URL} after 3 attempts"
  fail "Check: is DefectDojo running? Is No-IP hostname updated?"
  exit 1
fi

# ── Check SonarQube with retry (soft — skip if down) ─────────────────────────
log "Checking SonarQube at ${SONAR_HOST_URL} ..."
SONAR_REACHABLE=false
for attempt in 1 2 3; do
  SONAR_HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
    --connect-timeout 15 --max-time 20 \
    "${SONAR_HOST_URL}" 2>/dev/null || echo "000")
  if [ "${SONAR_HTTP}" != "000" ]; then
    ok "SonarQube reachable (HTTP ${SONAR_HTTP}) on attempt ${attempt}"
    SONAR_REACHABLE=true
    break
  fi
  warn "SonarQube attempt ${attempt}/3 failed — waiting 30s..."
  sleep 30
done
[ "${SONAR_REACHABLE}" = "false" ] && warn "SonarQube not reachable — SAST will be skipped, other scans continue"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 1 — MongoDB (Docker)
# ─────────────────────────────────────────────────────────────────────────────
log "-------------------------------------------------------"
log "STEP 1: Starting MongoDB"
log "-------------------------------------------------------"

docker rm -f mongo-scan 2>/dev/null || true

docker run -d \
  --name mongo-scan \
  -p "${MONGO_PORT}:27017" \
  -e MONGO_INITDB_DATABASE=localit \
  --restart=no \
  mongo:7

log "Waiting for MongoDB..."
MONGO_READY=false
for i in $(seq 1 12); do
  if docker exec mongo-scan mongosh \
       --eval "db.runCommand({ping:1})" --quiet &>/dev/null; then
    ok "MongoDB ready after $((i * 5))s"
    MONGO_READY=true
    break
  fi
  sleep 5
done
if [ "${MONGO_READY}" = "false" ]; then
  fail "MongoDB failed to start after 60s"
  docker logs mongo-scan 2>/dev/null | tail -20
  docker rm -f mongo-scan 2>/dev/null || true
  exit 1
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 2 — Redis (Docker, optional — app degrades gracefully)
# ─────────────────────────────────────────────────────────────────────────────
log "-------------------------------------------------------"
log "STEP 2: Starting Redis (optional)"
log "-------------------------------------------------------"

docker rm -f redis-scan 2>/dev/null || true
if docker run -d \
     --name redis-scan \
     -p "${REDIS_PORT}:6379" \
     --restart=no \
     redis:7-alpine 2>/dev/null; then
  sleep 3
  ok "Redis started"
else
  warn "Redis failed to start — app will continue without cache (this is fine)"
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 3 — Start Express app
#
# CRITICAL: server.js startup sequence:
#   1. connectRedis()           → gracefully degrades if Redis missing ✓
#   2. connectDB()              → calls process.exit(1) if MongoDB fails
#                                 → we provide MONGODB_URI to prevent this
#   3. initializeNotificationServices()
#        → initializeEmail()   → gracefully degrades if EMAIL_* missing ✓
#        → initializeFirebase() → gracefully degrades if FIREBASE_* missing ✓
#   4. server.listen()         → app is ready
#
# We hit /health (not /) because server has a 404 handler for unknown routes
# ─────────────────────────────────────────────────────────────────────────────
log "-------------------------------------------------------"
log "STEP 3: Starting Express app"
log "-------------------------------------------------------"

cd "${APP_DIR}"
log "Installing npm dependencies..."
npm ci --prefer-offline --no-audit 2>&1 | tail -5
ok "npm ci complete"

log "Starting server.js on port ${APP_PORT}..."
NODE_ENV=test \
MONGODB_URI="mongodb://localhost:${MONGO_PORT}/localit" \
REDIS_URL="redis://localhost:${REDIS_PORT}" \
JWT_SECRET="scan-only-jwt-secret-not-real" \
JWT_EXPIRES_IN="1d" \
PORT="${APP_PORT}" \
FRONTEND_URL="http://localhost:3001" \
node server.js > "${REPORTS_DIR}/app-startup.log" 2>&1 &
APP_PID=$!
log "App started with PID ${APP_PID}"

# Poll /health endpoint specifically — it always returns 200 when app is up
log "Waiting for app health check at http://localhost:${APP_PORT}/health ..."
APP_READY=false
for i in $(seq 1 24); do   # 24 × 5s = 2 min (connectDB can take time)
  CODE=$(curl -s -o /dev/null -w "%{http_code}" \
         --connect-timeout 5 \
         "http://localhost:${APP_PORT}/health" 2>/dev/null || echo "000")
  if [ "${CODE}" = "200" ]; then
    ok "App is ready (HTTP 200 /health) after $((i * 5))s"
    APP_READY=true
    break
  fi
  # Check if the process died
  if ! kill -0 "${APP_PID}" 2>/dev/null; then
    warn "App process died during startup. Last 30 lines of startup log:"
    tail -30 "${REPORTS_DIR}/app-startup.log" || true
    break
  fi
  log "  Waiting... (HTTP ${CODE}) [$((i*5))/120s]"
  sleep 5
done

if [ "${APP_READY}" = "false" ]; then
  warn "App did not become ready within 2 minutes — ZAP DAST will be skipped"
  warn "Full startup log saved to app-startup.log in the artifact"
  APP_PID=""
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 4 — SonarQube SAST
# ─────────────────────────────────────────────────────────────────────────────
log "-------------------------------------------------------"
log "STEP 4: SonarQube SAST"
log "-------------------------------------------------------"

if [ "${SONAR_REACHABLE}" = "true" ]; then
  cd "${APP_DIR}"
  SONAR_OK=false

  if command -v sonar-scanner &>/dev/null; then
    log "Using installed sonar-scanner CLI..."
    sonar-scanner \
      -Dsonar.projectKey="${SONAR_PROJECT_KEY}" \
      -Dsonar.host.url="${SONAR_HOST_URL}" \
      -Dsonar.token="${SONAR_TOKEN}" \
      -Dsonar.sources=. \
      -Dsonar.exclusions="**/node_modules/**,**/dist/**,**/build/**,**/coverage/**,**/tests/**,**/seeds/**,**/scripts/**,**/.git/**" \
      -Dsonar.sourceEncoding=UTF-8 \
      2>&1 && SONAR_OK=true || SONAR_OK=false
  else
    log "sonar-scanner CLI not found — using Docker fallback..."
    docker run --rm \
      --network=host \
      -v "${APP_DIR}:/usr/src" \
      sonarsource/sonar-scanner-cli:latest \
      -Dsonar.projectKey="${SONAR_PROJECT_KEY}" \
      -Dsonar.host.url="${SONAR_HOST_URL}" \
      -Dsonar.token="${SONAR_TOKEN}" \
      -Dsonar.sources=/usr/src \
      -Dsonar.exclusions="**/node_modules/**,**/dist/**,**/build/**,**/coverage/**" \
      -Dsonar.sourceEncoding=UTF-8 \
      2>&1 && SONAR_OK=true || SONAR_OK=false
  fi

  if [ "${SONAR_OK}" = "true" ]; then
    sleep 5
    curl -s \
      -u "${SONAR_TOKEN}:" \
      "${SONAR_HOST_URL}/api/issues/search?componentKeys=${SONAR_PROJECT_KEY}&resolved=false&ps=500" \
      -o "${REPORTS_DIR}/sonarqube-report.json"
    SIZE=$(wc -c < "${REPORTS_DIR}/sonarqube-report.json" 2>/dev/null || echo 0)
    if [ "${SIZE}" -gt 50 ]; then
      ok "SonarQube report: ${SIZE} bytes"
      SONAR_RESULT="passed"
    else
      warn "SonarQube report is too small (${SIZE} bytes) — may be empty"
      SONAR_RESULT="empty"
    fi
  else
    warn "SonarQube scan failed — continuing with other scans"
    SONAR_RESULT="failed"
  fi
else
  warn "Skipping SonarQube — not reachable"
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 5 — OWASP Dependency-Check SCA (Docker)
# NVD cache persists on VM disk at ~/.dependency-check/data
# ─────────────────────────────────────────────────────────────────────────────
log "-------------------------------------------------------"
log "STEP 5: OWASP Dependency-Check SCA"
log "-------------------------------------------------------"

NVD_CACHE="${HOME}/.dependency-check/data"
mkdir -p "${NVD_CACHE}"
docker rm -f dep-check 2>/dev/null || true

NVD_FLAG=""
[ -n "${NVD_API_KEY:-}" ] && NVD_FLAG="--nvdApiKey ${NVD_API_KEY}"

docker run \
  --name dep-check \
  -v "${APP_DIR}:/src:ro" \
  -v "${REPORTS_DIR}:/report" \
  -v "${NVD_CACHE}:/usr/share/dependency-check/data" \
  owasp/dependency-check:latest \
  --project "localit-backend" \
  --scan /src \
  --format XML \
  --out /report \
  --enableRetired \
  --disableAssembly \
  ${NVD_FLAG} \
  --failOnCVSS 0 \
  2>&1 && DEPCHECK_OK=true || DEPCHECK_OK=false

docker rm -f dep-check 2>/dev/null || true

if [ "${DEPCHECK_OK}" = "true" ] && \
   [ -f "${REPORTS_DIR}/dependency-check-report.xml" ]; then
  ok "Dependency-Check report: $(wc -c < ${REPORTS_DIR}/dependency-check-report.xml) bytes"
  DEPCHECK_RESULT="passed"
else
  warn "Dependency-Check failed or no report produced"
  DEPCHECK_RESULT="failed"
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 6 — OWASP ZAP DAST (Docker, --network=host → reaches localhost:3000)
# ─────────────────────────────────────────────────────────────────────────────
log "-------------------------------------------------------"
log "STEP 6: OWASP ZAP DAST (${ZAP_MODE} scan)"
log "-------------------------------------------------------"

if [ -n "${APP_PID}" ] && kill -0 "${APP_PID}" 2>/dev/null; then
  docker rm -f zap-scan 2>/dev/null || true

  ZAP_RULES_FLAG=""
  ZAP_RULES_SRC="${WORKSPACE}/app/.github/security/zap/zap-rules.tsv"
  if [ -f "${ZAP_RULES_SRC}" ]; then
    cp "${ZAP_RULES_SRC}" "${REPORTS_DIR}/zap-rules.tsv"
    ZAP_RULES_FLAG="-c /zap/wrk/zap-rules.tsv"
    log "Using ZAP rules from repo"
  fi

  ZAP_CMD="zap-baseline.py"
  [ "${ZAP_MODE}" = "full" ] && ZAP_CMD="zap-full-scan.py"
  log "Running ZAP ${ZAP_CMD} → http://localhost:${APP_PORT}/health"

  # Use /health as target base — it always responds 200
  # -I flag means: don't exit non-zero when alerts are found (keeps pipeline green)
  docker run \
    --name zap-scan \
    --network=host \
    -v "${REPORTS_DIR}:/zap/wrk/:rw" \
    ghcr.io/zaproxy/zaproxy:stable \
    ${ZAP_CMD} \
    -t "http://localhost:${APP_PORT}" \
    -J zap-report.json \
    -x zap-report.xml \
    ${ZAP_RULES_FLAG} \
    -I \
    2>&1 || true

  docker rm -f zap-scan 2>/dev/null || true

  if [ -f "${REPORTS_DIR}/zap-report.xml" ]; then
    ok "ZAP report: $(wc -c < ${REPORTS_DIR}/zap-report.xml) bytes"
    ZAP_RESULT="passed"
  else
    warn "ZAP produced no report file"
    ZAP_RESULT="empty"
  fi
else
  warn "App not running — skipping ZAP"
  ZAP_RESULT="skipped-app-not-running"
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 7 — Stop app, MongoDB, Redis
# ─────────────────────────────────────────────────────────────────────────────
log "-------------------------------------------------------"
log "STEP 7: Stopping services"
log "-------------------------------------------------------"

if [ -n "${APP_PID}" ] && kill -0 "${APP_PID}" 2>/dev/null; then
  kill "${APP_PID}" 2>/dev/null && ok "Express app stopped" || true
fi
docker rm -f mongo-scan 2>/dev/null && ok "MongoDB stopped" || true
docker rm -f redis-scan 2>/dev/null && ok "Redis stopped"   || true

# ─────────────────────────────────────────────────────────────────────────────
# STEP 8 — Import reports to DefectDojo
# ─────────────────────────────────────────────────────────────────────────────
log "-------------------------------------------------------"
log "STEP 8: Importing to DefectDojo"
log "-------------------------------------------------------"

do_import() {
  local FILE="$1"
  local SCAN_TYPE="$2"
  local LABEL="$3"

  if [ ! -f "${FILE}" ]; then
    warn "Skipping ${LABEL} — file not found: ${FILE}"
    return 1
  fi

  log "Importing ${LABEL}..."
  local RESPONSE
  RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X POST \
    -H "Authorization: Token ${DEFECTDOJO_API_KEY}" \
    -F "scan_date=${RUN_DATE}" \
    -F "scan_type=${SCAN_TYPE}" \
    -F "engagement=${DEFECTDOJO_ENGAGEMENT_ID}" \
    -F "file=@${FILE}" \
    -F "close_old_findings=true" \
    -F "minimum_severity=Low" \
    -F "tags=git-sha:${GIT_SHA:0:8},branch:${GIT_BRANCH},date:${RUN_DATE}" \
    "${DEFECTDOJO_URL}/api/v2/import-scan/")

  local HTTP_CODE
  HTTP_CODE=$(echo "${RESPONSE}" | tail -1)
  local BODY
  BODY=$(echo "${RESPONSE}" | head -n -1)

  if [ "${HTTP_CODE}" = "201" ]; then
    ok "${LABEL} imported (HTTP 201)"
    IMPORT_COUNT=$((IMPORT_COUNT + 1))
    return 0
  else
    warn "${LABEL} import failed (HTTP ${HTTP_CODE}): ${BODY}"
    return 1
  fi
}

do_import "${REPORTS_DIR}/sonarqube-report.json"       "SonarQube Scan"   "SonarQube"        || true
do_import "${REPORTS_DIR}/dependency-check-report.xml" "dependency-check" "Dependency-Check" || true
do_import "${REPORTS_DIR}/zap-report.xml"              "ZAP Scan"         "ZAP"              || true

if [ "${IMPORT_COUNT}" -eq 0 ]; then
  fail "All DefectDojo imports failed — cannot generate report"
  fail "Check DEFECTDOJO_API_KEY starts with 'Token ' and DEFECTDOJO_ENGAGEMENT_ID is correct"
  exit 1
fi
ok "${IMPORT_COUNT}/3 reports imported to DefectDojo"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 9 — Generate final report: PDF → HTML → JSON fallback
# ─────────────────────────────────────────────────────────────────────────────
log "-------------------------------------------------------"
log "STEP 9: Generating final report"
log "-------------------------------------------------------"

sleep 15  # Give DefectDojo time to process imports

# Attempt 1: PDF
log "Trying PDF..."
HTTP=$(curl -s \
  -o "${REPORTS_DIR}/final-report.pdf" \
  -w "%{http_code}" \
  -X POST \
  -H "Authorization: Token ${DEFECTDOJO_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"engagement\":${DEFECTDOJO_ENGAGEMENT_ID},\"include_finding_notes\":true,\"include_executive_summary\":true,\"include_table_of_contents\":true}" \
  "${DEFECTDOJO_URL}/api/v2/reports/generate/")
SIZE=$(wc -c < "${REPORTS_DIR}/final-report.pdf" 2>/dev/null || echo 0)

if [ "${HTTP}" = "200" ] && [ "${SIZE}" -gt 1000 ]; then
  ok "PDF report generated (${SIZE} bytes)"
  FINAL_FORMAT="pdf"
else
  warn "PDF failed (HTTP ${HTTP}, ${SIZE} bytes) — trying HTML..."
  rm -f "${REPORTS_DIR}/final-report.pdf"

  # Attempt 2: HTML
  HTTP=$(curl -s \
    -o "${REPORTS_DIR}/final-report.html" \
    -w "%{http_code}" \
    -H "Authorization: Token ${DEFECTDOJO_API_KEY}" \
    "${DEFECTDOJO_URL}/api/v2/findings/?engagement=${DEFECTDOJO_ENGAGEMENT_ID}&limit=500&format=json")
  SIZE=$(wc -c < "${REPORTS_DIR}/final-report.html" 2>/dev/null || echo 0)

  if [ "${HTTP}" = "200" ] && [ "${SIZE}" -gt 100 ]; then
    ok "HTML/findings export generated (${SIZE} bytes)"
    FINAL_FORMAT="html"
  else
    warn "HTML failed (HTTP ${HTTP}, ${SIZE} bytes) — trying JSON..."
    rm -f "${REPORTS_DIR}/final-report.html"

    # Attempt 3: JSON
    HTTP=$(curl -s \
      -o "${REPORTS_DIR}/final-report.json" \
      -w "%{http_code}" \
      -H "Authorization: Token ${DEFECTDOJO_API_KEY}" \
      "${DEFECTDOJO_URL}/api/v2/findings/?engagement=${DEFECTDOJO_ENGAGEMENT_ID}&limit=500")
    SIZE=$(wc -c < "${REPORTS_DIR}/final-report.json" 2>/dev/null || echo 0)

    if [ "${HTTP}" = "200" ] && [ "${SIZE}" -gt 10 ]; then
      ok "JSON report generated (${SIZE} bytes)"
      FINAL_FORMAT="json"
    else
      fail "All report formats failed"
      exit 1
    fi
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# SUMMARY
# ─────────────────────────────────────────────────────────────────────────────
log ""
log "======================================================="
log " SCAN COMPLETE"
log " SHA:    ${GIT_SHA:0:8}  Branch: ${GIT_BRANCH}"
log "-------------------------------------------------------"
log " SonarQube SAST:     ${SONAR_RESULT}"
log " Dependency-Check:   ${DEPCHECK_RESULT}"
log " OWASP ZAP:          ${ZAP_RESULT}"
log " DefectDojo imports: ${IMPORT_COUNT}/3"
log " Report format:      ${FINAL_FORMAT}"
log " Report:             ${REPORTS_DIR}/final-report.${FINAL_FORMAT}"
log "======================================================="
ok "Done. GitHub Actions will pull the report back."