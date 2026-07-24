"""FastAPI worker — receives a transcription job, runs Faster-Whisper with
word-level timestamps, uploads transcript.json to S3/R2, and calls back to
the NestJS API with the result.

This is an HTTP service, not a BullMQ consumer (ADR-002): the NestJS-side
TranscriptionProcessor (apps/api/src/queues/processors/transcription.processor.ts)
POSTs the job here; we do the work and PATCH the status back over HTTP —
same shape as services/clip-worker/main.py.
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

from whisper_service import transcribe
from s3_client import download_file, upload_file

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("transcription-worker")

app = FastAPI(title="transcription-worker")

TMP_DIR = os.environ.get("TMP_DIR", "/tmp/shorts-worker")
API_BASE_URL = os.environ.get("API_BASE_URL", "http://localhost:3001/api/v1")
API_INTERNAL_SECRET = os.environ.get("API_INTERNAL_SECRET", "")


class TranscribeJob(BaseModel):
    videoId: str
    audioS3Key: str
    organizationId: str


async def report_status(video_id: str, payload: dict):
    headers = {"x-internal-secret": API_INTERNAL_SECRET}
    async with httpx.AsyncClient() as client:
        try:
            res = await client.patch(
                f"{API_BASE_URL}/videos/{video_id}/status",
                json=payload,
                headers=headers,
                timeout=30,
            )
            if res.status_code >= 400:
                logger.error("status callback failed for %s: %s %s", video_id, res.status_code, res.text)
                raise RuntimeError(f"status callback failed for {video_id}: {res.status_code} {res.text}")
        except httpx.HTTPError as exc:
            logger.error("status callback failed for %s: %s", video_id, exc)
            raise


def run_pipeline(job: TranscribeJob):
    work_dir = os.path.join(TMP_DIR, job.videoId)
    os.makedirs(work_dir, exist_ok=True)
    audio_path = os.path.join(work_dir, "audio.wav")

    try:
        asyncio.run(report_status(job.videoId, {
            "status": "TRANSCRIBING",
            "organizationId": job.organizationId,
        }))

        download_file(job.audioS3Key, audio_path)

        result = transcribe(audio_path)  # {"words": [...], "language": "en"}

        transcript_path = os.path.join(work_dir, "transcript.json")
        with open(transcript_path, "w") as f:
            json.dump(result, f)

        # Per §10.1 bucket layout: raw-videos/{videoId}/transcript.json, never deleted.
        transcript_key = f"{job.organizationId}/raw-videos/{job.videoId}/transcript.json"
        upload_file(transcript_path, transcript_key)

        asyncio.run(report_status(job.videoId, {
            "status": "READY",
            "organizationId": job.organizationId,
            "transcriptS3Key": transcript_key,
        }))
    except Exception as exc:  # noqa: BLE001 — report every failure, never swallow
        logger.exception("transcription failed for %s", job.videoId)
        asyncio.run(report_status(job.videoId, {
            "status": "FAILED",
            "organizationId": job.organizationId,
            "errorMessage": str(exc),
        }))
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


@app.post("/jobs/transcribe")
async def enqueue_transcribe(job: TranscribeJob, background_tasks: BackgroundTasks):
    # Accept immediately, do the real work in the background, report
    # progress via the status callback — mirrors clip-worker's /jobs/download.
    background_tasks.add_task(run_pipeline, job)
    return {"accepted": True, "videoId": job.videoId}


@app.get("/health")
async def health():
    return {"status": "ok"}
