#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${MCP_URL:-http://127.0.0.1:3000/mcp}"
ACCEPT_HEADER="application/json, text/event-stream"

echo "Initialize MCP session..."

HEADERS_FILE="$(mktemp)"
INIT_BODY='{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-06-18",
    "capabilities": {},
    "clientInfo": {
      "name": "smoke-http",
      "version": "0.1.0"
    }
  }
}'

curl -sS \
  -D "$HEADERS_FILE" \
  -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: $ACCEPT_HEADER" \
  --data "$INIT_BODY"

echo ""

SESSION_ID="$(
  awk 'tolower($1) == "mcp-session-id:" {print $2}' "$HEADERS_FILE" | tr -d '\r'
)"

if [ -z "$SESSION_ID" ]; then
  echo "No MCP session id returned." >&2
  cat "$HEADERS_FILE" >&2
  exit 1
fi

echo "Session: $SESSION_ID"
echo "Call health_check..."

CALL_BODY='{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "health_check",
    "arguments": {
      "echo": "hola"
    }
  }
}'

curl -sS \
  -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -H "Accept: $ACCEPT_HEADER" \
  -H "mcp-session-id: $SESSION_ID" \
  --data "$CALL_BODY"

echo ""
rm -f "$HEADERS_FILE"