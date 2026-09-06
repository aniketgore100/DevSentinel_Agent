#!/usr/bin/env bash
# Fires a correctly-signed fake GitHub pull_request webhook at a locally running gateway.
# Usage:
#   ./test-webhook.sh              -> expect 202, job enqueued (or dry-run logged)
#   ./test-webhook.sh --tamper     -> expect 401, signature mismatch
#   ./test-webhook.sh --ping       -> expect 200 {"pong":true}
#   ./test-webhook.sh --ignored    -> expect 200, action not processed (closed)
#   ./test-webhook.sh --draft      -> expect 200, draft PR skipped
set -euo pipefail

HOST="${HOST:-http://localhost:3000}"
TAMPER=false
MODE="opened"

for arg in "$@"; do
  case "$arg" in
    --tamper) TAMPER=true ;;
    --ping) MODE="ping" ;;
    --ignored) MODE="ignored" ;;
    --draft) MODE="draft" ;;
    *)
      echo "Unknown flag: $arg" >&2
      exit 1
      ;;
  esac
done

# Pull the webhook secret the same way config.ts does: from .env if present, else env var.
SECRET="${GITHUB_WEBHOOK_SECRET:-}"
if [ -z "$SECRET" ] && [ -f .env ]; then
  SECRET="$(grep -E '^GITHUB_WEBHOOK_SECRET=' .env | head -n1 | cut -d '=' -f2-)"
fi
if [ -z "$SECRET" ]; then
  echo "GITHUB_WEBHOOK_SECRET not set (export it or put it in .env)" >&2
  exit 1
fi

DELIVERY_ID="$(uuidgen 2>/dev/null || python3 -c 'import uuid; print(uuid.uuid4())')"
ACTION="opened"
DRAFT="false"

case "$MODE" in
  ignored) ACTION="closed" ;;
  draft) DRAFT="true" ;;
esac

PAYLOAD=$(cat <<JSON
{
  "action": "${ACTION}",
  "number": 42,
  "pull_request": {
    "number": 42,
    "title": "Add rate limiting to ingestion gateway",
    "draft": ${DRAFT},
    "diff_url": "https://github.com/acme/widgets/pull/42.diff",
    "user": { "login": "octocat" },
    "head": { "sha": "abc123def456" },
    "base": { "sha": "789xyz000111" }
  },
  "repository": {
    "full_name": "acme/widgets",
    "private": false
  },
  "installation": { "id": 987654 }
}
JSON
)

if [ "$MODE" = "ping" ]; then
  PAYLOAD='{"zen":"Design for failure.","hook_id":1}'
fi

SIGNATURE="sha256=$(printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')"

BODY_TO_SEND="$PAYLOAD"
if [ "$TAMPER" = true ]; then
  # Mutate the body *after* signing, simulating tampering in transit — the signature
  # was computed over the original bytes, so this must fail verification.
  BODY_TO_SEND=$(printf '%s' "$PAYLOAD" | sed 's/octocat/mallory/')
fi

EVENT_NAME="pull_request"
if [ "$MODE" = "ping" ]; then
  EVENT_NAME="ping"
fi

echo "POST ${HOST}/webhook/github  (mode=${MODE}, tamper=${TAMPER}, delivery=${DELIVERY_ID})"
echo

curl -sS -i -X POST "${HOST}/webhook/github" \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: ${EVENT_NAME}" \
  -H "X-GitHub-Delivery: ${DELIVERY_ID}" \
  -H "X-Hub-Signature-256: ${SIGNATURE}" \
  -d "${BODY_TO_SEND}"

echo
