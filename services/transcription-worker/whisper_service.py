"""Faster-Whisper wrapper. Stage 4 of the pipeline, §6.1.

The model loads once at import time (module-level singleton) — reloading a
multi-hundred-MB-to-multi-GB model per request would blow the <5min SLA on
its own.
"""
import os
from faster_whisper import WhisperModel

# §20.8 runbook: drop to 'medium' if large-v3 OOMs (large-v3 wants ~8GB RAM).
# Defaulting to 'medium' here since that's what the Day-6 dev plan (§20.10)
# ships with for CPU boxes — bump to large-v3 + a GPU node for production,
# per §19.2's cost estimate (GPU node ~$300/mo, 10x faster transcription).
MODEL_SIZE = os.environ.get("WHISPER_MODEL", "medium")
DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")

_model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)


def transcribe(audio_path: str) -> dict:
    segments, info = _model.transcribe(audio_path, word_timestamps=True)

    words = [
        {"word": w.word, "start": w.start, "end": w.end, "probability": w.probability}
        for segment in segments
        for w in (segment.words or [])
    ]

    return {"words": words, "language": info.language}
