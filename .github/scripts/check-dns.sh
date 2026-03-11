#!/bin/bash
# check-dns.sh — Checks if a No-IP hostname is reachable
# Usage: check-dns.sh <url> <label>

URL=$1
LABEL=$2
MAX_RETRIES=3
WAIT=30

echo "Checking reachability of $LABEL at $URL..."

for i in $(seq 1 $MAX_RETRIES); do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 10 --max-time 15 "$URL" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" != "000" ]; then
    echo "$LABEL is reachable (HTTP $HTTP_CODE)"
    echo "reachable=true" >> $GITHUB_OUTPUT
    exit 0
  fi
  echo "Attempt $i/$MAX_RETRIES failed for $LABEL. Waiting ${WAIT}s..."
  sleep $WAIT
done

echo "WARNING: $LABEL at $URL is not reachable after $MAX_RETRIES attempts"
echo "reachable=false" >> $GITHUB_OUTPUT

# Only hard-fail for DefectDojo — SonarQube failure is non-blocking
if [ "$LABEL" = "dojo" ]; then
  echo "ERROR: DefectDojo is required for report generation. Failing pipeline."
  exit 1
fi

exit 0
