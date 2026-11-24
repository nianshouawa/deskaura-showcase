#!/usr/bin/env python3
"""HY-Motion worker: load the configured standard or Lite model on a GPU host.

Endpoints:
  GET  /health   -> {"status": "ok"/"loading"/"error", ...}
  POST /generate -> {"prompt": "...", "duration": 2.0}
                    -> {"poses": [...], "fps": 30, "trans": [...], "duration": ..., "num_frames": ...}

Each pose frame is 52 joints x 3 axis-angle (SMPL-H) = 156 floats.
Each trans frame is a 3D translation.
"""

import os
import sys
import json
import argparse
import threading
import math

PROJECT_DIR = os.environ.get("HY_MOTION_PROJECT_DIR", "/root/autodl-tmp/HY-Motion-1.0")
sys.path.insert(0, PROJECT_DIR)

os.environ.setdefault("USE_HF_MODELS", "0")

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
import uvicorn
import numpy as np


FPS = 30
# HY-Motion-1.0-Lite 训练于 train_frames=360（12s @30fps）。pipeline 把请求的
# length 夹到 [min(train_frames,20), train_frames] = [20, 360] 帧，即真实可生成
# 时长 0.67s ~ 12s。duration_slider 单位是「秒」，length 单位是「帧」。
# 报错里的 166.67 是 5000/fps 的「秒」数，不是帧，别再当成帧上限。
TRAIN_FRAMES = 360
MIN_FRAMES = 20
MAX_SECONDS = TRAIN_FRAMES / FPS  # 12.0
MIN_SECONDS = 0.5


class GenerateRequest(BaseModel):
    prompt: str
    duration: float | None = None
    seed: int = Field(default=0, ge=0, le=2147483647)
    cfg_scale: float = Field(default=5.0, ge=1.0, le=7.0)


app = FastAPI(title="HY-Motion Worker")

_runtime = None
_runtime_lock = threading.Lock()
_model_path = os.environ.get("HY_MOTION_MODEL_PATH", "")


def get_runtime():
    global _runtime
    if _runtime is None:
        raise RuntimeError("model not loaded yet")
    return _runtime


def load_model():
    global _runtime
    from hymotion.utils.t2m_runtime import T2MRuntime

    model_path = _model_path or os.path.join(
        PROJECT_DIR, "ckpts", "tencent", "HY-Motion-1.0-Lite"
    )
    cfg = os.path.join(model_path, "config.yml")
    ckpt = os.path.join(model_path, "latest.ckpt")
    if not os.path.exists(cfg):
        raise FileNotFoundError(f"config.yml not found: {cfg}")
    if not os.path.exists(ckpt):
        raise FileNotFoundError(f"latest.ckpt not found: {ckpt}")

    # HY_PROMPT_ENGINEERING=1 启用原生 PromptRewriter（文本重写 + 时长预测，更耗显存）。
    # 自动时长模式依赖它，因此云端启动脚本应设为 1。
    disable_pe = os.environ.get("HY_PROMPT_ENGINEERING", "0").strip().lower() not in {
        "1", "true", "yes", "on"
    }
    print(
        f"[worker] loading model from {model_path} (disable_prompt_engineering={disable_pe})",
        flush=True,
    )
    _runtime = T2MRuntime(
        config_path=cfg,
        ckpt_name=ckpt,
        disable_prompt_engineering=disable_pe,
        prompt_engineering_host=os.environ.get('HY_PROMPTER_HOST') or None,
        prompt_engineering_model_path=os.environ.get('HY_PROMPTER_MODEL_PATH') or None,
    )
    print("[worker] model loaded", flush=True)


def _extract_poses(model_output):
    """Extract SMPL-H 52-joint axis-angle + translation from model_output.

    model_output["rot6d"]: (batch, frames, 52, 6)
    model_output["transl"]: (batch, frames, 3)
    """
    from hymotion.pipeline.body_model import construct_smpl_data_dict

    rot6d = model_output["rot6d"]
    transl = model_output["transl"]
    batch = rot6d.shape[0]

    all_poses = []
    all_trans = []
    for bb in range(batch):
        smpl = construct_smpl_data_dict(rot6d[bb].clone(), transl[bb].clone())
        poses = np.asarray(smpl["poses"], dtype=np.float32)  # (frames, 156)
        trans = np.asarray(smpl["trans"], dtype=np.float32)  # (frames, 3)
        all_poses.append(poses)
        all_trans.append(trans)

    return all_poses, all_trans


@app.get("/health")
def health():
    if _runtime is None:
        return {"status": "loading", "model_path": _model_path}
    return {"status": "ok", "model_path": _model_path,
            "automatic_duration": _runtime.prompt_rewriter is not None,
            "duration_engine": 'HY-Motion Text2MotionPrompter' if _runtime.prompt_rewriter is not None else None}


@app.post("/generate")
def generate(req: GenerateRequest):
    runtime = get_runtime()

    if not req.prompt.strip():
        raise HTTPException(status_code=400, detail="prompt is empty")

    # auto（未传 duration）交给 HY-Motion 自带时长预测；manual 才按秒数换算帧。
    auto_duration = req.duration is None
    if auto_duration:
        if runtime.prompt_rewriter is None:
            raise HTTPException(status_code=409, detail='Automatic duration requires HY-Motion PromptRewriter; use manual duration or install the prompter')
        try:
            with _runtime_lock:
                predicted, rewritten = runtime.rewrite_text_and_infer_time(req.prompt)
            predicted = float(predicted)
            if not math.isfinite(predicted) or predicted <= 0 or not isinstance(rewritten, str) or not rewritten.strip():
                raise ValueError('Native predictor returned invalid duration or text')
            duration = max(MIN_SECONDS, min(predicted, MAX_SECONDS))
            prompt = rewritten.strip()
        except Exception:
            raise HTTPException(status_code=502, detail='HY-Motion duration prediction failed; choose manual duration') from None
        target = max(MIN_FRAMES, min(int(round(duration * FPS)), TRAIN_FRAMES))
    else:
        if not math.isfinite(req.duration):
            raise HTTPException(status_code=422, detail='duration must be finite')
        duration = max(MIN_SECONDS, min(float(req.duration), MAX_SECONDS))
        prompt = req.prompt
        target = max(MIN_FRAMES, min(int(round(duration * FPS)), TRAIN_FRAMES))
    seeds = [req.seed]

    try:
        import torch
        pi = runtime._acquire_pipeline()
        try:
            pipeline = runtime.pipelines[pi]
            pipeline.eval()
            model_output = pipeline.generate(
                prompt,
                seeds,
                duration_slider=duration,
                cfg_scale=req.cfg_scale,
                use_special_game_feat=False,
                length=target,
            )
        finally:
            runtime._release_pipeline(pi)

        poses, trans = _extract_poses(model_output)

        return {
            "fps": FPS,
            "duration": float(poses[0].shape[0]) / FPS,
            "poses": poses[0].tolist(),
            "trans": trans[0].tolist(),
            "num_frames": int(poses[0].shape[0]),
            "seed": req.seed,
            "cfg_scale": req.cfg_scale,
            "duration_source": 'hymotion_native' if auto_duration else 'manual',
            "duration_engine": 'HY-Motion Text2MotionPrompter' if auto_duration else None,
            "model": os.path.basename(_model_path.rstrip('/')) if _model_path else 'HY-Motion-1.0-Lite',
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="HY-Motion worker")
    parser.add_argument("--port", type=int, default=8010, help="服务端口")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="监听地址")
    args = parser.parse_args()

    load_model()
    print(f"[worker] serving on {args.host}:{args.port}", flush=True)
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")
