import os
import uuid
import shutil
import asyncio
import subprocess
import json
from pathlib import Path
from typing import Optional

import httpx
import aiofiles
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
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


class InfoRequest(BaseModel):
    url: str


class DownloadRequest(BaseModel):
    url: str
    format_id: Optional[str] = None


def content_disposition(filename: str) -> str:
    """Return a Content-Disposition header value safe for non-ASCII filenames (RFC 5987)."""
    from urllib.parse import quote
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


def parse_formats(info: dict) -> list:
    formats = []
    seen_qualities = set()

    raw_formats = info.get("formats", [])
    # Filter video+audio combined or video-only, sort by height desc
    video_formats = [
        f for f in raw_formats
        if f.get("vcodec") != "none" and f.get("ext") in ("mp4", "webm", "mkv")
    ]
    video_formats.sort(key=lambda f: (f.get("height") or 0), reverse=True)

    for f in video_formats:
        height = f.get("height")
        if not height:
            continue
        quality = f"{height}p"
        if quality in seen_qualities:
            continue
        seen_qualities.add(quality)

        # Prefer merged format (video+audio) — use format string with audio
        fmt_id = f.get("format_id", "")
        # Check if this format has audio
        has_audio = f.get("acodec") not in ("none", None)
        if not has_audio:
            # Find best audio and merge
            audio_formats = [
                af for af in raw_formats
                if af.get("vcodec") == "none" and af.get("acodec") != "none"
            ]
            if audio_formats:
                best_audio = max(audio_formats, key=lambda af: af.get("abr") or 0)
                fmt_id = f"{fmt_id}+{best_audio['format_id']}"

        formats.append({
            "id": fmt_id,
            "ext": "mp4",
            "quality": quality,
            "filesize": f.get("filesize") or f.get("filesize_approx"),
        })

        if len(formats) >= 4:
            break

    # Add audio-only option
    audio_formats = [
        f for f in raw_formats
        if f.get("vcodec") == "none" and f.get("acodec") != "none"
    ]
    if audio_formats:
        best_audio = max(audio_formats, key=lambda f: f.get("abr") or 0)
        formats.append({
            "id": f"bestaudio",
            "ext": "mp3",
            "quality": "Audio only",
            "filesize": best_audio.get("filesize") or best_audio.get("filesize_approx"),
        })

    # Fallback: just best
    if not formats:
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

    # Try yt-dlp first
    try:
        proc = await asyncio.create_subprocess_exec(
            "yt-dlp",
            "--dump-json",
            "--no-playlist",
            "--no-warnings",
            "--extractor-args", "youtube:player_client=android,web_creator",
            url,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)

        if proc.returncode == 0 and stdout:
            info = json.loads(stdout.decode())
            extractor = info.get("extractor_key", "Generic")
            # Generic extractor = direct file URL — skip to httpx fallback for clean metadata
            if extractor == "Generic":
                raise ValueError("generic extractor")
            formats = parse_formats(info)
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

    # Fallback: treat as direct file URL
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

    # Direct file download
    if platform == "direct" or (format_id and format_id == "direct"):
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
            "--extractor-args", "youtube:player_client=android,web_creator",
            "-o", str(tmp_dir / "%(title).80s.%(ext)s"),
            "--merge-output-format", "mp4",
        ]

        if format_id and format_id not in ("best", "bestaudio"):
            cmd.extend(["-f", format_id])
        elif format_id == "bestaudio":
            cmd.extend(["-f", "bestaudio", "--extract-audio", "--audio-format", "mp3"])
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
                detail=f"Download failed: {stderr.decode()[-500:]}"
            )

        # Find downloaded file
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
