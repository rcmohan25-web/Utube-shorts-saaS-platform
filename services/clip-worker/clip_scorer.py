"""GPT-4o clip scoring. §6.2 — system prompt encodes the schema + rules so
the user message can stay just the raw segment data."""
import os
import json
from openai import OpenAI

_client = None


def get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    return _client


SYSTEM_PROMPT = """You are a YouTube Shorts viral content expert. Return ONLY valid JSON — no markdown, no explanation text.

Input is a JSON object: { "videoTitle": string, "segments": [{ "index", "startSeconds", "endSeconds", "transcript", "sceneChanges", "avgAmplitude" }] }.

Respond with: { "clips": [ { "segmentIndex": number, "startSeconds": number, "endSeconds": number, "confidenceScore": number, "hookQuality": number, "emotionalIntensity": number, "selfContained": boolean, "suggestedTitle": string, "suggestedDescription": string, "hashtags": string[], "reasoning": string } ] }, with "clips" sorted by confidenceScore DESC.

Rules: only 45-90 second segments. Prefer segments that open mid-action. Penalize segments that open with filler words (um, so, like, okay). Only include segments scoring 40 or higher."""


def score_segments(video_title: str, segments: list[dict]) -> list[dict]:
    user_input = json.dumps({"videoTitle": video_title, "segments": segments})

    response = get_client().chat.completions.create(
        model="gpt-4o",
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_input},
        ],
    )

    parsed = json.loads(response.choices[0].message.content)
    clips = parsed.get("clips", [])
    clips = [c for c in clips if c.get("confidenceScore", 0) >= 40]
    return sorted(clips, key=lambda c: c.get("confidenceScore", 0), reverse=True)
