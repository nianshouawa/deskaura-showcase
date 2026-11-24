#!/bin/bash
# Standard model; Lite checkpoint and its backed-up launcher remain available.
cd /root/autodl-tmp/HY-Motion-1.0 || exit 1
export HY_MOTION_MODEL_PATH=/root/autodl-tmp/standard-stage/HY-Motion-1.0
export USE_HF_MODELS=0
export HY_CKPT_DIR=/root/autodl-tmp/HY-Motion-1.0/ckpts
# Text2MotionPrompter is not installed: use manual duration, do not fake prediction.
export HY_PROMPT_ENGINEERING=0
exec /root/miniconda3/bin/python /root/autodl-tmp/deskaura_worker_seed.py --port 6006
