import os
import re
import uuid
import shutil
import asyncio
import json
from pathlib import Path
from typing import Optional
from urllib.parse import quote

# Locate yt-dlp regardless of whether it's on PATH
def _find_ytdlp() -> str:
    candidate = shutil.which("yt-dlp")
    if candidate:
        return candidate
    # Common install locations
    for p in [
        Path.home() / "Library/Python/3.9/bin/yt-dlp",
        Path.home() / "Library/Python/3.10/bin/yt-dlp",
        Path.home() / "Library/Python/3.11/bin/yt-dlp",
        Path("/usr/local/bin/yt-dlp"),
        Path("/opt/homebrew/bin/yt-dlp"),
    ]:
        if p.exists():
            return str(p)
    raise RuntimeError("yt-dlp not found — run: pip3 install yt-dlp")

import httpx

YTDLP = _find_ytdlp()
import aiofiles
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

app = FastAPI(title="LinkDrop Backend")

CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS if CORS_ORIGINS != ["*"] else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# android_vr: returns full DASH format list (144p–4K), no PO token, no SABR
YT_CLIENT = "android_vr"

# Browser to read cookies from for social platforms.
# Set COOKIES_BROWSER="" to disable (e.g., in Docker on Render where no browser is installed).
COOKIES_BROWSER = os.getenv("COOKIES_BROWSER", "chrome")

QUALITY_HEIGHTS = [2160, 1440, 1080, 720, 480, 360, 240, 144]
QUALITY_LABELS = {
    2160: "4K", 1440: "1440p", 1080: "1080p", 720: "720p",
    480: "480p", 360: "360p", 240: "240p", 144: "144p",
}

# Platforms that need browser cookies to return proper format lists
COOKIE_PLATFORMS = {"tiktok", "instagram", "twitter", "facebook"}


class InfoRequest(BaseModel):
    url: str


class DownloadRequest(BaseModel):
    url: str
    format_id: Optional[str] = None


def content_disposition(filename: str) -> str:
    """RFC 5987 safe Content-Disposition header (supports non-ASCII filenames)."""
    ascii_name = filename.encode("ascii", "ignore").decode("ascii") or "download"
    utf8_name = quote(filename, safe=" .-_")
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{utf8_name}"


PLATFORM_PATTERNS = {
    "youtube": ["youtube.com", "youtu.be"],
    "tiktok": ["tiktok.com"],
    "instagram": ["instagram.com"],
    "twitter": ["twitter.com", "x.com"],
    "facebook": ["facebook.com", "fb.com", "fb.watch"],
    "reddit": ["reddit.com", "redd.it", "v.redd.it"],
    "vimeo": ["vimeo.com"],
    "soundcloud": ["soundcloud.com"],
    "twitch": ["twitch.tv", "clips.twitch.tv"],
    "pinterest": ["pinterest.com", "pin.it"],
    "dailymotion": ["dailymotion.com"],
    "bilibili": ["bilibili.com", "b23.tv"],
}


def detect_platform(url: str) -> str:
    url_lower = url.lower()
    for platform, domains in PLATFORM_PATTERNS.items():
        if any(d in url_lower for d in domains):
            return platform
    return "direct"


def build_ytdlp_flags(platform: str) -> list[str]:
    """Return platform-appropriate yt-dlp flags."""
    if platform == "youtube":
        return ["--extractor-args", f"youtube:player_client={YT_CLIENT}"]
    if platform in COOKIE_PLATFORMS and COOKIES_BROWSER:
        return ["--cookies-from-browser", COOKIES_BROWSER]
    return []


def _height_to_label(height: int) -> str:
    """Map a height value to a quality label string."""
    if not height:
        return "Unknown"
    if height in QUALITY_LABELS:
        return QUALITY_LABELS[height]
    # Within 12% of a standard tier (handles 652→720p, 576→540p, 270→240p, etc.)
    for qh in QUALITY_HEIGHTS:
        if abs(height - qh) / qh <= 0.12:
            return QUALITY_LABELS[qh]
    return f"{height}p"


