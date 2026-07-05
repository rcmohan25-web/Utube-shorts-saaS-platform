# transcription-worker

Implements §6.1 stage 4 (transcription) — Faster-Whisper with word-level
timestamps. FastAPI HTTP service, same shape as `services/clip-worker`:
the NestJS-side `TranscriptionProcessor` POSTs a job to `/jobs/transcribe`;
this service downloads the audio from S3/R2, transcribes it, uploads
`transcript.json` back to S3/R2, and PATCHes `/api/v1/videos/:id/status`
with the internal-secret header.

## Run locally

```bash
cd services/transcription-worker
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in S3/R2 + internal secret
uvicorn main:app --reload --port 8001
```

Or via `infrastructure/docker/docker-compose.yml` (`transcription-worker` service).

## Status

✅ Implemented (Day 6 of the roadmap). Loads `WHISPER_MODEL` (default
`medium`) once at startup — see `whisper_service.py` for the prod/dev
model-size tradeoff.

Still stubs:
- `services/render-worker` — Days 9–10 (GPT clip scoring, smart crop, ASS captions)
- `services/publish-worker` — Day 14 (resumable upload to YouTube Data API v3)
