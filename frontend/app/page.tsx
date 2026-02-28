'use client'

import { useState, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import URLInput from '@/components/URLInput'
import MediaInfo from '@/components/MediaInfo'
import FormatPicker from '@/components/FormatPicker'
import DownloadButton from '@/components/DownloadButton'
import HistoryPanel from '@/components/HistoryPanel'

export type AppState = 'idle' | 'loading-info' | 'ready' | 'downloading' | 'done' | 'error'

export interface Format {
  id: string
  ext: string
  quality: string
  filesize: number | null
}

export interface MediaData {
  title: string
  thumbnail: string | null
  duration: number | null
  platform: string
  is_direct: boolean
  formats: Format[]
  uploader: string | null
  view_count: number | null
}

export interface HistoryItem {
  url: string
  title: string
  platform: string
  filename: string
  timestamp: number
}

export default function Home() {
  const [state, setState] = useState<AppState>('idle')
  const [url, setUrl] = useState('')
  const [mediaData, setMediaData] = useState<MediaData | null>(null)
  const [selectedFormat, setSelectedFormat] = useState<Format | null>(null)
  const [error, setError] = useState('')
  const [showHistory, setShowHistory] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState(0)

  const handleAnalyze = useCallback(async (inputUrl: string) => {
    if (!inputUrl.trim()) return
    setUrl(inputUrl)
    setState('loading-info')
    setError('')
    setMediaData(null)
    setSelectedFormat(null)

    try {
      const res = await fetch('/api/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: inputUrl }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Unknown error' }))
        throw new Error(err.detail || `HTTP ${res.status}`)
      }
      const data: MediaData = await res.json()
      setMediaData(data)
      setSelectedFormat(data.formats[0] || null)
      setState('ready')
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to analyze URL')
      setState('error')
    }
  }, [])

  const handleClear = useCallback(() => {
    setState('idle')
    setUrl('')
    setMediaData(null)
    setSelectedFormat(null)
    setError('')
    setDownloadProgress(0)
  }, [])

  const handleDownloadComplete = useCallback((filename: string) => {
    setState('done')
    if (mediaData) {
      const item: HistoryItem = {
        url,
        title: mediaData.title,
        platform: mediaData.platform,
        filename,
        timestamp: Date.now(),
      }
      const history: HistoryItem[] = JSON.parse(localStorage.getItem('linkdrop-history') || '[]')
      const updated = [item, ...history].slice(0, 50)
      localStorage.setItem('linkdrop-history', JSON.stringify(updated))
    }
  }, [mediaData, url])

  const handleRedownload = useCallback((histItem: HistoryItem) => {
    setShowHistory(false)
    handleAnalyze(histItem.url)
  }, [handleAnalyze])

  return (
    <main className="flex flex-col min-h-screen bg-[#0f172a] max-w-lg mx-auto px-4 pb-8">
      {/* Header */}
      <div className="flex items-center justify-between pt-6 pb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center text-lg">↓</div>
          <span className="text-xl font-bold text-white tracking-tight">LinkDrop</span>
        </div>
        <button
          onClick={() => setShowHistory(true)}
          className="text-slate-400 hover:text-white transition-colors p-2 rounded-lg hover:bg-slate-800"
          aria-label="Download history"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
      </div>

      {/* URL Input */}
      <URLInput
        onAnalyze={handleAnalyze}
        onClear={handleClear}
        isLoading={state === 'loading-info'}
        disabled={state === 'downloading'}
        currentUrl={url}
      />

      {/* Error */}
      <AnimatePresence>
        {state === 'error' && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-4 p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-sm"
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Media Info + Controls */}
      <AnimatePresence>
        {mediaData && (state === 'ready' || state === 'downloading' || state === 'done') && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-4 flex flex-col gap-4"
          >
            <MediaInfo data={mediaData} />

            {!mediaData.is_direct && mediaData.formats.length > 1 && (
              <FormatPicker
                formats={mediaData.formats}
                selected={selectedFormat}
                onSelect={setSelectedFormat}
                disabled={state === 'downloading'}
              />
            )}

            <DownloadButton
              url={url}
              format={selectedFormat}
              state={state}
              progress={downloadProgress}
              filename={mediaData.title}
              onProgress={setDownloadProgress}
              onComplete={handleDownloadComplete}
              onError={(msg) => { setError(msg); setState('error') }}
              onStart={() => setState('downloading')}
            />

            {state === 'done' && (
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                onClick={handleClear}
                className="text-center text-slate-400 hover:text-white text-sm py-2 transition-colors"
              >
                Download another
              </motion.button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading skeleton */}
      <AnimatePresence>
        {state === 'loading-info' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="mt-4 rounded-xl bg-[#1e293b] border border-[#334155] p-4 space-y-3"
          >
            <div className="flex gap-3">
              <div className="w-20 h-14 rounded-lg bg-slate-700 animate-pulse shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-4 bg-slate-700 rounded animate-pulse" />
                <div className="h-4 bg-slate-700 rounded animate-pulse w-3/4" />
                <div className="h-3 bg-slate-700 rounded animate-pulse w-1/3" />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Empty state */}
      {state === 'idle' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { delay: 0.2 } }}
          className="flex flex-col items-center justify-center flex-1 text-center mt-12 gap-6"
        >
          <div className="w-20 h-20 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-4xl">
            ↓
          </div>
          <div>
            <p className="text-slate-300 text-lg font-medium">Paste any link</p>
            <p className="text-slate-500 text-sm mt-1">YouTube, TikTok, Instagram, Twitter, and 1000+ more</p>
          </div>
          <div className="flex flex-wrap justify-center gap-2 max-w-xs">
            {['YouTube', 'TikTok', 'Instagram', 'Twitter/X', 'Facebook', 'Reddit', 'SoundCloud', 'Vimeo'].map((p) => (
              <span key={p} className="text-xs px-2.5 py-1 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                {p}
              </span>
            ))}
          </div>
        </motion.div>
      )}

      {/* History Panel */}
      <HistoryPanel
        open={showHistory}
        onClose={() => setShowHistory(false)}
        onSelect={handleRedownload}
      />
    </main>
  )
}
