'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { HistoryItem } from '@/app/page'

const PLATFORM_COLORS: Record<string, string> = {
  youtube: 'text-red-400',
  tiktok: 'text-pink-400',
  instagram: 'text-purple-400',
  twitter: 'text-sky-400',
  facebook: 'text-blue-400',
  reddit: 'text-orange-400',
  direct: 'text-slate-400',
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

interface Props {
  open: boolean
  onClose: () => void
  onSelect: (item: HistoryItem) => void
}

export default function HistoryPanel({ open, onClose, onSelect }: Props) {
  const [history, setHistory] = useState<HistoryItem[]>([])

  useEffect(() => {
    if (open) {
      const stored = JSON.parse(localStorage.getItem('linkdrop-history') || '[]')
      setHistory(stored)
    }
  }, [open])

  const clearHistory = () => {
    localStorage.removeItem('linkdrop-history')
    setHistory([])
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
          />

          {/* Sheet */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-50 bg-[#1e293b] rounded-t-2xl border-t border-[#334155] max-h-[80vh] flex flex-col"
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-2">
              <div className="w-10 h-1 rounded-full bg-slate-600" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-4 pb-3 border-b border-[#334155]">
              <h2 className="text-white font-semibold">Download History</h2>
              <div className="flex items-center gap-3">
                {history.length > 0 && (
                  <button onClick={clearHistory} className="text-slate-500 hover:text-red-400 text-xs transition-colors">
                    Clear all
                  </button>
                )}
                <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="overflow-y-auto flex-1 safe-bottom">
              {history.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-slate-500 gap-2">
                  <span className="text-3xl">📭</span>
                  <p className="text-sm">No downloads yet</p>
                </div>
              ) : (
                <div className="divide-y divide-[#334155]/50">
                  {history.map((item, i) => (
                    <button
                      key={i}
                      onClick={() => onSelect(item)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-800/50 transition-colors text-left"
                    >
                      <div className={`shrink-0 w-8 h-8 rounded-lg bg-slate-700/50 flex items-center justify-center text-xs font-bold ${PLATFORM_COLORS[item.platform] || 'text-slate-400'}`}>
                        {item.platform.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm truncate">{item.title}</p>
                        <p className="text-slate-500 text-xs">{item.filename} · {timeAgo(item.timestamp)}</p>
                      </div>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-slate-500 shrink-0">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                      </svg>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
