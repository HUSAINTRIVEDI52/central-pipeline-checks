#!/bin/bash
# wait-for-app.sh — Polls a URL until it responds or timeout reached
# Usage: wait-for-app.sh <url> <timeout_seconds>

URL=$1
TIMEOUT=${2:-60}
INTERVAL=5
ELAPSED=0

echo "Waiting for app at $URL (timeout: ${TIMEOUT}s)..."

while [ $ELAPSED -lt $TIMEOUT ]; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "$URL" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" != "000" ] && [ "$HTTP_CODE" != "502" ] && [ "$HTTP_CODE" != "503" ]; then
    echo "App is ready at $URL (HTTP $HTTP_CODE) after ${ELAPSED}s"
    exit 0
  fi
  echo "App not ready yet (HTTP $HTTP_CODE). Retrying in ${INTERVAL}s... [${ELAPSED}/${TIMEOUT}s]"
  sleep $INTERVAL
  ELAPSED=$((ELAPSED + INTERVAL))
done

echo "ERROR: App at $URL did not become ready within ${TIMEOUT}s"
exit 1
