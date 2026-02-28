'use client'

import type { Format } from '@/app/page'

const QUALITY_META: Record<string, { badge: string; badgeColor: string; desc: string }> = {
  '4K':         { badge: '4K',   badgeColor: 'bg-purple-500/20 text-purple-300 border-purple-500/40', desc: 'Ultra HD · 2160p' },
  '1440p':      { badge: 'QHD',  badgeColor: 'bg-blue-500/20 text-blue-300 border-blue-500/40',       desc: 'Quad HD · 1440p' },
  '1080p':      { badge: 'FHD',  badgeColor: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40', desc: 'Full HD · 1080p' },
  '720p':       { badge: 'HD',   badgeColor: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',       desc: 'HD · 720p' },
  '480p':       { badge: 'SD',   badgeColor: 'bg-slate-500/20 text-slate-400 border-slate-500/40',    desc: 'Standard · 480p' },
  '360p':       { badge: 'SD',   badgeColor: 'bg-slate-600/20 text-slate-500 border-slate-600/40',    desc: 'Low · 360p' },
  'Audio only': { badge: '♫',    badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/40',    desc: 'MP3 audio' },
}

interface Props {
  formats: Format[]
  selected: Format | null
  onSelect: (f: Format) => void
  disabled: boolean
}

export default function FormatPicker({ formats, selected, onSelect, disabled }: Props) {
  return (
    <div className="rounded-xl bg-[#1e293b] border border-[#334155] p-4">
      <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-3">Select Quality</p>
      <div className="grid grid-cols-1 gap-2">
        {formats.map((f) => {
          const meta = QUALITY_META[f.quality] ?? {
            badge: f.quality,
            badgeColor: 'bg-slate-500/20 text-slate-400 border-slate-500/40',
            desc: f.ext.toUpperCase(),
          }
          const isSelected = selected?.id === f.id

          return (
            <button
              key={f.id}
              onClick={() => onSelect(f)}
              disabled={disabled}
              className={`
                flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all
                ${isSelected
                  ? 'border-indigo-500 bg-indigo-500/10'
                  : 'border-[#334155] bg-slate-800/30 hover:border-slate-500 hover:bg-slate-800/60'
                }
                ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              `}
            >
              {/* Quality badge */}
              <span className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded border ${meta.badgeColor}`}>
                {meta.badge}
              </span>

              {/* Label + desc */}
              <div className="flex-1 min-w-0">
                <span className={`text-sm font-medium ${isSelected ? 'text-white' : 'text-slate-300'}`}>
                  {f.quality}
                </span>
                <span className="text-xs text-slate-500 ml-2">{meta.desc}</span>
              </div>

              {/* Selected dot */}
              {isSelected && (
                <div className="shrink-0 w-2 h-2 rounded-full bg-indigo-400" />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
