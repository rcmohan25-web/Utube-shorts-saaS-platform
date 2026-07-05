"""Scene boundary detection + candidate segment building. §6.1 stage 5.

Builds the `segments` array that clip_scorer.score_segments() sends to
GPT-4o — each one a sliding window over the transcript, annotated with how
many scene cuts and how loud the audio was in that window.
"""
import wave
import numpy as np
from scenedetect import open_video, SceneManager
from scenedetect.detectors import AdaptiveDetector

WINDOW_SECONDS = 60
STEP_SECONDS = 30
MIN_SEGMENT = 45
MAX_SEGMENT = 90


def detect_scene_changes(video_path: str) -> list[float]:
    video = open_video(video_path)
    scene_manager = SceneManager()
    scene_manager.add_detector(AdaptiveDetector())  # §6.1: AdaptiveDetector for mixed content
    scene_manager.detect_scenes(video)
    return [scene[0].get_seconds() for scene in scene_manager.get_scene_list()]


def _audio_rms(audio_path: str, start: float, end: float) -> float:
    """Rough average amplitude (RMS, normalized 0-1) for a time window of a
    16kHz mono WAV — just enough signal for clip_scorer's avgAmplitude
    field, not a precise loudness measurement."""
    try:
        with wave.open(audio_path, "rb") as wav:
            rate = wav.getframerate()
            wav.setpos(max(0, int(start * rate)))
            n_frames = max(0, int((end - start) * rate))
            raw = wav.readframes(n_frames)
            if not raw:
                return 0.0
            samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32)
            return float(np.sqrt(np.mean(samples**2)) / 32768.0) if samples.size else 0.0
    except Exception:
        return 0.0


def build_segments(
    words: list[dict],
    video_duration: float,
    scene_changes: list[float],
    audio_path: str,
) -> list[dict]:
    """Slides a WINDOW_SECONDS window across the transcript every
    STEP_SECONDS, capped to MAX_SEGMENT, and annotates each with scene-cut
    count + average amplitude for the GPT-4o prompt (§6.2)."""
    segments = []
    index = 0
    t = 0.0

    while t < video_duration - MIN_SEGMENT:
        start = t
        end = min(t + WINDOW_SECONDS, video_duration, start + MAX_SEGMENT)
        if end - start < MIN_SEGMENT:
            break

        segment_words = [w for w in words if w["start"] >= start and w["end"] <= end]
        transcript = " ".join(w["word"].strip() for w in segment_words)
        scene_count = sum(1 for s in scene_changes if start <= s <= end)

        segments.append({
            "index": index,
            "startSeconds": round(start, 2),
            "endSeconds": round(end, 2),
            "transcript": transcript,
            "sceneChanges": scene_count,
            "avgAmplitude": round(_audio_rms(audio_path, start, end), 4),
        })

        index += 1
        t += STEP_SECONDS

    return segments