def _label_from_format_id(format_id: str) -> Optional[str]:
    """
    Try to extract quality label from format_id.
    e.g. 'h264_720p_1349035-0' → '720p'
    """
    m = re.search(r"(\d{3,4})p", format_id)
    if m:
        p = int(m.group(1))
        return QUALITY_LABELS.get(p, f"{p}p")
    return None


def _codec_priority(fmt: dict) -> int:
    """Return sort priority for video codec (higher = more compatible)."""
    vc = (fmt.get("vcodec") or "").lower()
    if "h264" in vc or "avc" in vc:
        return 3
    if "vp9" in vc or "vp8" in vc:
        return 2
    if "av01" in vc or "av1" in vc:
        return 1
    # hevc / h265 / bytevc1 — least compatible (no hardware decode on iOS Safari)
    return 0


def parse_formats(raw_formats: list) -> list:
    """
    Unified format parser for all platforms.

    YouTube path  : separate video-only + audio-only DASH streams → merged pairs.
    Social path   : combined streams (TikTok, X, Instagram DASH) → best per height.
    """
    if not raw_formats:
        return [{"id": "best", "ext": "mp4", "quality": "Best", "filesize": None}]

    # video-only: has vcodec, no audio, has height
    video_only = [
        f for f in raw_formats
        if f.get("vcodec") not in ("none", None)
        and f.get("acodec") in ("none", None)
        and f.get("height")
    ]
    # audio-only: no video, no height, has audio
    # Note: some extractors (X/Twitter HLS) leave acodec=None but set abr>0
    audio_only = [
        f for f in raw_formats
        if f.get("vcodec") in ("none", None)
        and not f.get("height")
        and (f.get("acodec") not in ("none", None) or (f.get("abr") or 0) > 0)
    ]
    # explicitly combined: both codecs set (TikTok, Instagram)
    combined_explicit = [
        f for f in raw_formats
        if f.get("vcodec") not in ("none", None)
        and f.get("acodec") not in ("none", None)
        and f.get("height")
    ]
    # muxed progressive: both codecs=None but has height (X/Twitter http-*, Instagram fmt 8)
    # Note: tbr may be None for some pre-muxed streams (e.g., Instagram format "8")
    combined_muxed = [
        f for f in raw_formats
        if f.get("vcodec") is None
        and f.get("acodec") is None
        and f.get("height")
    ]
    combined = combined_explicit + combined_muxed

    formats: list[dict] = []

    # ── YOUTUBE / DASH PATH: separate video + audio streams ───────────────────
    # Prefer DASH when its max resolution exceeds combined streams (YouTube case:
    # video_only goes up to 4K while combined has only format-18 at 360p).
    # For X/Twitter: combined muxed streams match video_only resolution → social path.
    max_vid_h = max((f.get("height", 0) for f in video_only), default=0)
    max_comb_h = max((f.get("height", 0) for f in combined), default=0)
    use_dash = video_only and audio_only and (not combined or max_vid_h > max_comb_h)

    if use_dash:
        # Pick best audio stream (prefer m4a)
        m4a_streams = [a for a in audio_only if a.get("ext") == "m4a"]
        audio_pool = m4a_streams if m4a_streams else audio_only
        best_audio = max(audio_pool, key=lambda a: a.get("abr") or a.get("tbr") or 0)
        audio_size = best_audio.get("filesize") or best_audio.get("filesize_approx") or 0
        best_audio_id = best_audio.get("format_id")

        # Group video streams by height; keep best (prefer mp4 container, then bitrate)
        vid_by_height: dict[int, dict] = {}
        for f in video_only:
            h = f.get("height", 0)
            if not h:
                continue
            prev = vid_by_height.get(h)
            if prev is None:
                vid_by_height[h] = f
                continue
            f_mp4 = f.get("ext") == "mp4"
            p_mp4 = prev.get("ext") == "mp4"
            if f_mp4 and not p_mp4:
                vid_by_height[h] = f
            elif f_mp4 == p_mp4:
                if (f.get("tbr") or f.get("vbr") or 0) > (prev.get("tbr") or prev.get("vbr") or 0):
                    vid_by_height[h] = f

        seen: set[str] = set()
        for h in sorted(vid_by_height.keys(), reverse=True):
            best_vid = vid_by_height[h]
            fmt_id = f"{best_vid['format_id']}+{best_audio_id}"
            if fmt_id in seen:
                continue
            seen.add(fmt_id)
            vid_size = best_vid.get("filesize") or best_vid.get("filesize_approx") or 0
            total = vid_size + audio_size
            formats.append({
                "id": fmt_id,
                "ext": "mp4",
                "quality": _height_to_label(h),
                "filesize": total if total > 0 else None,
            })

        # Audio-only option
        formats.append({
            "id": "bestaudio[ext=m4a]/bestaudio",
            "ext": "mp3",
            "quality": "Audio only",
            "filesize": audio_size if audio_size > 0 else None,
        })

    # ── SOCIAL / COMBINED PATH ─────────────────────────────────────────────────
    # Handles TikTok (explicit combined), X/Twitter (muxed progressive), Instagram DASH.
    # Also used when X-type sites have both HLS splits AND muxed streams — prefer muxed.
    elif combined:
        # TikTok duplicates: format IDs end in -0 and -1 (identical streams)
        has_tiktok_dupes = any(
            re.search(r"-[01]$", f.get("format_id", "")) for f in combined
        )
        if has_tiktok_dupes:
            combined = [f for f in combined if not f.get("format_id", "").endswith("-1")]

        # Group by height, keep best codec/bitrate per height
        best_per_height: dict[int, dict] = {}
        for f in combined:
            h = f.get("height", 0)
            if not h:
                continue
            prev = best_per_height.get(h)
            if prev is None:
                best_per_height[h] = f
                continue
            f_pri = _codec_priority(f)
            p_pri = _codec_priority(prev)
            if f_pri > p_pri:
                best_per_height[h] = f
            elif f_pri == p_pri:
                f_tbr = f.get("tbr") or f.get("vbr") or 0
                p_tbr = prev.get("tbr") or prev.get("vbr") or 0
                if f_tbr > p_tbr:
                    best_per_height[h] = f

        for h in sorted(best_per_height.keys(), reverse=True):
            best = best_per_height[h]
            width = best.get("width") or 0
            is_portrait = h > width > 0

            # Quality label: try format_id first, then dimension
            label = _label_from_format_id(best.get("format_id", ""))
            if not label:
                q_dim = width if is_portrait else h
                label = _height_to_label(q_dim)

            size = best.get("filesize") or best.get("filesize_approx") or 0
            formats.append({
                "id": best["format_id"],
                "ext": best.get("ext", "mp4"),
                "quality": label,
                "filesize": size if size > 0 else None,
            })

        # Audio-only option
        formats.append({
            "id": "bestaudio/best",
            "ext": "mp3",
            "quality": "Audio only",
            "filesize": None,
        })

    if not formats:
        formats = [{"id": "best", "ext": "mp4", "quality": "Best", "filesize": None}]

    return formats


