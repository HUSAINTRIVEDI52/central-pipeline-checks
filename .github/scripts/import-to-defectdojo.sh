#!/bin/bash
# import-to-defectdojo.sh — Uploads a scan report to DefectDojo via API
# Usage: import-to-defectdojo.sh <dojo_url> <api_key> <engagement_id> <report_file> <scan_type> <git_sha> <branch>

DOJO_URL=$1
API_KEY=$2
ENGAGEMENT_ID=$3
REPORT_FILE=$4
SCAN_TYPE=$5
GIT_SHA=$6
BRANCH=$7
DATE=$(date +%Y-%m-%d)

echo "Importing $SCAN_TYPE report to DefectDojo..."
echo "  File:        $REPORT_FILE"
echo "  Engagement:  $ENGAGEMENT_ID"
echo "  Scan type:   $SCAN_TYPE"
echo "  Tagged:      git-sha:${GIT_SHA:0:8}, branch:$BRANCH"

if [ ! -f "$REPORT_FILE" ]; then
  echo "ERROR: Report file not found: $REPORT_FILE"
  exit 1
fi

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST \
  -H "Authorization: Token $API_KEY" \
  -F "scan_date=$DATE" \
  -F "scan_type=$SCAN_TYPE" \
  -F "engagement=$ENGAGEMENT_ID" \
  -F "file=@$REPORT_FILE" \
  -F "close_old_findings=true" \
  -F "minimum_severity=Low" \
  -F "tags=git-sha:${GIT_SHA:0:8},branch:$BRANCH,date:$DATE" \
  "$DOJO_URL/api/v2/import-scan/")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "201" ]; then
  echo "SUCCESS: $SCAN_TYPE imported to DefectDojo (HTTP 201)"
  echo "$BODY" | grep -o '"id":[0-9]*' | head -1 || true
  exit 0
else
  echo "ERROR: DefectDojo import failed (HTTP $HTTP_CODE)"
  echo "Response: $BODY"
  exit 1
fi
