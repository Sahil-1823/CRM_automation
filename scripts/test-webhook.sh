#!/usr/bin/env bash
# Test the HeyReach webhook (bash/curl version).
#
# Usage:
#   export HEYREACH_WEBHOOK_SECRET=your-secret
#   ./scripts/test-webhook.sh
#
#   HEYREACH_WEBHOOK_SECRET=xxx ./scripts/test-webhook.sh
#   BASE_URL=http://localhost:3000 ./scripts/test-webhook.sh

set -euo pipefail

SECRET="${HEYREACH_WEBHOOK_SECRET:-}"
BASE_URL="${BASE_URL:-https://crm-automation-seven.vercel.app}"
CONVERSATION_ID="${CONVERSATION_ID:-test-conv-001}"
LINKEDIN_ACCOUNT_ID="${LINKEDIN_ACCOUNT_ID:-123456}"

if [ -z "$SECRET" ]; then
  echo "Error: set HEYREACH_WEBHOOK_SECRET" >&2
  exit 1
fi

URI="${BASE_URL%/}/api/heyreach-webhook"

BODY=$(cat <<EOF
{
  "lead": {
    "firstName": "Test",
    "lastName": "Lead",
    "profileUrl": "https://linkedin.com/in/testlead",
    "companyName": "Test Co"
  },
  "message": "Yes, I am interested. Can we schedule a call?",
  "yourMessage": "Hi, would you be open to a quick chat about our product?",
  "conversationId": "$CONVERSATION_ID",
  "linkedInAccountId": $LINKEDIN_ACCOUNT_ID,
  "linkedInAccount": {
    "id": $LINKEDIN_ACCOUNT_ID,
    "firstName": "Alex",
    "lastName": "Sales"
  },
  "campaignId": 78901,
  "campaign": {
    "id": 78901,
    "name": "Q2 Outbound"
  },
  "eventType": "every_message_reply_received"
}
EOF
)

echo "POST $URI"
echo ""

HTTP_CODE=$(curl -sS -w "%{http_code}" -o /tmp/webhook-response.json \
  -X POST "$URI" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SECRET" \
  -d "$BODY")

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  echo "Success (HTTP $HTTP_CODE):"
  cat /tmp/webhook-response.json
  echo ""
  echo "Open the admin dashboard -> Pending to review the new event."
else
  echo "Failed (HTTP $HTTP_CODE):" >&2
  cat /tmp/webhook-response.json >&2
  exit 1
fi
