'use client'

import { useState, useRef, useEffect } from 'react'

const PLATFORM_ICONS: Record<string, string> = {
  youtube: '▶',
  tiktok: '♪',
  instagram: '◈',
  twitter: '𝕏',
  facebook: 'f',
  reddit: '●',
  vimeo: '▶',
  soundcloud: '♫',
  twitch: '◉',
  pinterest: 'P',
  dailymotion: '▶',
  bilibili: 'B',
  direct: '⬇',
}

const PLATFORM_COLORS: Record<string, string> = {
  youtube: 'bg-red-500/20 text-red-400 border-red-500/30',
  tiktok: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  instagram: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  twitter: 'bg-sky-500/20 text-sky-400 border-sky-500/30',
  facebook: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  reddit: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  direct: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
}

function detectPlatform(url: string): string {
  const u = url.toLowerCase()
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube'
  if (u.includes('tiktok.com')) return 'tiktok'
  if (u.includes('instagram.com')) return 'instagram'
  if (u.includes('twitter.com') || u.includes('x.com')) return 'twitter'
  if (u.includes('facebook.com') || u.includes('fb.com') || u.includes('fb.watch')) return 'facebook'
  if (u.includes('reddit.com') || u.includes('redd.it') || u.includes('v.redd.it')) return 'reddit'
  if (u.includes('vimeo.com')) return 'vimeo'
  if (u.includes('soundcloud.com')) return 'soundcloud'
  if (u.includes('twitch.tv')) return 'twitch'
  if (u.includes('pinterest.com') || u.includes('pin.it')) return 'pinterest'
  if (u.includes('dailymotion.com')) return 'dailymotion'
  if (u.includes('bilibili.com') || u.includes('b23.tv')) return 'bilibili'
  if (u.match(/^https?:\/\//)) return 'direct'
  return ''
}

function isValidUrl(s: string) {
  try {
    new URL(s)
    return true
  } catch {
    return false
  }
}

interface Props {
  onAnalyze: (url: string) => void
  onClear: () => void
  isLoading: boolean
  disabled: boolean
  currentUrl: string
}

export default function URLInput({ onAnalyze, onClear, isLoading, disabled, currentUrl }: Props) {
  const [value, setValue] = useState(currentUrl)
  const [platform, setPlatform] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!currentUrl) setValue('')
  }, [currentUrl])

  const handleChange = (v: string) => {
    setValue(v)
    setPlatform(isValidUrl(v) ? detectPlatform(v) : '')
  }

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText()
      handleChange(text)
      if (isValidUrl(text)) {
        onAnalyze(text)
      }
    } catch {
      inputRef.current?.focus()
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (isValidUrl(value)) onAnalyze(value)
  }

  const handleClear = () => {
    setValue('')
    setPlatform('')
    onClear()
    inputRef.current?.focus()
  }

  const platformColor = PLATFORM_COLORS[platform] || 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30'
  const platformIcon = PLATFORM_ICONS[platform]

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className={`
        flex items-center gap-2 rounded-xl border bg-[#1e293b] px-3 py-3
        transition-colors duration-200
        ${disabled ? 'opacity-50 pointer-events-none' : ''}
        ${platform ? 'border-indigo-500/40' : 'border-[#334155] focus-within:border-indigo-500/40'}
      `}>
        {/* Platform badge or search icon */}
        <div className={`
          shrink-0 w-8 h-8 rounded-lg border flex items-center justify-center text-sm font-bold
          transition-all duration-200
          ${platform ? platformColor : 'bg-slate-700/50 text-slate-400 border-slate-600'}
        `}>
          {platformIcon || (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
            </svg>
          )}
        </div>

        {/* Input */}
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="Paste a link to download..."
          className="flex-1 bg-transparent text-white placeholder-slate-500 text-sm outline-none min-w-0"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          disabled={disabled}
        />

        {/* Actions */}
        {value ? (
          <button
            type="button"
            onClick={handleClear}
            className="shrink-0 w-6 h-6 rounded-full bg-slate-600 flex items-center justify-center text-slate-300 hover:bg-slate-500 transition-colors text-xs"
            aria-label="Clear"
          >
            ✕
          </button>
        ) : (
          <button
            type="button"
            onClick={handlePaste}
            className="shrink-0 px-3 py-1.5 rounded-lg bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 text-xs font-medium hover:bg-indigo-500/30 transition-colors"
          >
            Paste
          </button>
        )}
      </div>

      {/* Submit button — only shows when URL is valid and not yet loading */}
      {isValidUrl(value) && !isLoading && !currentUrl && (
        <button
          type="submit"
          className="mt-3 w-full py-3 rounded-xl bg-indigo-500 hover:bg-indigo-400 text-white font-semibold text-sm transition-colors"
        >
          Analyze Link
        </button>
      )}

      {isLoading && (
        <div className="mt-3 w-full py-3 rounded-xl bg-indigo-500/20 border border-indigo-500/30 text-indigo-400 text-sm text-center flex items-center justify-center gap-2">
          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Analyzing...
        </div>
      )}
    </form>
  )
}
