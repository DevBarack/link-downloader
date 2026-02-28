'use client'

import { useState } from 'react'
import type { MediaData } from '@/app/page'

const PLATFORM_COLORS: Record<string, string> = {
  youtube: 'bg-red-500/20 text-red-400',
  tiktok: 'bg-pink-500/20 text-pink-400',
  instagram: 'bg-purple-500/20 text-purple-400',
  twitter: 'bg-sky-500/20 text-sky-400',
  facebook: 'bg-blue-500/20 text-blue-400',
  reddit: 'bg-orange-500/20 text-orange-400',
  vimeo: 'bg-cyan-500/20 text-cyan-400',
  soundcloud: 'bg-amber-500/20 text-amber-400',
  twitch: 'bg-violet-500/20 text-violet-400',
  direct: 'bg-slate-500/20 text-slate-400',
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M views`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K views`
  return `${n} views`
}

interface Props {
  data: MediaData
}

export default function MediaInfo({ data }: Props) {
  const [imgError, setImgError] = useState(false)
  const platformColor = PLATFORM_COLORS[data.platform] || PLATFORM_COLORS.direct

  return (
    <div className="rounded-xl bg-[#1e293b] border border-[#334155] p-4">
      <div className="flex gap-3">
        {/* Thumbnail */}
        {data.thumbnail && !imgError ? (
          <div className="shrink-0 w-24 h-16 rounded-lg overflow-hidden bg-slate-700">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={data.thumbnail}
              alt="thumbnail"
              className="w-full h-full object-cover"
              onError={() => setImgError(true)}
              loading="lazy"
            />
          </div>
        ) : (
          <div className="shrink-0 w-24 h-16 rounded-lg bg-slate-700/50 flex items-center justify-center text-2xl text-slate-500">
            {data.is_direct ? '📄' : '🎬'}
          </div>
        )}

        {/* Info */}
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-medium line-clamp-2 leading-snug">
            {data.title}
          </p>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${platformColor}`}>
              {data.platform}
            </span>
            {data.duration && (
              <span className="text-xs text-slate-400">
                {formatDuration(data.duration)}
              </span>
            )}
            {data.view_count && (
              <span className="text-xs text-slate-500">
                {formatViews(data.view_count)}
              </span>
            )}
          </div>
          {data.uploader && (
            <p className="text-xs text-slate-500 mt-1 truncate">{data.uploader}</p>
          )}
        </div>
      </div>
    </div>
  )
}
