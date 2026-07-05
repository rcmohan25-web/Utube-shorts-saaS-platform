"""Word-by-word 'pop' ASS captions. §6.4."""

ASS_HEADER = """[Script Info]
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, Bold, Alignment, MarginV
Style: Default,Arial Black,72,&H00FFFFFF,1,2,250
Style: Highlight,Arial Black,80,&H0000FFFF,1,2,250

[Events]
Format: Layer, Start, End, Style, Text
"""


def _format_time(seconds: float) -> str:
    seconds = max(seconds, 0)
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = seconds % 60
    return f"{hours}:{minutes:02d}:{secs:05.2f}"


def write_ass_file(words: list[dict], clip_start: float, out_path: str) -> str:
    """words: transcript words with absolute (source-video) timestamps.
    clip_start: the clip's startSeconds in the source video — subtracted
    from every timestamp so captions are zeroed to the clip's own timeline."""
    lines = [ASS_HEADER]

    for word in words:
        start = word["start"] - clip_start
        end = word["end"] - clip_start
        text = word["word"].strip()
        if not text:
            continue

        # High-confidence words get the "pop" — bigger + briefly scaled up,
        # per §6.4's exact tag. Everything else is plain Default style.
        if word.get("probability", 1.0) > 0.95:
            style, tag = "Highlight", r"{\an2\t(0,50,\fscx112\fscy112)}"
        else:
            style, tag = "Default", r"{\an2}"

        lines.append(f"Dialogue: 0,{_format_time(start)},{_format_time(end)},{style},{tag}{text}\n")

    with open(out_path, "w") as f:
        f.writelines(lines)
    return out_path
