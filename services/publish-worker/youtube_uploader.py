"""YouTube resumable upload implementation per §14.3.

Three-step flow:
  1. POST to initiate → get upload session URI from Location header
  2. PUT chunks (10 MB each) with Content-Range headers
  3. POST thumbnail (non-fatal)

Quota detection: 403 with errors[].reason == 'quotaExceeded' is a special
case that triggers the cascade-postpone flow. All other 4xx/5xx are regular
failures that BullMQ can retry.
"""
import logging
import os

import requests

logger = logging.getLogger("publish-worker")

CHUNK_SIZE = 10 * 1024 * 1024  # 10 MB per §14.3
CHUNK_TIMEOUT = 120             # seconds per chunk — enough for 10 MB at 1 Mbps
INITIATE_TIMEOUT = 30           # seconds for the session initiation call


class QuotaExceededException(Exception):
    """Raised when YouTube returns 403 quotaExceeded."""


def _check_for_quota_exceeded(response: requests.Response) -> None:
    """If the 403 is a quota error, raise QuotaExceededException.
    Otherwise let the caller handle the non-quota 403 as a generic failure."""
    try:
        errors = response.json().get("error", {}).get("errors", [])
        if any(e.get("reason") == "quotaExceeded" for e in errors):
            raise QuotaExceededException(
                f"YouTube API quota exceeded (GCP project quota pool). "
                f"Default quota allows only ~6 uploads/day. "
                f"Apply for an increase at console.cloud.google.com."
            )
    except (ValueError, KeyError, AttributeError):
        pass  # Couldn't parse body — treat as generic 403


def initiate_upload_session(
    access_token: str,
    title: str,
    description: str,
    tags: list[str],
    file_size: int,
) -> str:
    """POST to YouTube to get the upload session URI.

    Returns the Location header value — the upload session URI that all
    subsequent chunk PUTs must target.
    """
    # YouTube title limit: 100 chars. Tags: 500 chars total, no angle brackets.
    safe_title = title[:100]
    safe_tags = [t.replace("<", "").replace(">", "") for t in tags]

    metadata = {
        "snippet": {
            "title": safe_title,
            "description": description[:5000],  # YouTube description limit
            "tags": safe_tags,
            "categoryId": "22",  # People & Blogs — most common for Shorts
        },
        "status": {
            "privacyStatus": "public",
            "selfDeclaredMadeForKids": False,
        },
    }

    res = requests.post(
        "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
            "X-Upload-Content-Type": "video/mp4",
            "X-Upload-Content-Length": str(file_size),
        },
        json=metadata,
        timeout=INITIATE_TIMEOUT,
    )

    if res.status_code == 403:
        _check_for_quota_exceeded(res)

    res.raise_for_status()

    session_uri = res.headers.get("Location")
    if not session_uri:
        raise RuntimeError(
            "YouTube returned 200 for upload initiation but no Location header. "
            "This is a YouTube API bug — retry."
        )

    return session_uri


def upload_in_chunks(session_uri: str, file_path: str, file_size: int) -> str:
    """Stream the file to YouTube in CHUNK_SIZE chunks.

    Handles 308 Resume Incomplete responses by reading the Range header
    to determine how many bytes YouTube actually received (it may be less
    than what we sent if the connection dropped mid-chunk).

    Returns the YouTube video ID on success.
    """
    uploaded = 0

    with open(file_path, "rb") as f:
        while uploaded < file_size:
            chunk = f.read(CHUNK_SIZE)
            if not chunk:
                break

            chunk_end = uploaded + len(chunk) - 1

            res = requests.put(
                session_uri,
                headers={
                    "Content-Range": f"bytes {uploaded}-{chunk_end}/{file_size}",
                    "Content-Length": str(len(chunk)),
                    "Content-Type": "video/mp4",
                },
                data=chunk,
                timeout=CHUNK_TIMEOUT,
            )

            if res.status_code == 308:
                # Resume Incomplete — YouTube tells us the actual received offset.
                # The Range header is "bytes=0-{last_received_byte}".
                # If the header is absent, assume all bytes in this chunk were
                # received (can happen on the very first chunk).
                if "Range" in res.headers:
                    last_received = int(res.headers["Range"].split("-")[1])
                    uploaded = last_received + 1
                else:
                    uploaded += len(chunk)

                logger.debug(
                    "chunk uploaded — progress %d / %d bytes (%.1f%%)",
                    uploaded, file_size, 100 * uploaded / file_size,
                )
                continue

            if res.status_code == 403:
                _check_for_quota_exceeded(res)
                # Non-quota 403 (channel suspended, token problem, etc.)
                res.raise_for_status()

            if res.status_code in (200, 201):
                video_id = res.json().get("id")
                if not video_id:
                    raise RuntimeError(
                        f"YouTube returned {res.status_code} but no video ID in response body"
                    )
                logger.info("upload complete — youtube video id: %s", video_id)
                return video_id

            # Unexpected status code — raise so the caller can decide
            # whether to retry or mark as failed.
            res.raise_for_status()

    raise RuntimeError(
        f"Uploaded all {file_size} bytes but YouTube never returned a video ID"
    )


def set_thumbnail(video_id: str, thumbnail_path: str, access_token: str) -> None:
    """Upload the Short's thumbnail to YouTube.

    Explicitly non-fatal per the spec — if this fails, the video is still
    published (YouTube uses an auto-generated thumbnail). We log and continue.
    """
    if not thumbnail_path or not os.path.exists(thumbnail_path):
        logger.info("no thumbnail file to set for video %s", video_id)
        return

    try:
        with open(thumbnail_path, "rb") as f:
            res = requests.post(
                f"https://www.googleapis.com/upload/youtube/v3/thumbnails/set"
                f"?videoId={video_id}",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "image/jpeg",
                },
                data=f,
                timeout=60,
            )
        if not res.ok:
            logger.warning(
                "thumbnail upload failed for video %s (HTTP %s) — "
                "YouTube will use an auto-generated thumbnail",
                video_id, res.status_code,
            )
        else:
            logger.info("thumbnail set for video %s", video_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "thumbnail upload threw for video %s: %s — continuing without it",
            video_id, exc,
        )
