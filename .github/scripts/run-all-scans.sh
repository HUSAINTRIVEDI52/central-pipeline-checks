#!/bin/bash
# =============================================================================
# run-all-scans.sh
# Scans: SonarQube SAST + OWASP Dependency-Check SCA
# Output: Imported to DefectDojo → final report as GitHub artifact
# =============================================================================

set -euo pipefail

# ── Paths ─────────────────────────────────────────────────────────────────────
WORKSPACE="${HOME}/security-scan"
APP_DIR="${WORKSPACE}/app/backend"
REPORTS_DIR="${WORKSPACE}/reports"
LOG_FILE="${REPORTS_DIR}/scan.log"
NVD_CACHE="${HOME}/.dependency-check/data"

# ── State ─────────────────────────────────────────────────────────────────────
SONAR_RESULT="skipped"
DEPCHECK_RESULT="skipped"
IMPORT_COUNT=0
FINAL_FORMAT="none"

# ── Logging ───────────────────────────────────────────────────────────────────
mkdir -p "${REPORTS_DIR}"
mkdir -p "${NVD_CACHE}"
exec > >(tee -a "${LOG_FILE}") 2>&1

log()  { echo "[$(date '+%H:%M:%S')] $*"; }
ok()   { echo "[$(date '+%H:%M:%S')] ✓ $*"; }
warn() { echo "[$(date '+%H:%M:%S')] ⚠ WARNING: $*"; }
fail() { echo "[$(date '+%H:%M:%S')] ✗ ERROR: $*"; }

# ── PATH setup ────────────────────────────────────────────────────────────────
export PATH="/usr/local/bin:/usr/bin:/usr/local/sbin:/usr/sbin:$PATH"
export NVM_DIR="${HOME}/.nvm"
[ -s "${NVM_DIR}/nvm.sh" ] && source "${NVM_DIR}/nvm.sh"

# ─────────────────────────────────────────────────────────────────────────────
# BANNER + VALIDATION
# ─────────────────────────────────────────────────────────────────────────────
log "======================================================="
log " Security Scan — GCP VM"
log " SHA:    ${GIT_SHA:0:8}"
log " Branch: ${GIT_BRANCH}"
log " Date:   ${RUN_DATE}"
log "======================================================="

REQUIRED=(
  GIT_SHA GIT_BRANCH RUN_DATE
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

# Check Docker
if ! command -v docker &>/dev/null; then
  fail "Docker not installed on VM"
  exit 1
fi
ok "Docker: $(docker --version | cut -d' ' -f3 | tr -d ',')"

# ── Fix permissions upfront ───────────────────────────────────────────────────
chmod -R 777 "${REPORTS_DIR}" 2>/dev/null || true
chmod -R 777 "${NVD_CACHE}"   2>/dev/null || true
ok "Permissions set on reports and NVD cache"

# ── Check DefectDojo ──────────────────────────────────────────────────────────
log "Checking DefectDojo at ${DEFECTDOJO_URL} ..."
DOJO_OK=false
for attempt in 1 2 3; do
  DOJO_HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
    --connect-timeout 15 --max-time 20 \
    "${DEFECTDOJO_URL}" 2>/dev/null || echo "000")
  if [ "${DOJO_HTTP}" != "000" ]; then
    ok "DefectDojo reachable (HTTP ${DOJO_HTTP})"
    DOJO_OK=true
    break
  fi
  warn "DefectDojo attempt ${attempt}/3 failed — retrying in 15s..."
  sleep 15
done
if [ "${DOJO_OK}" = "false" ]; then
  fail "DefectDojo not reachable at ${DEFECTDOJO_URL}"
  exit 1
fi

# ── Check SonarQube (soft) ────────────────────────────────────────────────────
log "Checking SonarQube at ${SONAR_HOST_URL} ..."
SONAR_REACHABLE=false
for attempt in 1 2 3; do
  SONAR_HTTP=$(curl -s -o /dev/null -w "%{http_code}" \
    --connect-timeout 15 --max-time 20 \
    "${SONAR_HOST_URL}" 2>/dev/null || echo "000")
  if [ "${SONAR_HTTP}" != "000" ]; then
    ok "SonarQube reachable (HTTP ${SONAR_HTTP})"
    SONAR_REACHABLE=true
    break
  fi
  warn "SonarQube attempt ${attempt}/3 — retrying in 15s..."
  sleep 15
done
[ "${SONAR_REACHABLE}" = "false" ] && \
  warn "SonarQube not reachable — SAST skipped"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 1 — SonarQube SAST
# ─────────────────────────────────────────────────────────────────────────────
log "-------------------------------------------------------"
log "STEP 1: SonarQube SAST"
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
    log "Using Docker sonar-scanner-cli..."
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
    ok "SonarQube report saved (${SIZE} bytes)"
    SONAR_RESULT="passed"
  else
    warn "SonarQube scan failed — continuing with Dependency-Check"
    SONAR_RESULT="failed"
  fi
