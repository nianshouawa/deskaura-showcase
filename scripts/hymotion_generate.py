#!/usr/bin/env python3
"""玩法2 一键动作生成：自动开机 → 等 worker 就绪 → 生成动作 → 自动关机。

用法：
  python hymotion_generate.py "她开心地挥手打招呼" --duration 3

可选参数：
  --duration    动作时长（秒），默认 2，范围 0.5~5
  --keep-alive  生成后不关机（调试用）
  --no-power    跳过开机，假定实例已启动（已手动开机时用）

依赖：
  pip install requests

结合 autodl_ctl.py 使用，两者共用 AUTODL_TOKEN / AUTODL_MACHINE_ID。
还需设置 HY_MOTION_WORKER_URL（worker 的公网地址），
以及 worker 的 SSH 端口请参考 AutoDL 控制台（默认 22）。
"""

import os
import sys
import time
import json
import argparse

import requests
import urllib3

urllib3.disable_warnings()

# ====== 配置（或环境变量）======
AUTODL_TOKEN = os.getenv("AUTODL_TOKEN", "")
AUTODL_INSTANCE_UUID = os.getenv("AUTODL_INSTANCE_UUID", "")
# worker 公网地址，例如 http://region-xxx.autodl.com:8010
WORKER_URL = os.getenv("HY_MOTION_WORKER_URL", "").rstrip("/")
# ==============================

from autodl_ctl import (
    start as autodl_start,
    stop as autodl_stop,
    status as autodl_status,
)


def wait_worker(timeout: int = 300, interval: int = 5) -> None:
    """轮询 worker 的 /health 直到就绪或超时。"""
    url = f"{WORKER_URL}/health"
    deadline = time.time() + timeout
    print("⏳ 等待 HY-Motion worker 加载模型（首次约 1~3 分钟）...")
    while time.time() < deadline:
        try:
            r = requests.get(url, timeout=5)
            if r.status_code == 200:
                body = r.json()
                if body.get("status") == "ok":
                    print("✅ worker 已就绪。")
                    return
        except requests.RequestException:
            pass
        time.sleep(interval)
    sys.exit("❌ worker 加载超时。请确认实例已启动、worker 已在后台运行。")


def generate(prompt: str, duration: float) -> dict:
    """调用 worker 生成动作。"""
    url = f"{WORKER_URL}/generate"
    print(f"🎬 生成动作：{prompt}（时长 {duration}s）")
    r = requests.post(url, json={"prompt": prompt, "duration": duration}, timeout=300)
    if r.status_code == 503:
        sys.exit("❌ worker 返回 503：模型未加载。请等待就绪后重试。")
    r.raise_for_status()
    return r.json()


def wait_instance_running(timeout: int = 300) -> None:
    """轮询实例状态，直到 running。"""
    deadline = time.time() + timeout
    print("⏳ 等待实例开机 ...")
    while time.time() < deadline:
        try:
            info = autodl_status()
            # 容器实例 Pro：data 直接是状态字符串，如 "running"
            state = str(info.get("data") or "").lower()
            if state == "running":
                print("✅ 实例已开机。")
                return
        except requests.RequestException:
            pass
        time.sleep(5)
    sys.exit("❌ 实例开机超时。")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("prompt", help="动作描述（一句话）")
    parser.add_argument("--duration", type=float, default=2.0, help="动作时长秒，0.5~5")
    parser.add_argument("--keep-alive", action="store_true", help="生成后不关机")
    parser.add_argument("--no-power", action="store_true", help="跳过开机，假定实例已启动")
    args = parser.parse_args()

    if not WORKER_URL:
        sys.exit("❌ 请设置 HY_MOTION_WORKER_URL（worker 公网地址）。")

    powered_on = False
    if not args.no_power:
        try:
            autodl_start()
            powered_on = True
            wait_instance_running()
        except Exception as exc:
            print(f"⚠ 自动开机失败（可能已开机或 API 配置有误）：{exc}")
            print("  继续尝试直接连接 worker ...")

    try:
        wait_worker()
        result = generate(args.prompt, args.duration)
        n_frames = len(result.get("poses", []))
        print(f"✅ 生成成功：{n_frames} 帧 @ {result.get('fps', 30)} FPS")
        # 保存到本地
        out_path = os.path.join(
            os.path.dirname(__file__), "..", "motion-service", "data", "last_generated.json"
        )
        os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump({**result, "prompt": args.prompt}, f, ensure_ascii=False)
        print(f"💾 已保存到 {os.path.abspath(out_path)}")
    finally:
        if powered_on and not args.keep_alive:
            try:
                autodl_stop()
                print("🔌 已自动关机，计费停止。")
            except Exception as exc:
                print(f"⚠ 自动关机失败，请手动关机：{exc}")


if __name__ == "__main__":
    main()
