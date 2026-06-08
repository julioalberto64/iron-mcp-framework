#!/usr/bin/env bash
cd /Library/WebServer/Documents/iron-mcp/iron-mcp-framework
exec node dist/src/index.js --transport stdio
