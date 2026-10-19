#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${MCP_URL:-http://127.0.0.1:3000/mcp}"
ACCEPT_HEADER="application/json, text/event-stream"

echo "Initialize MCP..."

AUTH_ARGS=()
if [ -n "${MCP_AUTH_TOKEN:-}" ]; then
  AUTH_ARGS=(-H "Authorization: Bearer $MCP_AUTH_TOKEN")
fi

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

curl --fail-with-body -sS \
  -X POST "$BASE_URL" \
  "${AUTH_ARGS[@]}" \
  -H "Content-Type: application/json" \
  -H "Accept: $ACCEPT_HEADER" \
  --data "$INIT_BODY"

echo ""

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

curl --fail-with-body -sS \
  -X POST "$BASE_URL" \
  "${AUTH_ARGS[@]}" \
  -H "Content-Type: application/json" \
  -H "Accept: $ACCEPT_HEADER" \
  --data "$CALL_BODY"

echo ""
