"""Local access rules, separate from the policy for asking approval.

Path checks constrain DeskAura's own file tools. They cannot constrain a shell
or third-party MCP server, so those operations require full access unless an
actual operating-system sandbox is introduced.
"""
from fastapi import HTTPException

SANDBOX_MODES = {"read_only", "workspace_write", "full_access"}
READ_OPERATIONS = {"list", "search", "read"}
EXTERNAL_OPERATIONS = {"execute", "code", "mcp"}


def sandbox_mode(config: dict) -> str:
    value = str(config.get("local_sandbox_mode", "read_only"))
    return value if value in SANDBOX_MODES else "read_only"


def require_operation(config: dict, operation: str) -> str:
    if not config.get("tools_enabled", True):
        raise HTTPException(403, "手脚模块已停用。")
    mode = sandbox_mode(config)
    if mode == "read_only" and operation not in READ_OPERATIONS:
        raise HTTPException(403, "当前是只读权限，不能修改文件或执行工具。")
    if operation in EXTERNAL_OPERATIONS:
        if mode != "full_access":
            raise HTTPException(
                403, "当前没有可验证的操作系统沙箱；命令、代码和 MCP 工具仅在完全访问权限下可执行。"
            )
        if config.get("local_sandbox_enabled"):
            raise HTTPException(409, "操作系统沙箱尚不可用，已阻止执行。")
    return mode
