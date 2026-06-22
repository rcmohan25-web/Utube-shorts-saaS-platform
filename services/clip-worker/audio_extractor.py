"""Extracts 16kHz mono audio for Whisper. Stage 3 of the pipeline, §6.1."""
import os
import subprocess


def extract_audio(video_path: str, video_id: str, tmp_dir: str) -> str:
    out_dir = os.path.join(tmp_dir, video_id)
    audio_path = os.path.join(out_dir, "audio.wav")

    cmd = [
        "ffmpeg", "-y", "-i", video_path,
        "-vn", "-ac", "1", "-ar", "16000",
        audio_path,
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    return audio_path
