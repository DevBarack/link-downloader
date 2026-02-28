'use client'

import type { Format } from '@/app/page'

function formatFilesize(bytes: number | null): string {
  if (!bytes) return ''
  if (bytes >= 1_000_000_000) return ` · ${(bytes / 1_000_000_000).toFixed(1)} GB`
  if (bytes >= 1_000_000) return ` · ${(bytes / 1_000_000).toFixed(0)} MB`
  return ` · ${(bytes / 1_000).toFixed(0)} KB`
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
      <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-3">Quality</p>
      <div className="flex flex-col gap-2">
        {formats.map((f) => (
          <button
            key={f.id}
            onClick={() => onSelect(f)}
            disabled={disabled}
            className={`
              flex items-center justify-between px-3 py-2.5 rounded-lg border text-sm transition-all
              ${selected?.id === f.id
                ? 'border-indigo-500 bg-indigo-500/10 text-white'
                : 'border-[#334155] bg-slate-800/50 text-slate-300 hover:border-indigo-500/40 hover:text-white'
              }
              ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
            `}
          >
            <div className="flex items-center gap-2">
              {selected?.id === f.id && (
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
              )}
              <span className="font-medium">{f.quality}</span>
              <span className="text-slate-500 text-xs uppercase">{f.ext}</span>
            </div>
            {f.filesize && (
              <span className="text-slate-500 text-xs">
                {formatFilesize(f.filesize).replace(' · ', '')}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
