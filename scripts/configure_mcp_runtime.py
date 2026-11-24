"""Use existing interpreters and one shared directory of MCP-only packages."""
import argparse
from datetime import datetime
import json
from pathlib import Path
import shutil

import httpx

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--role", required=True)
    parser.add_argument("--python", required=True, help="Existing Python 3.14+ installation")
    args = parser.parse_args()
    python = Path(args.python).resolve(strict=True)
    node = shutil.which("node")
    if not node:
        raise SystemExit("Node.js is not installed.")
    runtime = ROOT / "local-mcp"
    with httpx.Client(timeout=180, trust_env=False, headers={"X-DeskAura-Role": args.role}) as client:
        config = client.get("http://127.0.0.1:8000/api/tools/mcp/export").raise_for_status().json()
        output = ROOT / "build/final-audit"
        output.mkdir(parents=True, exist_ok=True)
        backup = output / f"mcp-before-{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
        backup.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
        servers = config["mcpServers"]
        entries = {
            "@smithery-ai-server-sequential-thinking": ("sequential-thinking", "@modelcontextprotocol/server-sequential-thinking/dist/index.js"),
            "filesystem": ("filesystem", "@modelcontextprotocol/server-filesystem/dist/index.js"),
            "@wopal-mcp-server-hotnews": ("hotnews", "@wopal/mcp-server-hotnews/build/index.js"),
            "playwright": ("playwright", "@playwright/mcp/cli.js"),
            "hn-server": ("hn-server", "hn-server/build/index.js"),
        }
        for name, (folder, module) in entries.items():
            if name not in servers:
                continue
            entry = runtime / folder / "node_modules" / module
            if not entry.is_file():
                raise RuntimeError(f"Missing MCP package: {name}")
            server = servers[name]
            previous = server.get("args", [])
            tail = previous[1:] if name == "filesystem" else []
            if name == "playwright":
                tail = ["--output-dir", str(runtime / "playwright/output"),
                        "--user-data-dir", str(runtime / "playwright/profile")]
            server.update(command=node, args=[str(entry), *tail], cwd=str(ROOT))
        runner = ROOT / "scripts/run_mcp_python.py"
        for name, module in [
            ("@smithery-ai-fetch", "mcp_server_fetch"),
            ("duckduckgo-mcp-server", "duckduckgo_mcp_server.server"),
            ("windows-mcp", "windows_mcp"),
        ]:
            if name not in servers:
                continue
            server = servers[name]
            tail = (["serve", "--transport", "stdio", "--config", str(runtime / "windows/config/config.toml")]
                    if name == "windows-mcp" else [])
            server.update(command=str(python), args=[str(runner), module, *tail], cwd=str(ROOT))
            env = server.setdefault("env", {})
            env.pop("UV_CACHE_DIR", None)
            env.update(TEMP=str(runtime / "tmp"), TMP=str(runtime / "tmp"),
                       PYTHONIOENCODING="utf-8", PYTHONDONTWRITEBYTECODE="1")
            if name == "windows-mcp":
                env.update(POSTHOG_API_KEY="", FASTMCP_TELEMETRY_MODE="off",
                           FASTMCP_HOME=str(runtime / "windows/state"),
                           USERPROFILE=str(runtime / "runtime-home"))
        response = client.put("http://127.0.0.1:8000/api/tools/mcp/config",
                              json={"config": config, "reconnect": False})
        response.raise_for_status()
        result = client.post("http://127.0.0.1:8000/api/tools/mcp/refresh", json={}).raise_for_status().json()
        report = {key: result[key] for key in ("connected", "total", "label")}
        report["services"] = [{key: server[key] for key in ("name", "connected", "tool_count", "detail")}
                              for server in result["services"]]
        (output / "mcp-verification.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(report, ensure_ascii=True))
        if result["connected"] != result["total"]:
            raise RuntimeError("MCP verification failed; old configuration was backed up.")


if __name__ == "__main__":
    main()
