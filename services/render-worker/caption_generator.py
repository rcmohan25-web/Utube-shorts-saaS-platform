"""Word-by-word 'pop' ASS captions. §6.4.

PR 12 (§15.2 white-label branding pass): the Highlight style's color now
comes from the org's brandColor instead of a hardcoded yellow, so a Short
rendered for a branded org visually matches that org's app/email branding.
Falls back to the original yellow when the org has no brandColor set (most
orgs, pre-PR-12) or the value is malformed — a Short must never fail to
render because of a bad hex string.
"""

DEFAULT_HIGHLIGHT_ASS_COLOR = "&H0000FFFF"  # original hardcoded yellow


def _hex_to_ass_color(hex_color: str | None) -> str:
    """Convert a '#RRGGBB' hex string to ASS's &HAABBGGRR format (alpha 00,
    channels reversed from RGB to BGR — that's just how ASS/SSA colors are
    packed). Returns the platform default on anything that isn't a clean
    6-digit hex string."""
    if not hex_color or len(hex_color) != 7 or hex_color[0] != "#":
        return DEFAULT_HIGHLIGHT_ASS_COLOR
    try:
        r, g, b = hex_color[1:3], hex_color[3:5], hex_color[5:7]
        int(r + g + b, 16)  # validates all six chars are hex digits
    except ValueError:
        return DEFAULT_HIGHLIGHT_ASS_COLOR
    return f"&H00{b}{g}{r}".upper()


def _build_header(brand_color: str | None) -> str:
    highlight_color = _hex_to_ass_color(brand_color)
    return f"""[Script Info]
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, Bold, Alignment, MarginV
Style: Default,Arial Black,72,&H00FFFFFF,1,2,250
Style: Highlight,Arial Black,80,{highlight_color},1,2,250

[Events]
Format: Layer, Start, End, Style, Text
"""


def _format_time(seconds: float) -> str:
    seconds = max(seconds, 0)
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = seconds % 60
    return f"{hours}:{minutes:02d}:{secs:05.2f}"


def write_ass_file(
    words: list[dict],
    clip_start: float,
    out_path: str,
    brand_color: str | None = None,
) -> str:
    """words: transcript words with absolute (source-video) timestamps.
    clip_start: the clip's startSeconds in the source video — subtracted
    from every timestamp so captions are zeroed to the clip's own timeline.
    brand_color: the org's '#RRGGBB' brandColor (PR 12), or None to use the
    platform default highlight color."""
    lines = [_build_header(brand_color)]

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
