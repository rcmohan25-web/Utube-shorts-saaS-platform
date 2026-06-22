"""Downloads a YouTube video with yt-dlp. Stage 2 of the pipeline, §6.1."""
import os
import yt_dlp


def download_video(youtube_url: str, video_id: str, tmp_dir: str) -> str:
    out_dir = os.path.join(tmp_dir, video_id)
    os.makedirs(out_dir, exist_ok=True)
    out_template = os.path.join(out_dir, "video.%(ext)s")

    ydl_opts = {
        "format": "bestvideo+bestaudio/best",
        "outtmpl": out_template,
        "merge_output_format": "mp4",
        "quiet": True,
        "noprogress": True,
    }

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([youtube_url])

    final_path = os.path.join(out_dir, "video.mp4")
    if not os.path.exists(final_path):
        # yt-dlp may keep the original extension if merge isn't needed.
        for f in os.listdir(out_dir):
            if f.startswith("video."):
                final_path = os.path.join(out_dir, f)
                break
    return final_path
