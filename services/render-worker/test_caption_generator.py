"""PR 12 (§15.2). Pure-logic tests for caption_generator's hex -> ASS color
conversion — no ffmpeg, no file I/O, so these run fast and don't need the
render-worker's Docker image. Run with: pytest test_caption_generator.py
"""
from caption_generator import DEFAULT_HIGHLIGHT_ASS_COLOR, _hex_to_ass_color, write_ass_file


def test_hex_to_ass_color_converts_and_reverses_channel_order():
    # #6d5bff -> R=6d G=5b B=ff -> ASS wants &H00BBGGRR
    assert _hex_to_ass_color("#6d5bff") == "&H00FF5B6D"


def test_hex_to_ass_color_falls_back_on_none():
    assert _hex_to_ass_color(None) == DEFAULT_HIGHLIGHT_ASS_COLOR


def test_hex_to_ass_color_falls_back_on_malformed_input():
    assert _hex_to_ass_color("not-a-color") == DEFAULT_HIGHLIGHT_ASS_COLOR
    assert _hex_to_ass_color("#zzzzzz") == DEFAULT_HIGHLIGHT_ASS_COLOR
    assert _hex_to_ass_color("#fff") == DEFAULT_HIGHLIGHT_ASS_COLOR  # 3-digit shorthand not supported


def test_write_ass_file_embeds_the_converted_brand_color(tmp_path):
    out_path = tmp_path / "short.ass"
    words = [{"start": 1.0, "end": 1.3, "word": "hi", "probability": 0.99}]

    write_ass_file(words, clip_start=0.0, out_path=str(out_path), brand_color="#00ff00")

    content = out_path.read_text()
    assert "&H0000FF00" in content  # green, BGR-packed
    assert "Dialogue: 0,0:00:01.00,0:00:01.30,Highlight" in content


def test_write_ass_file_uses_default_color_when_brand_color_is_absent(tmp_path):
    out_path = tmp_path / "short.ass"
    write_ass_file([], clip_start=0.0, out_path=str(out_path))

    content = out_path.read_text()
    assert DEFAULT_HIGHLIGHT_ASS_COLOR in content
