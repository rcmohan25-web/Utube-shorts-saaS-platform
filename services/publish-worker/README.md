# publish-worker

Not implemented in this scaffold yet — placeholder for the corresponding stage
of the pipeline (§6.1 of the implementation plan).

Build order per the roadmap:
- transcription-worker → Day 6 (Faster-Whisper, word timestamps)
- render-worker        → Days 9–10 (GPT clip scoring, smart crop, ASS captions, FFmpeg burn-in)
- publish-worker       → Day 14 (resumable upload to YouTube Data API v3)

Follow the same shape as `services/clip-worker`: FastAPI HTTP service,
receives a job from NestJS, does the work, calls back to
`PATCH /api/v1/videos/:id/status` (or the equivalent Clip/Short endpoint)
with the internal secret header.
