"""Offline subprocess fixture for exercising the official MCP client."""
from mcp.server.fastmcp import FastMCP

server = FastMCP("DeskAura Test MCP")


@server.tool()
def echo(value: str) -> str:
    """Return a value for the local MCP transport test."""
    return value


if __name__ == "__main__":
    server.run()
