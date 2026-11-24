"""One explicit real Tencent motion generation; never print keys or signed URLs."""
import argparse
import asyncio
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "motion-service"))


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="build/tencent-fbx-qa.fbx")
    parser.add_argument("--prompt", default="A standing person waves hello gently with the right hand.")
    parser.add_argument("--duration", type=float)
    args = parser.parse_args()
    configured = Path(os.environ.get("LOCALAPPDATA", "")) / "com.deskaura.app" / "config.json"
    if configured.exists():
        os.environ["DESKAURA_CONFIG_PATH"] = str(configured)
    from app.role_config import CURRENT_ROLE, active_role
    from app.tencent_motion import TencentMotionProvider
    from app.main import _cache_tencent_fbx, fbx_results
    CURRENT_ROLE.set(active_role())
    provider = TencentMotionProvider()
    result = await provider.generate(args.prompt, args.duration)
    ident, duration = await _cache_tencent_fbx(result)
    output = (ROOT / args.output).resolve()
    if not output.is_relative_to(ROOT / "build"):
        raise RuntimeError("QA outputs must remain under build")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(fbx_results[ident]["bytes"])
    print(json.dumps({"output": str(output), "bytes": output.stat().st_size,
                      "duration_source": result["duration_source"], "requested_duration": duration}))


if __name__ == "__main__":
    asyncio.run(main())
