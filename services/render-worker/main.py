"""FastAPI worker — receives a render job, extracts the clip from the source
video, crops it to 9:16 with face-centered framing, burns in word-pop
captions, optionally overlays branding, encodes the final MP4, generates a
thumbnail, uploads everything to S3/R2, and calls back to the NestJS API
with the result.

This is an HTTP service, not a BullMQ consumer (ADR-002): the NestJS-side
RenderProcessor POSTs the job here; we do the work and POST the final Short
record back over HTTP — render-worker never touches Postgres directly.
"""
import os
import json
import shutil
import logging
import asyncio

import httpx
from fastapi import FastAPI, BackgroundTasks
from pydantic import BaseModel
from dotenv import load_dotenv

from ffmpeg_utils import run_ffmpeg
from vertical_cropper import build_vertical_crop_command
from caption_generator import write_ass_file
from s3_client import download_file, upload_file

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("render-worker")

app = FastAPI(title="render-worker")

TMP_DIR = os.environ.get("TMP_DIR", "/tmp/shorts-worker")
API_BASE_URL = os.environ.get("API_BASE_URL", "http://localhost:3001/api/v1")
API_INTERNAL_SECRET = os.environ.get("API_INTERNAL_SECRET", "")


class RenderJob(BaseModel):
    shortId: str
    clipId: str
    organizationId: str
    channelId: str
    videoS3Key: str
    transcriptS3Key: str
    startSeconds: float
    endSeconds: float
    title: str
    hashtags: list[str] = []
    brandLogoS3Key: str | None = None
    brandColor: str | None = None


async def report_short(payload: dict):
    headers = {"x-internal-secret": API_INTERNAL_SECRET}
    async with httpx.AsyncClient() as client:
        try:
            await client.post(f"{API_BASE_URL}/shorts", json=payload, headers=headers, timeout=30)
        except httpx.HTTPError as exc:
            logger.error("short callback failed for %s: %s", payload.get("shortId"), exc)


def run_pipeline(job: RenderJob):
    work_dir = os.path.join(TMP_DIR, job.shortId)
    os.makedirs(work_dir, exist_ok=True)

    try:
        # Inputs
        video_path = os.path.join(work_dir, "source.mp4")
        download_file(job.videoS3Key, video_path)
        transcript_path = os.path.join(work_dir, "transcript.json")
        download_file(job.transcriptS3Key, transcript_path)
        with open(transcript_path) as f:
            transcript = json.load(f)

        duration = job.endSeconds - job.startSeconds

        # Stage 7: lossless clip extraction (stream copy)
        clip_path = os.path.join(work_dir, "clip.mp4")
        run_ffmpeg([
            "ffmpeg", "-y", "-ss", str(job.startSeconds), "-i", video_path,
            "-t", str(duration), "-c", "copy", clip_path,
        ])

        # Stage 8+9: face-centered 9:16 crop (§6.3)
        vertical_path = os.path.join(work_dir, "vertical.mp4")
        run_ffmpeg(build_vertical_crop_command(clip_path, vertical_path))

        # Stage 10: word-pop ASS captions, re-zeroed to the clip's own
        # timeline (§6.4) — transcript timestamps are absolute to the
        # source video, so they need shifting back by startSeconds.
        ass_path = os.path.join(work_dir, "short.ass")
        words_in_clip = [
            w for w in transcript.get("words", [])
            if w["start"] >= job.startSeconds and w["end"] <= job.endSeconds
        ]
        write_ass_file(words_in_clip, job.startSeconds, ass_path)

        # Stage 11+13: burn captions + final encode (H.264 CRF23 + AAC) in one pass
        captioned_path = os.path.join(work_dir, "captioned.mp4")
        run_ffmpeg([
            "ffmpeg", "-y", "-i", vertical_path,
            "-vf", f"subtitles={ass_path}",
            "-c:v", "libx264", "-crf", "23", "-c:a", "aac",
            captioned_path,
        ])

        # Stage 12: branding overlay — optional, only if the org has a logo
        # configured. (Spec calls for MoviePy here; skipped in favor of a
        # single FFmpeg overlay filter since there's no Settings UI yet to
        # actually upload a logo — see PR-03-NOTES.md.)
        final_path = captioned_path
        if job.brandLogoS3Key:
            logo_path = os.path.join(work_dir, "logo.png")
            download_file(job.brandLogoS3Key, logo_path)
            branded_path = os.path.join(work_dir, "branded.mp4")
            run_ffmpeg([
                "ffmpeg", "-y", "-i", captioned_path, "-i", logo_path,
                "-filter_complex", "overlay=W-w-24:24",
                "-c:v", "libx264", "-crf", "23", "-c:a", "copy",
                branded_path,
            ])
            final_path = branded_path

        # Stage 14: thumbnail — plain ffmpeg frame grab (no Pillow overlay yet)
        thumb_path = os.path.join(work_dir, "thumbnail.jpg")
        run_ffmpeg([
            "ffmpeg", "-y", "-ss", str(duration * 0.35), "-i", final_path,
            "-frames:v", "1", "-vf", "scale=1280:720", thumb_path,
        ])

        # Per §10.1: renders/{shortId}/... — shortId is pre-generated by
        # ClipsService.approve() specifically so this path is known up front.
        render_key = f"{job.organizationId}/renders/{job.shortId}/short.mp4"
        thumb_key = f"{job.organizationId}/renders/{job.shortId}/thumbnail.jpg"
        caption_key = f"{job.organizationId}/renders/{job.shortId}/short.ass"
        upload_file(final_path, render_key)
        upload_file(thumb_path, thumb_key)
        upload_file(ass_path, caption_key)

        asyncio.run(report_short({
            "shortId": job.shortId,
            "clipId": job.clipId,
            "channelId": job.channelId,
            "organizationId": job.organizationId,
            "title": job.title,
            "tags": job.hashtags,
            "status": "REVIEW",
            "renderS3Key": render_key,
            "thumbnailS3Key": thumb_key,
            "captionS3Key": caption_key,
        }))
    except Exception as exc:  # noqa: BLE001 — report every failure, never swallow
        logger.exception("render failed for short %s", job.shortId)
        asyncio.run(report_short({
            "shortId": job.shortId,
            "clipId": job.clipId,
            "channelId": job.channelId,
            "organizationId": job.organizationId,
            "title": job.title,
            "tags": job.hashtags,
            "status": "FAILED",
            "errorMessage": str(exc),
        }))
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


@app.post("/jobs/render")
async def enqueue_render(job: RenderJob, background_tasks: BackgroundTasks):
    background_tasks.add_task(run_pipeline, job)
    return {"accepted": True, "shortId": job.shortId}


@app.get("/health")
async def health():
    return {"status": "ok"}
