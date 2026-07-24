"""FastAPI worker — receives download jobs (yt-dlp + ffmpeg) and clip-
detection jobs (PySceneDetect + GPT-4o scoring), and calls back to the
NestJS API with the results.

This is an HTTP service, not a BullMQ consumer (ADR-002): NestJS's
VideoDownloadProcessor and ClipDetectionProcessor POST jobs here; we do the
work and call back over HTTP.
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

from downloader import download_video
from audio_extractor import extract_audio
from s3_client import upload_file, download_file
from scene_detector import detect_scene_changes, build_segments
from clip_scorer import score_segments

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("clip-worker")

app = FastAPI(title="clip-worker")

TMP_DIR = os.environ.get("TMP_DIR", "/tmp/shorts-worker")
API_BASE_URL = os.environ.get("API_BASE_URL", "http://localhost:3001/api/v1")
API_INTERNAL_SECRET = os.environ.get("API_INTERNAL_SECRET", "")


class DownloadJob(BaseModel):
    videoId: str
    youtubeUrl: str
    organizationId: str


class DetectClipsJob(BaseModel):
    videoId: str
    organizationId: str
    rawVideoS3Key: str
    audioS3Key: str
    transcriptS3Key: str
    videoTitle: str


async def patch_video_status(video_id: str, payload: dict):
    headers = {"x-internal-secret": API_INTERNAL_SECRET}
    async with httpx.AsyncClient() as client:
        try:
            logger.info("sending status callback for %s: %s", video_id, payload)
            res = await client.patch(
                f"{API_BASE_URL}/videos/{video_id}/status",
                json=payload,
                headers=headers,
                timeout=30,
            )
            logger.info("status callback response for %s: %s %s", video_id, res.status_code, res.text)
            if res.status_code >= 400:
                raise RuntimeError(f"status callback failed for {video_id}: {res.status_code} {res.text}")
            return res
        except httpx.HTTPError as exc:
            logger.error("status callback failed for %s: %s", video_id, exc)
            raise


async def post_clips(video_id: str, organization_id: str, clips: list[dict]):
    headers = {"x-internal-secret": API_INTERNAL_SECRET}
    async with httpx.AsyncClient() as client:
        try:
            logger.info("sending clips callback for %s (%d clips)", video_id, len(clips))
            res = await client.post(
                f"{API_BASE_URL}/videos/{video_id}/clips",
                json={"organizationId": organization_id, "clips": clips},
                headers=headers,
                timeout=30,
            )
            logger.info("clips callback response for %s: %s %s", video_id, res.status_code, res.text)
            return res
        except httpx.HTTPError as exc:
            logger.error("clip callback failed for %s: %s", video_id, exc)
            raise


def run_download_pipeline(job: DownloadJob):
    video_dir = os.path.join(TMP_DIR, job.videoId)
    logger.info("starting download pipeline for %s", job.videoId)
    try:
        asyncio.run(patch_video_status(job.videoId, {
            "status": "DOWNLOADING",
            "organizationId": job.organizationId,
        }))

        video_path = download_video(job.youtubeUrl, job.videoId, TMP_DIR)
        logger.info("download complete for %s, video_path=%s", job.videoId, video_path)

        raw_key = f"{job.organizationId}/raw-videos/{job.videoId}/video.mp4"
        upload_file(video_path, raw_key)
        logger.info("uploaded raw video for %s to %s", job.videoId, raw_key)

        audio_path = extract_audio(video_path, job.videoId, TMP_DIR)
        logger.info("audio extracted for %s, audio_path=%s", job.videoId, audio_path)

        audio_key = f"{job.organizationId}/raw-videos/{job.videoId}/audio.wav"
        upload_file(audio_path, audio_key)
        logger.info("uploaded audio for %s to %s", job.videoId, audio_key)

        asyncio.run(patch_video_status(job.videoId, {
            "status": "DOWNLOADED",
            "organizationId": job.organizationId,
            "rawVideoS3Key": raw_key,
            "audioS3Key": audio_key,
        }))
        logger.info("download pipeline finished for %s", job.videoId)
    except Exception as exc:  # noqa: BLE001 — report every failure, never swallow
        logger.exception("download pipeline failed for %s", job.videoId)
        try:
            asyncio.run(patch_video_status(job.videoId, {
                "status": "FAILED",
                "organizationId": job.organizationId,
                "errorMessage": str(exc),
            }))
        except Exception:
            logger.exception("failed to report FAILED status for %s", job.videoId)
    finally:
        shutil.rmtree(video_dir, ignore_errors=True)


def run_detection_pipeline(job: DetectClipsJob):
    work_dir = os.path.join(TMP_DIR, f"detect-{job.videoId}")
    os.makedirs(work_dir, exist_ok=True)
    logger.info("starting clip detection pipeline for %s", job.videoId)
    try:
        video_path = os.path.join(work_dir, "video.mp4")
        download_file(job.rawVideoS3Key, video_path)
        logger.info("downloaded raw video for detection %s", job.videoId)

        audio_path = os.path.join(work_dir, "audio.wav")
        download_file(job.audioS3Key, audio_path)
        logger.info("downloaded audio for detection %s", job.videoId)

        transcript_path = os.path.join(work_dir, "transcript.json")
        download_file(job.transcriptS3Key, transcript_path)
        logger.info("downloaded transcript for detection %s", job.videoId)

        with open(transcript_path) as f:
            transcript = json.load(f)
        words = transcript.get("words", [])
        duration = max((w["end"] for w in words), default=0)

        scene_changes = detect_scene_changes(video_path)
        segments = build_segments(words, duration, scene_changes, audio_path)

        scored = score_segments(job.videoTitle, segments) if segments else []
        logger.info("scored %d segments for %s", len(scored), job.videoId)

        # Map GPT-4o's segmentIndex back to the segment's transcript text,
        # take the top 5 (§20.11 Day 8-9), shape for POST /videos/:id/clips.
        by_index = {s["index"]: s for s in segments}
        clips = []
        for c in scored[:5]:
            segment = by_index.get(c.get("segmentIndex"))
            clips.append({
                "startSeconds": c.get("startSeconds", segment["startSeconds"] if segment else 0),
                "endSeconds": c.get("endSeconds", segment["endSeconds"] if segment else 0),
                "confidenceScore": c.get("confidenceScore", 0),
                "transcriptSegment": segment["transcript"] if segment else None,
                "aiReasoning": c.get("reasoning"),
                "suggestedTitle": c.get("suggestedTitle"),
                "suggestedHashtags": c.get("hashtags", []),
            })

        asyncio.run(post_clips(job.videoId, job.organizationId, clips))
        logger.info("clip detection pipeline finished for %s", job.videoId)
    except Exception:  # noqa: BLE001
        logger.exception("clip detection failed for %s", job.videoId)
        asyncio.run(post_clips(job.videoId, job.organizationId, []))
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


@app.post("/jobs/download")
async def enqueue_download(job: DownloadJob, background_tasks: BackgroundTasks):
    logger.info("received download job %s", job.videoId)
    background_tasks.add_task(run_download_pipeline, job)
    return {"accepted": True, "videoId": job.videoId}


@app.post("/jobs/detect-clips")
async def enqueue_detect_clips(job: DetectClipsJob, background_tasks: BackgroundTasks):
    logger.info("received detect-clips job %s", job.videoId)
    background_tasks.add_task(run_detection_pipeline, job)
    return {"accepted": True, "videoId": job.videoId}


@app.get("/health")
async def health():
    return {"status": "ok"}
