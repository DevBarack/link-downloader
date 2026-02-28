'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { AppState, Format } from '@/app/page'

interface Props {
  url: string
  format: Format | null
  state: AppState
  progress: number
  filename: string
  onProgress: (p: number) => void
  onComplete: (filename: string) => void
  onError: (msg: string) => void
  onStart: () => void
}

function sanitizeFilename(name: string, ext: string): string {
  const clean = name.replace(/[^\w\s.-]/g, '').replace(/\s+/g, '_').slice(0, 80)
  return `${clean}.${ext}`
}

export default function DownloadButton({
  url, format, state, progress, filename,
  onProgress, onComplete, onError, onStart,
}: Props) {
  const [downloadUrl, setDownloadUrl] = useState('')
  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

  const handleDownload = async () => {
    if (!format) return
    onStart()
    onProgress(0)

    const isPWA = typeof window !== 'undefined' &&
      window.matchMedia('(display-mode: standalone)').matches

    const body = { url, format_id: format.id }
    const outputFilename = sanitizeFilename(filename, format.ext)

    if (isPWA) {
      // PWA mode: open direct backend URL in Safari tab
      const params = new URLSearchParams({ url, format_id: format.id })
      const directUrl = `${API_URL}/api/download?${params}`
      setDownloadUrl(directUrl)
      window.open(`/api/download-redirect?${params}`, '_blank')
      onComplete(outputFilename)
      return
    }

    // Browser mode: fetch → streaming blob → <a download>
    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const err = await res.text()
        throw new Error(err || `HTTP ${res.status}`)
      }

      const contentLength = res.headers.get('Content-Length')
      const total = contentLength ? parseInt(contentLength) : null
      const mimeType = res.headers.get('Content-Type') || 'application/octet-stream'
      let loaded = 0

      let blob: Blob
      const reader = res.body?.getReader()

      if (reader) {
        // Streaming path — tracks progress
        const chunks: Uint8Array[] = []
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
          loaded += value.length
          if (total) onProgress(Math.round((loaded / total) * 100))
          else onProgress(-1) // indeterminate
        }
        blob = new Blob(chunks, { type: mimeType })
      } else {
        // Fallback for browsers without ReadableStream body support
        onProgress(-1)
        blob = await res.blob()
      }
      const href = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = href
      a.download = outputFilename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(href)

      onProgress(100)
      onComplete(outputFilename)
    } catch (e: unknown) {
      onError(e instanceof Error ? e.message : 'Download failed')
    }
  }

  const isDownloading = state === 'downloading'
  const isDone = state === 'done'

  return (
    <div className="flex flex-col gap-3">
      {/* Main button */}
      <button
        onClick={handleDownload}
        disabled={isDownloading || isDone || !format}
        className={`
          relative w-full py-4 rounded-xl font-semibold text-sm transition-all overflow-hidden
          ${isDone
            ? 'bg-green-500/20 text-green-400 border border-green-500/30'
            : isDownloading
            ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 cursor-not-allowed'
            : 'bg-indigo-500 hover:bg-indigo-400 text-white active:scale-95'
          }
        `}
      >
        {/* Progress bar */}
        <AnimatePresence>
          {isDownloading && progress >= 0 && progress < 100 && (
            <motion.div
              className="absolute inset-0 bg-indigo-500/30"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: progress / 100 }}
              style={{ transformOrigin: 'left' }}
              transition={{ ease: 'linear' }}
            />
          )}
          {isDownloading && progress === -1 && (
            <motion.div
              className="absolute inset-0 bg-gradient-to-r from-transparent via-indigo-500/20 to-transparent"
              animate={{ x: ['-100%', '100%'] }}
              transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
            />
          )}
        </AnimatePresence>

        <span className="relative z-10 flex items-center justify-center gap-2">
          {isDone ? (
            <>✓ Downloaded</>
          ) : isDownloading ? (
            <>
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              {progress > 0 ? `Downloading ${progress}%` : 'Downloading...'}
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download{format ? ` ${format.quality} ${format.ext.toUpperCase()}` : ''}
            </>
          )}
        </span>
      </button>

      {/* iOS PWA copy link fallback */}
      {downloadUrl && (
        <button
          onClick={() => {
            navigator.clipboard.writeText(downloadUrl).then(() => alert('Link copied! Open in Safari to download.'))
          }}
          className="w-full py-3 rounded-xl border border-[#334155] text-slate-400 text-sm hover:border-indigo-500/40 hover:text-white transition-colors"
        >
          Copy Download Link
        </button>
      )}
    </div>
  )
}
