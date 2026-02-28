import os
import uuid
import shutil
import asyncio
import json
from pathlib import Path
from typing import Optional
from urllib.parse import quote

import httpx
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

# android_vr client: returns full DASH format list (144p–4K) with real filesizes,
# no PO token required, no SABR restriction.
YT_CLIENT = "android_vr"

QUALITY_HEIGHTS = [2160, 1440, 1080, 720, 480, 360, 240, 144]
QUALITY_LABELS = {
    2160: "4K",
    1440: "1440p",
    1080: "1080p",
    720: "720p",
    480: "480p",
    360: "360p",
    240: "240p",
    144: "144p",
}


class InfoRequest(BaseModel):
    url: str


class DownloadRequest(BaseModel):
    url: str
    format_id: Optional[str] = None


def content_disposition(filename: str) -> str:
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


def parse_formats(raw_formats: list) -> list:
    """
    Build quality tiers from the actual format list returned by yt-dlp.
    Each tier picks the best video-only mp4 at or below that height,
    paired with the best m4a audio. Returns real filesizes.
    """
    # Separate video-only and audio-only streams
    video_streams = [
        f for f in raw_formats
        if f.get("vcodec") not in ("none", None)
        and f.get("acodec") in ("none", None)
        and f.get("height")
    ]
    audio_streams = [
        f for f in raw_formats
        if f.get("vcodec") in ("none", None)
        and f.get("acodec") not in ("none", None)
    ]
    # Also consider combined streams (has both video+audio)
    combined_streams = [
        f for f in raw_formats
        if f.get("vcodec") not in ("none", None)
        and f.get("acodec") not in ("none", None)
        and f.get("height")
    ]

    # Best audio stream for size estimation
    best_audio = None
    if audio_streams:
        # Prefer m4a, then by bitrate
        m4a = [a for a in audio_streams if a.get("ext") == "m4a"]
        pool = m4a if m4a else audio_streams
        best_audio = max(pool, key=lambda a: a.get("abr") or a.get("tbr") or 0)

    audio_size = (best_audio.get("filesize") or best_audio.get("filesize_approx") or 0) if best_audio else 0
    best_audio_id = best_audio.get("format_id") if best_audio else None

    # Find the maximum available height
    all_heights = [f.get("height", 0) for f in video_streams + combined_streams]
    max_height = max(all_heights) if all_heights else 0

    formats = []
    seen = set()

    for h in QUALITY_HEIGHTS:
        if h > max_height:
            continue  # skip tiers above what this video has

        label = QUALITY_LABELS[h]

        # Find best video-only mp4 at this exact height (prefer mp4, then av01, then any)
        candidates = [f for f in video_streams if f.get("height") == h]
        if not candidates:
            # No exact match — check if there's a combined stream
            candidates = [f for f in combined_streams if f.get("height") == h]

        if not candidates:
            continue

        # Pick best by bitrate among mp4 first
        mp4_cands = [f for f in candidates if f.get("ext") == "mp4"]
        best_video = max(mp4_cands or candidates, key=lambda f: f.get("tbr") or f.get("vbr") or 0)
        vid_id = best_video.get("format_id", "")

        has_audio = best_video.get("acodec") not in ("none", None)

        if has_audio:
            fmt_id = vid_id
        elif best_audio_id:
            fmt_id = f"{vid_id}+{best_audio_id}"
        else:
            fmt_id = vid_id

        if fmt_id in seen:
            continue
        seen.add(fmt_id)

        vid_size = best_video.get("filesize") or best_video.get("filesize_approx") or 0
        total_size = (vid_size + audio_size) if not has_audio else vid_size

        formats.append({
            "id": fmt_id,
            "ext": "mp4",
            "quality": label,
            "filesize": total_size if total_size > 0 else None,
        })

    # Audio only — best m4a
    if best_audio:
        formats.append({
            "id": f"bestaudio[ext=m4a]/bestaudio",
            "ext": "mp3",
            "quality": "Audio only",
            "filesize": audio_size if audio_size > 0 else None,
        })
    elif not formats:
        # absolute fallback
        formats.append({
            "id": "best",
            "ext": "mp4",
            "quality": "Best",
            "filesize": None,
        })

    return formats


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.post("/api/info")
async def get_info(req: InfoRequest):
    url = req.url.strip()
    platform = detect_platform(url)

    # Try yt-dlp with android_vr client — returns full DASH format list with real filesizes
    try:
        proc = await asyncio.create_subprocess_exec(
            "yt-dlp",
            "--dump-json",
            "--no-playlist",
            "--no-warnings",
            "--extractor-args", f"youtube:player_client={YT_CLIENT}",
            url,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)

        if proc.returncode == 0 and stdout:
            info = json.loads(stdout.decode())
            extractor = info.get("extractor_key", "Generic")
            if extractor == "Generic":
                raise ValueError("generic extractor — treat as direct file")
            formats = parse_formats(info.get("formats", []))
            return {
                "title": info.get("title", "Untitled"),
                "thumbnail": info.get("thumbnail"),
                "duration": info.get("duration"),
                "platform": platform if platform != "direct" else extractor.lower(),
                "is_direct": False,
                "formats": formats,
                "uploader": info.get("uploader") or info.get("channel"),
                "view_count": info.get("view_count"),
            }
    except asyncio.TimeoutError:
        pass
    except Exception:
        pass

    # Fallback: direct file URL
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=10) as client:
            head = await client.head(url)
            content_type = head.headers.get("content-type", "application/octet-stream").split(";")[0]
            content_length = head.headers.get("content-length")
            filename = url.split("?")[0].split("/")[-1] or "file"
            ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

            return {
                "title": filename,
                "thumbnail": None,
                "duration": None,
                "platform": "direct",
                "is_direct": True,
                "formats": [{
                    "id": "direct",
                    "ext": ext or content_type.split("/")[-1],
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

    # Direct file download via httpx stream
    if platform == "direct" or format_id == "direct":
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

    # yt-dlp download
    tmp_dir = Path(f"/tmp/{uuid.uuid4()}")
    tmp_dir.mkdir(parents=True, exist_ok=True)

    try:
        cmd = [
            "yt-dlp",
            "--no-playlist",
            "--no-warnings",
            "--extractor-args", f"youtube:player_client={YT_CLIENT}",
            "-o", str(tmp_dir / "%(title).80s.%(ext)s"),
            "--merge-output-format", "mp4",
        ]

        if format_id and "bestaudio" in format_id and "bestvideo" not in format_id:
            # Audio-only download → extract as mp3
            cmd.extend(["-f", format_id, "--extract-audio", "--audio-format", "mp3"])
        elif format_id:
            # Exact format ID(s) from the info response (e.g. "399+140")
            cmd.extend(["-f", format_id])
        else:
            cmd.extend(["-f", f"bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"])

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
                detail=f"Download failed: {stderr.decode()[-500:]}"
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
        content_type = content_type_map.get(ext, "application/octet-stream")
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
            media_type=content_type,
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
