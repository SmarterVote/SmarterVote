"""Pin the admin UI refresh preset to the MCP ``refresh_race_core`` tool.

CLAUDE.md defines "refresh" as exactly what ``refresh_race_core`` queues. The
admin Races tab builds the same request in TypeScript
(web/src/lib/components/admin/pipelinePresets.ts); this test parses that file
and compares it with the options the MCP tool actually sends.
"""

import json
import re
from pathlib import Path
from unittest.mock import patch

import pytest

from smartervote_mcp import server

PRESETS_TS = Path(__file__).resolve().parents[1] / "web" / "src" / "lib" / "components" / "admin" / "pipelinePresets.ts"
# Free-text fields and routing left to the API's PIPELINE_DEFAULT_RUNNER.
_NOT_PINNED = {"note", "goal", "runner"}


def _ts_array(source: str, name: str) -> list[str]:
    match = re.search(rf"export const {name} = \[(.*?)\] as const;", source, re.S)
    assert match, f"{name} not found in pipelinePresets.ts"
    return re.findall(r'"([a-z_]+)"', match.group(1))


def _ts_refresh_options(source: str) -> dict:
    match = re.search(r"export function refreshRunOptions\(\): RunOptions \{\s*return \{(.*?)\};\s*\}", source, re.S)
    assert match, "refreshRunOptions not found in pipelinePresets.ts"
    options: dict = {}
    for key, raw in re.findall(r"^\s*([a-z_]+):\s*(.+?),\s*$", match.group(1), re.M):
        if key == "enabled_steps":
            assert raw == "[...REFRESH_STEPS]"
            options[key] = _ts_array(source, "REFRESH_STEPS")
        else:
            options[key] = json.loads(raw)
    return options


@pytest.mark.asyncio
async def test_admin_refresh_preset_matches_refresh_race_core():
    captured = {}

    class _Client:
        async def post(self, path, json=None):
            captured["path"] = path
            captured["json"] = json
            return {"added": []}

    with patch.object(server, "_client", return_value=_Client()):
        tool = getattr(server.refresh_race_core, "fn", server.refresh_race_core)
        await tool(["xx-test-2026"])

    mcp_options = {k: v for k, v in captured["json"]["options"].items() if k not in _NOT_PINNED}
    ts_options = _ts_refresh_options(PRESETS_TS.read_text(encoding="utf-8"))
    # The UI states the cheap profile explicitly; the MCP tool gets it from the
    # API default. Both resolve to "default".
    assert ts_options.pop("model_profile") == "default"
    assert ts_options == mcp_options
    assert ts_options["enabled_steps"] == ["discovery", "images", "polling", "forecast", "voter_resources"]


def test_full_research_preset_matches_claude_md_combined_run():
    steps = _ts_array(PRESETS_TS.read_text(encoding="utf-8"), "FULL_RESEARCH_STEPS")
    assert steps == ["issues", "finance", "refinement", "polling", "forecast", "voter_resources", "review", "iteration"]