else
  warn "Skipping SonarQube — not reachable"
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 2 — OWASP Dependency-Check SCA
#
# FIX: Run as root inside container so it can write the report
#      Map REPORTS_DIR with full write permissions
# ─────────────────────────────────────────────────────────────────────────────
log "-------------------------------------------------------"
log "STEP 2: OWASP Dependency-Check SCA"
log "-------------------------------------------------------"

docker rm -f dep-check 2>/dev/null || true

# Ensure host dirs are fully writable before mounting
chmod -R 777 "${REPORTS_DIR}"
chmod -R 777 "${NVD_CACHE}"

NVD_FLAG=""
[ -n "${NVD_API_KEY:-}" ] && NVD_FLAG="--nvdApiKey ${NVD_API_KEY}"

log "Running Dependency-Check..."
docker run \
  --name dep-check \
  --user root \
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
  --disableOssIndex \
  ${NVD_FLAG} \
  --failOnCVSS 0 \
  2>&1 && DEPCHECK_OK=true || DEPCHECK_OK=false

docker rm -f dep-check 2>/dev/null || true

# Fix ownership after container writes as root
sudo chown -R "$(whoami)":"$(whoami)" "${REPORTS_DIR}" 2>/dev/null || true

if [ -f "${REPORTS_DIR}/dependency-check-report.xml" ]; then
  SIZE=$(wc -c < "${REPORTS_DIR}/dependency-check-report.xml")
  ok "Dependency-Check report saved (${SIZE} bytes)"
  DEPCHECK_RESULT="passed"
else
  warn "Dependency-Check failed or no report produced"
  DEPCHECK_RESULT="failed"
fi

# ─────────────────────────────────────────────────────────────────────────────
# STEP 3 — Import to DefectDojo
# ─────────────────────────────────────────────────────────────────────────────
log "-------------------------------------------------------"
log "STEP 3: Importing to DefectDojo"
log "-------------------------------------------------------"

do_import() {
  local FILE="$1" SCAN_TYPE="$2" LABEL="$3"
  if [ ! -f "${FILE}" ]; then
    warn "Skipping ${LABEL} — file not found: ${FILE}"
    return 1
  fi
  log "Importing ${LABEL} ($(wc -c < ${FILE}) bytes)..."
  local RESPONSE HTTP_CODE BODY
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
  HTTP_CODE=$(echo "${RESPONSE}" | tail -1)
  BODY=$(echo "${RESPONSE}" | head -n -1)
  if [ "${HTTP_CODE}" = "201" ]; then
    ok "${LABEL} imported (HTTP 201)"
    IMPORT_COUNT=$((IMPORT_COUNT + 1))
    return 0
  else
    warn "${LABEL} import failed (HTTP ${HTTP_CODE})"
    warn "Response: ${BODY}"
    return 1
  fi
}

do_import \
  "${REPORTS_DIR}/sonarqube-report.json" \
  "SonarQube Scan" \
  "SonarQube" || true

do_import \
  "${REPORTS_DIR}/dependency-check-report.xml" \
  "dependency-check" \
  "Dependency-Check" || true

if [ "${IMPORT_COUNT}" -eq 0 ]; then
  fail "All DefectDojo imports failed"
  fail "Check:"
  fail "  1. DEFECTDOJO_API_KEY — must be just the key value, no 'Token ' prefix"
  fail "  2. DEFECTDOJO_ENGAGEMENT_ID — must be a valid numeric ID"
  fail "  3. DEFECTDOJO_URL — must be http://localhost:8080"
  exit 1
fi
ok "${IMPORT_COUNT}/2 reports imported to DefectDojo"

# ─────────────────────────────────────────────────────────────────────────────
# STEP 4 — Generate final report from DefectDojo
# ─────────────────────────────────────────────────────────────────────────────
log "-------------------------------------------------------"
log "STEP 4: Generating final report"
log "-------------------------------------------------------"

sleep 15

# Attempt 1: PDF
log "Trying PDF report..."
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
  warn "PDF failed (HTTP ${HTTP}, ${SIZE} bytes) — trying JSON..."
  rm -f "${REPORTS_DIR}/final-report.pdf"

  # Attempt 2: JSON findings
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

# ─────────────────────────────────────────────────────────────────────────────
# SUMMARY
# ─────────────────────────────────────────────────────────────────────────────
log ""
log "======================================================="
log " SCAN COMPLETE"
log " SHA: ${GIT_SHA:0:8}  Branch: ${GIT_BRANCH}"
log "-------------------------------------------------------"
log " SonarQube SAST:     ${SONAR_RESULT}"
log " Dependency-Check:   ${DEPCHECK_RESULT}"
log " DefectDojo imports: ${IMPORT_COUNT}/2"
log " Report format:      ${FINAL_FORMAT}"
log " Report:             ${REPORTS_DIR}/final-report.${FINAL_FORMAT}"
log "======================================================="
ok "Done. Report will be uploaded as GitHub artifact."