async def _run_ytdlp_info(url: str, extra_flags: list[str]) -> Optional[dict]:
    """
    Run yt-dlp --dump-json with given flags.
    Returns parsed JSON dict, or None on failure.
    """
    proc = await asyncio.create_subprocess_exec(
        YTDLP,
        "--dump-json",
        "--no-playlist",
        "--no-warnings",
        *extra_flags,
        url,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=30)
    except asyncio.TimeoutError:
        proc.kill()
        return None

    if proc.returncode != 0 or not stdout:
        return None

    try:
        info = json.loads(stdout.decode())
    except json.JSONDecodeError:
        return None

    extractor = info.get("extractor_key", "Generic")
    if extractor == "Generic":
        return None  # treat as direct file

    return info


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.post("/api/info")
async def get_info(req: InfoRequest):
    url = req.url.strip()
    platform = detect_platform(url)

    # 1) Try yt-dlp with platform-specific flags
    flags = build_ytdlp_flags(platform)
    info = await _run_ytdlp_info(url, flags)

    # 2) If that failed AND we used cookies, retry without cookies
    #    (handles environments without a browser, e.g. Docker on Render)
    if info is None and "--cookies-from-browser" in flags:
        info = await _run_ytdlp_info(url, [])

    if info is not None:
        formats = parse_formats(info.get("formats", []))
        return {
            "title": info.get("title", "Untitled"),
            "thumbnail": info.get("thumbnail"),
            "duration": info.get("duration"),
            "platform": platform if platform != "direct" else (info.get("extractor_key", "").lower() or "direct"),
            "is_direct": False,
            "formats": formats,
            "uploader": info.get("uploader") or info.get("channel"),
            "view_count": info.get("view_count"),
        }

    # 3) Fallback: treat as direct file (mp4, pdf, jpg, etc.)
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=10) as client:
            head = await client.head(url)
            content_type = head.headers.get("content-type", "application/octet-stream").split(";")[0].strip()
            content_length = head.headers.get("content-length")
            filename = url.split("?")[0].split("/")[-1] or "file"
            ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else content_type.split("/")[-1]

            return {
                "title": filename,
                "thumbnail": None,
                "duration": None,
                "platform": "direct",
                "is_direct": True,
                "formats": [{
                    "id": "direct",
                    "ext": ext,
                    "quality": "Original",
                    "filesize": int(content_length) if content_length else None,
                }],
                "uploader": None,
                "view_count": None,
            }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not fetch URL info: {str(e)}")


