"""Run MCP-only packages with an existing Python installation, without copying it."""
import os
from pathlib import Path
import runpy
import site
import sys

MODULES = {"mcp_server_fetch", "duckduckgo_mcp_server.server", "windows_mcp"}


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in MODULES:
        raise SystemExit("Choose a configured MCP module.")
    packages = Path(__file__).resolve().parents[1] / "local-mcp" / "python-packages"
    if not packages.is_dir():
        raise SystemExit("MCP dependencies are not installed.")
    # The existing interpreter is used as-is; only the MCP package directory
    # is added to sys.path. It does not copy Python or replace site-packages.
    sys.path.insert(0, str(packages))
    site.addsitedir(str(packages))
    os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")
    module, *arguments = sys.argv[1:]
    sys.argv = [module, *arguments]
    runpy.run_module(module, run_name="__main__")


if __name__ == "__main__":
    main()
