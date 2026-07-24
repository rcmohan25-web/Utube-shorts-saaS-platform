"""publish-worker — receives publish jobs from NestJS's PublishProcessor,
downloads the Short MP4 from S3/R2, uploads it to YouTube via resumable
upload (§14.3), and calls back to NestJS with the result.

This is an HTTP service, not a BullMQ consumer (ADR-002): the NestJS-side
PublishProcessor POSTs the job here with a decrypted, freshly-fetched
access token; we do the upload and call back when done.
"""
import asyncio
import logging
import os
import shutil

import httpx
from dotenv import load_dotenv
from fastapi import BackgroundTasks, FastAPI
from pydantic import BaseModel

from s3_client import download_file
from youtube_uploader import (
    QuotaExceededException,
    initiate_upload_session,
    set_thumbnail,
    upload_in_chunks,
)

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("publish-worker")

app = FastAPI(title="publish-worker")

TMP_DIR = os.environ.get("TMP_DIR", "/tmp/shorts-worker")
API_BASE_URL = os.environ.get("API_BASE_URL", "http://localhost:3001/api/v1")
API_INTERNAL_SECRET = os.environ.get("API_INTERNAL_SECRET", "")
CALLBACK_MAX_RETRIES = 3


class PublishJob(BaseModel):
    scheduleId: str
    organizationId: str
    shortId: str
    channelId: str
    renderS3Key: str
    thumbnailS3Key: str | None = None
    title: str
    description: str = ""
    tags: list[str] = []
    scheduledAt: str
    # Decrypted OAuth access token — decrypted by NestJS's PublishProcessor
    # right before dispatch so it's guaranteed fresh. Never stored here.
    accessToken: str


async def _callback(url: str, payload: dict) -> None:
    """POST/PATCH to NestJS with retry on transient failures.

    If NestJS is temporarily unreachable (restart, deploy), we retry up to
    CALLBACK_MAX_RETRIES times with exponential back-off before giving up.
    The stuck-schedule cron (SchedulesService.checkStuckSchedules) provides
    the safety net if all retries fail.
    """
    headers = {"x-internal-secret": API_INTERNAL_SECRET, "Content-Type": "application/json"}
    for attempt in range(CALLBACK_MAX_RETRIES):
        try:
            async with httpx.AsyncClient() as client:
                res = await client.patch(url, json=payload, headers=headers, timeout=30)
                res.raise_for_status()
                return
        except Exception as exc:
            if attempt < CALLBACK_MAX_RETRIES - 1:
                wait = 2 ** attempt  # 1 s, 2 s, 4 s
                logger.warning("callback attempt %d failed (%s) — retrying in %ds", attempt + 1, exc, wait)
                await asyncio.sleep(wait)
            else:
                logger.error("callback failed after %d attempts for %s: %s", CALLBACK_MAX_RETRIES, url, exc)


async def _report_complete(schedule_id: str, org_id: str, youtube_video_id: str) -> None:
    url = f"{API_BASE_URL}/schedules/{schedule_id}/complete"
    await _callback(url, {"youtubeVideoId": youtube_video_id, "organizationId": org_id})
    logger.info("reported complete for schedule %s — youtube video id: %s", schedule_id, youtube_video_id)


async def _report_failed(schedule_id: str, org_id: str, error_message: str) -> None:
    url = f"{API_BASE_URL}/schedules/{schedule_id}/failed"
    await _callback(url, {"errorMessage": error_message, "organizationId": org_id})
    logger.error("reported failure for schedule %s: %s", schedule_id, error_message)


async def _report_quota_exceeded(schedule_id: str, org_id: str) -> None:
    """Signals NestJS to postpone ALL pending schedules for this channel by 24h.
    Per §14.4: on 403 quotaExceeded, cascade-postpone the entire channel queue.
    """
    url = f"{API_BASE_URL}/schedules/{schedule_id}/quota-exceeded"
    await _callback(url, {"organizationId": org_id})
    logger.warning("reported quota exceeded for schedule %s — NestJS will postpone all pending", schedule_id)


def run_pipeline(job: PublishJob) -> None:
    work_dir = os.path.join(TMP_DIR, job.scheduleId)
    os.makedirs(work_dir, exist_ok=True)

    try:
        logger.info(
            "starting publish pipeline — schedule %s short %s",
            job.scheduleId, job.shortId,
        )

        # ── 1. Download Short MP4 from S3/R2 ─────────────────────────────────
        mp4_path = os.path.join(work_dir, "short.mp4")
        download_file(job.renderS3Key, mp4_path)
        file_size = os.path.getsize(mp4_path)
        logger.info("downloaded short.mp4 — %d bytes (%.1f MB)", file_size, file_size / 1024 / 1024)

        # ── 2. Download thumbnail (non-fatal if missing) ──────────────────────
        thumb_path: str | None = None
        if job.thumbnailS3Key:
            try:
                thumb_path = os.path.join(work_dir, "thumbnail.jpg")
                download_file(job.thumbnailS3Key, thumb_path)
            except Exception as exc:
                logger.warning("thumbnail download failed (%s) — continuing without it", exc)
                thumb_path = None

        # ── 3. Initiate YouTube resumable upload session (§14.3 step 1) ──────
        session_uri = initiate_upload_session(
            access_token=job.accessToken,
            title=job.title,
            description=job.description,
            tags=job.tags,
            file_size=file_size,
        )
        logger.info("upload session initiated for schedule %s", job.scheduleId)

        # ── 4. Upload in 10 MB chunks (§14.3 step 2) ─────────────────────────
        youtube_video_id = upload_in_chunks(session_uri, mp4_path, file_size)

        # ── 5. Set thumbnail (§14.3 step 3 — non-fatal) ──────────────────────
        if thumb_path:
            set_thumbnail(youtube_video_id, thumb_path, job.accessToken)

        # ── 6. Callback: success ──────────────────────────────────────────────
        asyncio.run(_report_complete(job.scheduleId, job.organizationId, youtube_video_id))

    except QuotaExceededException as exc:
        # §14.4: quota exceeded triggers cascade-postpone, NOT a simple failure.
        logger.warning("quota exceeded for schedule %s: %s", job.scheduleId, exc)
        asyncio.run(_report_quota_exceeded(job.scheduleId, job.organizationId))

    except Exception as exc:  # noqa: BLE001 — report every failure, never swallow
        logger.exception("publish pipeline failed for schedule %s", job.scheduleId)
        asyncio.run(_report_failed(job.scheduleId, job.organizationId, str(exc)))

    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


@app.post("/jobs/publish")
async def enqueue_publish(job: PublishJob, background_tasks: BackgroundTasks):
    # Accept immediately, do the upload in the background.
    # The BullMQ job in NestJS is COMPLETE once we return 200 here.
    # The actual YouTube upload result comes back via the callback endpoints.
    background_tasks.add_task(run_pipeline, job)
    return {"accepted": True, "scheduleId": job.scheduleId}


@app.get("/health")
async def health():
    return {"status": "ok"}