@app.post("/api/download")
async def download(req: DownloadRequest):
    url = req.url.strip()
    format_id = req.format_id
    platform = detect_platform(url)

    # ── Direct file download (httpx streaming) ─────────────────────────────────
    if format_id == "direct":
        async def stream_direct():
            async with httpx.AsyncClient(follow_redirects=True, timeout=None) as client:
                async with client.stream("GET", url) as response:
                    async for chunk in response.aiter_bytes(chunk_size=65536):
                        yield chunk

        filename = url.split("?")[0].split("/")[-1] or "file"
        return StreamingResponse(
            stream_direct(),
            media_type="application/octet-stream",
            headers={"Content-Disposition": content_disposition(filename)},
        )

    # ── yt-dlp download ────────────────────────────────────────────────────────
    tmp_dir = Path(f"/tmp/{uuid.uuid4()}")
    tmp_dir.mkdir(parents=True, exist_ok=True)

    try:
        flags = build_ytdlp_flags(platform)
        cmd = [
            YTDLP,
            "--no-playlist",
            "--no-warnings",
            *flags,
            "-o", str(tmp_dir / "%(title).80s.%(ext)s"),
            "--merge-output-format", "mp4",
        ]

        if format_id and "bestaudio" in format_id and "+" not in format_id:
            # Audio-only download — extract as mp3
            cmd.extend(["-f", format_id, "--extract-audio", "--audio-format", "mp3"])
        elif format_id:
            cmd.extend(["-f", format_id])
        else:
            cmd.extend(["-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"])

        cmd.append(url)

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=300)

        if proc.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail=f"Download failed: {stderr.decode()[-500:]}",
            )

        files = list(tmp_dir.iterdir())
        if not files:
            raise HTTPException(status_code=500, detail="No file downloaded")

        filepath = files[0]
        filename = filepath.name
        ext = filepath.suffix.lower()

        content_type_map = {
            ".mp4": "video/mp4",
            ".webm": "video/webm",
            ".mkv": "video/x-matroska",
            ".mp3": "audio/mpeg",
            ".m4a": "audio/mp4",
            ".opus": "audio/opus",
        }
        media_type = content_type_map.get(ext, "application/octet-stream")
        file_size = filepath.stat().st_size

        async def file_stream():
            try:
                async with aiofiles.open(filepath, "rb") as f:
                    while chunk := await f.read(65536):
                        yield chunk
            finally:
                shutil.rmtree(tmp_dir, ignore_errors=True)

        return StreamingResponse(
            file_stream(),
            media_type=media_type,
            headers={
                "Content-Disposition": content_disposition(filename),
                "Content-Length": str(file_size),
            },
        )

    except asyncio.TimeoutError:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise HTTPException(status_code=504, detail="Download timed out (5 min limit)")
    except HTTPException:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise
    except Exception as e:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise HTTPException(status_code=500, detail=str(e))
