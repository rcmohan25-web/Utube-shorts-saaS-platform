"""FastAPI worker — receives a download job, runs yt-dlp + ffmpeg, uploads to
S3/R2, and calls back to the NestJS API with the result. This is an HTTP
service, not a BullMQ consumer (see ADR-002: NestJS dispatches, Python
processes, Python calls back over HTTP)."""
import os
import shutil
import logging
import json
import threading
import time

import httpx
import redis
from fastapi import FastAPI, BackgroundTasks
from pydantic import BaseModel
from dotenv import load_dotenv

from downloader import download_video
from audio_extractor import extract_audio
from s3_client import upload_file

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("clip-worker")

app = FastAPI(title="clip-worker")

TMP_DIR = os.environ.get("TMP_DIR", "/tmp/shorts-worker")
API_BASE_URL = os.environ.get("API_BASE_URL", "http://localhost:3001/api/v1")
API_INTERNAL_SECRET = os.environ.get("API_INTERNAL_SECRET", "")
REDIS_HOST = os.environ.get("REDIS_HOST", "localhost")
REDIS_PORT = int(os.environ.get("REDIS_PORT", 6379))

# Redis connection for BullMQ consumer
redis_client = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)

QUEUE_NAME = "video-download"


class DownloadJob(BaseModel):
    videoId: str
    youtubeUrl: str
    organizationId: str


async def report_status(video_id: str, payload: dict):
    headers = {"x-internal-secret": API_INTERNAL_SECRET}
    async with httpx.AsyncClient() as client:
        try:
            await client.patch(
                f"{API_BASE_URL}/videos/{video_id}/status",
                json=payload,
                headers=headers,
                timeout=30,
            )
        except httpx.HTTPError as exc:
            logger.error("status callback failed for %s: %s", video_id, exc)


def run_pipeline(job: DownloadJob):
    video_dir = os.path.join(TMP_DIR, job.videoId)
    try:
        import asyncio
        asyncio.run(report_status(job.videoId, {
            "status": "DOWNLOADING",
            "organizationId": job.organizationId,
        }))

        video_path = download_video(job.youtubeUrl, job.videoId, TMP_DIR)
        raw_key = f"{job.organizationId}/raw-videos/{job.videoId}/video.mp4"
        upload_file(video_path, raw_key)

        audio_path = extract_audio(video_path, job.videoId, TMP_DIR)
        audio_key = f"{job.organizationId}/raw-videos/{job.videoId}/audio.wav"
        upload_file(audio_path, audio_key)

        asyncio.run(report_status(job.videoId, {
            "status": "DOWNLOADED",
            "organizationId": job.organizationId,
            "rawVideoS3Key": raw_key,
            "audioS3Key": audio_key,
        }))
    except Exception as exc:  # noqa: BLE001 — report every failure, never swallow
        logger.exception("pipeline failed for %s", job.videoId)
        import asyncio
        asyncio.run(report_status(job.videoId, {
            "status": "FAILED",
            "organizationId": job.organizationId,
            "errorMessage": str(exc),
        }))
    finally:
        shutil.rmtree(video_dir, ignore_errors=True)


@app.post("/jobs/download")
async def enqueue_download(job: DownloadJob, background_tasks: BackgroundTasks):
    # In Day-5 form this runs in-process. Swap for a BullMQ-polled queue
    # consumer once concurrency needs outgrow a single FastAPI worker.
    background_tasks.add_task(run_pipeline, job)
    return {"accepted": True, "videoId": job.videoId}


@app.get("/health")
async def health():
    return {"status": "ok"}


def consume_queue():
    """Background thread: consume jobs from BullMQ queue (Redis list)."""
    logger.info(f"Starting BullMQ consumer for queue: {QUEUE_NAME}")

    while True:
        try:
            # BullMQ uses a key pattern: queue-name (for active jobs list)
            # and queue-name:jobs for job data
            # We'll poll the active jobs list and process

            # Get next job from the queue
            # BullMQ queues are stored as Redis lists
            queue_key = f"{QUEUE_NAME}:jobs"
            active_key = f"{QUEUE_NAME}:active"

            # Check for jobs in the queue
            job_ids = redis_client.lrange(QUEUE_NAME, 0, 0)

            if job_ids:
                job_id = job_ids[0]
                job_data_key = f"{QUEUE_NAME}:{job_id}"
                job_json = redis_client.get(job_data_key)

                if job_json:
                    try:
                        job_data = json.loads(job_json)
                        job_payload = job_data.get("data", {})

                        logger.info(f"Processing job {job_id}: {job_payload}")

                        # Remove from queue
                        redis_client.lpop(QUEUE_NAME)

                        # Run the pipeline
                        job_obj = DownloadJob(**job_payload)
                        run_pipeline(job_obj)

                        logger.info(f"Job {job_id} completed successfully")
                    except Exception as e:
                        logger.error(f"Error processing job {job_id}: {e}")
                        redis_client.lpop(QUEUE_NAME)
            else:
                # No jobs, sleep before checking again
                time.sleep(1)
        except Exception as e:
            logger.error(f"Error in queue consumer: {e}")
            time.sleep(5)


def start_background_consumer():
    """Start the queue consumer in a background thread."""
    consumer_thread = threading.Thread(target=consume_queue, daemon=True)
    consumer_thread.start()
    logger.info("Background queue consumer started")


# Start consumer when app starts
@app.on_event("startup")
async def startup_event():
    start_background_consumer()
