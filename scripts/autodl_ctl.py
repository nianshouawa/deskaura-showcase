#!/usr/bin/env python3
"""AutoDL 容器实例 Pro 控制：开机 / 关机 / 查状态 / 列表。

用法：
  python autodl_ctl.py start    # 开机（有卡模式）
  python autodl_ctl.py stop     # 关机（停止计费）
  python autodl_ctl.py status   # 查询实例状态
  python autodl_ctl.py list     # 列出所有实例

依赖：
  pip install requests

配置（二选一）：
  1. 环境变量 AUTODL_TOKEN / AUTODL_INSTANCE_UUID
  2. 或直接改本文件下方的常量

官方接口（已验证，见 AutoDL 文档「容器实例Pro API」）：
  HOST : https://api.autodl.com
  鉴权 : Authorization: <token>（裸 token，不带 Bearer）
  UUID 形如 pro-xxxxxxxxxxxx
"""

import os
import sys
import json

import requests
import urllib3

# 默认跳过 SSL 证书校验（绕过本地代理/Clash 的 TLS 劫持）。
# 要恢复校验时设环境变量 AUTODL_VERIFY=1。
VERIFY = os.getenv("AUTODL_VERIFY", "0") != "1"  # False = 跳过校验
if not VERIFY:
    urllib3.disable_warnings()

# ====== 在这里填你的 AutoDL 信息（或改用环境变量）======
AUTODL_TOKEN = os.getenv(
    "AUTODL_TOKEN",
    "eyJhbGciOiJFUzI1NiIsImtpZCI6InB1YmxpYy1rZXktMjAyNjA5IiwidHlwIjoiSldUIn0.eyJ1aWQiOjEyNTYzMTQsInV1aWQiOiIzNWZmMzE4NzIwZjhlNjk5IiwidGVuYW50IjoiYXV0b2RsIiwiYXVkIjoiZGV2ZWxvcF9hcGkifQ.ZnMzVROc30xUaf2J-9T9rON6Nxt54s37H9nPcACkjxf1PMZ5WEFwX8reuaviqt5KNhzavHwgUAujWEkkh34s4w",
)
# 实例 UUID，形如 pro-xxxxxxxxxxxx（在 AutoDL 控制台实例列表里看）
AUTODL_INSTANCE_UUID = os.getenv("AUTODL_INSTANCE_UUID", "")
# ==========================================================

API_BASE = "https://api.autodl.com"
API_INSTANCE_LIST = f"{API_BASE}/api/v1/dev/instance/pro/list"
API_INSTANCE_STATUS = f"{API_BASE}/api/v1/dev/instance/pro/status"
API_POWER_ON = f"{API_BASE}/api/v1/dev/instance/pro/power_on"
API_POWER_OFF = f"{API_BASE}/api/v1/dev/instance/pro/power_off"


def _headers() -> dict:
    # 官方鉴权：Authorization 直接放裸 token
    return {"Authorization": AUTODL_TOKEN}


def _request(method: str, url: str, payload: dict | None = None) -> dict:
    kwargs = dict(headers=_headers(), timeout=30, verify=VERIFY)
    if method.upper() == "GET":
        kwargs["params"] = payload or {}
        resp = requests.get(url, **kwargs)
    else:
        kwargs["json"] = payload or {}
        resp = requests.post(url, **kwargs)
    resp.raise_for_status()
    return resp.json()


def _require_token() -> None:
    if not AUTODL_TOKEN or AUTODL_TOKEN.startswith("请"):
        sys.exit("❌ 缺少 AUTODL_TOKEN。请设置环境变量或在脚本里填写。")


def list_instances() -> dict:
    _require_token()
    return _request("POST", API_INSTANCE_LIST, {"page_index": 1, "page_size": 20})


def start() -> dict:
    _require_token()
    if not AUTODL_INSTANCE_UUID:
        sys.exit("❌ 缺少 AUTODL_INSTANCE_UUID（实例 UUID，形如 pro-xxx）。")
    print(f"▶ 正在开机实例 {AUTODL_INSTANCE_UUID} ...")
    data = _request(
        "POST",
        API_POWER_ON,
        {"instance_uuid": AUTODL_INSTANCE_UUID, "payload": "gpu"},
    )
    print("  开机指令已下发，等待实例启动（约 1~3 分钟）。")
    return data


def stop() -> dict:
    _require_token()
    if not AUTODL_INSTANCE_UUID:
        sys.exit("❌ 缺少 AUTODL_INSTANCE_UUID（实例 UUID，形如 pro-xxx）。")
    print(f"■ 正在关机实例 {AUTODL_INSTANCE_UUID} ...")
    data = _request("POST", API_POWER_OFF, {"instance_uuid": AUTODL_INSTANCE_UUID})
    print("  关机指令已下发，计费停止。")
    return data


def status() -> dict:
    _require_token()
    if not AUTODL_INSTANCE_UUID:
        sys.exit("❌ 缺少 AUTODL_INSTANCE_UUID（实例 UUID，形如 pro-xxx）。")
    return _request("GET", API_INSTANCE_STATUS, {"instance_uuid": AUTODL_INSTANCE_UUID})


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(0)
    cmd = sys.argv[1].lower()
    if cmd == "start":
        print(json.dumps(start(), ensure_ascii=False, indent=2))
    elif cmd == "stop":
        print(json.dumps(stop(), ensure_ascii=False, indent=2))
    elif cmd in ("status", "state"):
        print(json.dumps(status(), ensure_ascii=False, indent=2))
    elif cmd == "list":
        print(json.dumps(list_instances(), ensure_ascii=False, indent=2))
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
