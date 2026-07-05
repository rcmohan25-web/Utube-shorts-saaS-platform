"""Small subprocess wrapper so every ffmpeg call fails loudly and consistently."""
import subprocess


def run_ffmpeg(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True, capture_output=True)
