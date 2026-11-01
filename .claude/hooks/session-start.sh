#!/bin/bash
# Installs what CI installs, in cloud sessions only. A failure only warns, so the session still starts.
[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "$CLAUDE_PROJECT_DIR" || exit 0
warn() { echo "[session-start] warn: $1"; }
# The MCP server starts from what the setup script installed, before this hook's packages land.
python -c "import mcp.server.mcpserver" 2>/dev/null || warn "the setup script's mcp version can't run the races server; update it to match requirements-mcp.txt"
python -m pip install --quiet --break-system-packages -c requirements-constraints.txt \
  -r pipeline_client/backend/requirements.txt -r services/races-api/requirements.txt \
  -r requirements-mcp.txt pytest pytest-asyncio pytest-cov httpx >/dev/null 2>&1 || warn "pip install failed"
npm ci --prefix web >/dev/null 2>&1 || warn "npm ci in web failed"
exit 0
