"""Lazy, bounded CPU inference using explicitly bundled model assets.

This module never downloads a model or accesses an API. ONNX/tokenizer imports
are lazy so cloud-only configurations do not load the local inference runtime.
"""

from __future__ import annotations

import importlib.util
import io
import os
from pathlib import Path
import re
import sys
import threading
import wave

EMBEDDING_MODEL = "bge-small-zh-v1.5-int8"
HEARING_MODEL = "SenseVoiceSmall-int8"
_embedding_lock = threading.RLock()
_hearing_lock = threading.RLock()
_embedding_cache: tuple | None = None
_hearing_cache: tuple | None = None
_FILES = {
    "embedding": ("embedding/model_quantized.onnx", "embedding/tokenizer.json"),
    "hearing": ("hearing/model.int8.onnx", "hearing/tokens.txt"),
}
_PACKAGES = {"embedding": ("onnxruntime", "tokenizers"), "hearing": ("sherpa_onnx",)}


def model_directory() -> Path:
    """Locate the distribution's model directory without consulting the web."""
    configured = os.getenv("DESKAURA_LOCAL_MODELS_DIR", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent / "local-models"
    return Path(__file__).resolve().parents[1] / "local-models"


def model_available(kind: str) -> bool:
    """Inspect files/dependencies only; availability is not a successful probe."""
    if kind not in _FILES:
        return False
    root = model_directory()
    return all((root / name).is_file() and (root / name).stat().st_size > 0 for name in _FILES[kind]) and all(
        importlib.util.find_spec(name) is not None for name in _PACKAGES[kind]
    )


def _assets(kind: str) -> tuple[tuple, list[Path]]:
    root = model_directory()
    paths = [root / name for name in _FILES[kind]]
    if not all(path.is_file() and path.stat().st_size > 0 for path in paths):
        raise RuntimeError("内置模型文件缺失，请使用包含本地模型的完整安装包")
    key = tuple((str(path.resolve()), path.stat().st_size, path.stat().st_mtime_ns) for path in paths)
    return key, paths


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Produce normalized BGE CLS vectors, in bounded batches on the CPU."""
    if not isinstance(texts, list) or not texts or len(texts) > 256 or any(
        not isinstance(text, str) or len(text) > 100000 for text in texts
    ):
        raise ValueError("内置向量输入必须为 1–256 段有效文本")
    global _embedding_cache
    with _embedding_lock:
        import numpy as np
        import onnxruntime as ort
        from tokenizers import Tokenizer

        key, paths = _assets("embedding")
        if _embedding_cache is None or _embedding_cache[0] != key:
            options = ort.SessionOptions()
            options.intra_op_num_threads = max(1, min(2, os.cpu_count() or 1))
            options.inter_op_num_threads = 1
            session = ort.InferenceSession(str(paths[0]), sess_options=options, providers=["CPUExecutionProvider"])
            tokenizer = Tokenizer.from_file(str(paths[1]))
            tokenizer.enable_truncation(max_length=512)
            tokenizer.enable_padding(pad_id=0, pad_token="[PAD]")
            _embedding_cache = (key, session, tokenizer)
        _, session, tokenizer = _embedding_cache
        vectors: list[list[float]] = []
        for offset in range(0, len(texts), 8):
            encoded = tokenizer.encode_batch(texts[offset:offset + 8])
            data = {
                "input_ids": np.asarray([item.ids for item in encoded], dtype=np.int64),
                "attention_mask": np.asarray([item.attention_mask for item in encoded], dtype=np.int64),
                "token_type_ids": np.asarray([item.type_ids for item in encoded], dtype=np.int64),
            }
            feeds = {item.name: data[item.name] for item in session.get_inputs()}
            output = np.asarray(session.run(None, feeds)[0])
            # BGE's exported model returns last_hidden_state. CLS pooling is
            # prescribed by its model card; mean pooling would change retrieval.
            pooled = output[:, 0, :] if output.ndim == 3 else output
            if pooled.ndim != 2 or pooled.shape[0] != len(encoded) or pooled.shape[1] < 1:
                raise RuntimeError("内置向量模型输出维度无效")
            pooled = pooled.astype(np.float32)
            norms = np.linalg.norm(pooled, axis=1, keepdims=True)
            if not np.isfinite(pooled).all() or not np.isfinite(norms).all() or np.any(norms <= 0):
                raise RuntimeError("内置向量模型未返回有效向量")
            vectors.extend((pooled / norms).tolist())
        return vectors


def transcribe_wav(audio: bytes, language: str = "") -> str:
    """Transcribe PCM16 WAV locally; keep original wording rather than rewrite."""
    import numpy as np

    if not isinstance(audio, bytes) or len(audio) > 8 * 1024 * 1024:
        raise ValueError("录音必须为不超过 8 MB 的 PCM WAV")
    lang = str(language or "auto").lower()
    if lang not in {"auto", "zh", "en", "ja", "ko", "yue"}:
        raise ValueError("内置识别支持自动、中文、英语、日语、韩语和粤语")
    try:
        with wave.open(io.BytesIO(audio), "rb") as source:
            rate, channels = source.getframerate(), source.getnchannels()
            if source.getsampwidth() != 2 or channels not in {1, 2} or not 8000 <= rate <= 48000:
                raise ValueError("内置识别需要 8–48 kHz 的单/双声道 PCM16 WAV")
            if not 0 < source.getnframes() / rate <= 120:
                raise ValueError("录音时长必须在 0–120 秒内")
            samples = np.frombuffer(source.readframes(source.getnframes()), dtype="<i2").astype(np.float32) / 32768.0
        if channels == 2:
            samples = samples.reshape(-1, 2).mean(axis=1)
        if rate != 16000:
            new_length = round(len(samples) * 16000 / rate)
            samples = np.interp(np.arange(new_length) * rate / 16000, np.arange(len(samples)), samples).astype(np.float32)
        if not samples.size or not np.isfinite(samples).all():
            raise ValueError("录音没有有效采样")
    except (wave.Error, EOFError, OSError, OverflowError):
        raise ValueError("录音 WAV 数据无效") from None
    global _hearing_cache
    with _hearing_lock:
        import sherpa_onnx

        key, paths = _assets("hearing")
        signature = key, lang
        if _hearing_cache is None or _hearing_cache[0] != signature:
            recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
                model=str(paths[0]), tokens=str(paths[1]), num_threads=max(1, min(2, os.cpu_count() or 1)),
                sample_rate=16000, provider="cpu", language=lang, use_itn=False, debug=False,
            )
            _hearing_cache = (signature, recognizer)
        recognizer = _hearing_cache[1]
        stream = recognizer.create_stream()
        stream.accept_waveform(16000, samples)
        recognizer.decode_stream(stream)
        text = str(stream.result.text).strip()
        # Some SenseVoice exports include nonlinguistic event markers.
        return re.sub(r"<\|[^|<>]{1,80}\|>", "", text).strip()
