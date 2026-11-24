"""Bundle the SDK runtime without importing its optional interactive CLI."""
from PyInstaller.utils.hooks import collect_data_files, collect_submodules, copy_metadata

hiddenimports = collect_submodules("mcp", filter=lambda name: not name.startswith("mcp.cli"))
datas = collect_data_files("mcp") + copy_metadata("mcp")
excludedimports = ["mcp.cli"]
