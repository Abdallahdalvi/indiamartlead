import React, { useState } from 'react';
import {
  CheckCircle, XCircle, SkipForward, ChevronDown, ChevronUp, Trash2,
} from 'lucide-react';
import type { ImportLogEntry } from '@/types';

// ── Status icons ──────────────────────────────────────────────────────────────
const STATUS_ICONS: Record<ImportLogEntry['status'], React.ReactElement> = {
  imported:  <CheckCircle size={11} className="text-emerald-400 flex-shrink-0 mt-0.5" />,
  duplicate: <SkipForward size={11} className="text-amber-400   flex-shrink-0 mt-0.5" />,
  error:     <XCircle     size={11} className="text-red-400     flex-shrink-0 mt-0.5" />,
  skipped:   <SkipForward size={11} className="text-slate-400   flex-shrink-0 mt-0.5" />,
};

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-IN', {
      hour: '2-digit', minute: '2-digit', hour12: true,
    });
  } catch { return '—'; }
}

interface ImportLogProps {
  entries: ImportLogEntry[];
  onClear: () => void;
}

export function ImportLog({ entries, onClear }: ImportLogProps) {
  const [expanded, setExpanded] = useState(true);

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-slate-600">
        <CheckCircle size={24} strokeWidth={1.5} />
        <p className="text-sm">No import history yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-300 transition-colors"
        >
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          {entries.length} event{entries.length !== 1 ? 's' : ''}
        </button>
        <button
          id="btn-clear-log"
          onClick={onClear}
          className="flex items-center gap-1 text-xs text-slate-600 hover:text-red-400 transition-colors"
          title="Clear import log"
        >
          <Trash2 size={11} />
          Clear
        </button>
      </div>

      {/* Entries */}
      {expanded && (
        <div className="space-y-1 max-h-52 overflow-y-auto scrollbar-thin pr-0.5 animate-fade-in">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="flex items-start gap-2 px-3 py-2 rounded-lg bg-surface-800/60 border border-white/[0.04] hover:bg-surface-800 transition-colors"
            >
              {STATUS_ICONS[entry.status]}

              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-300 truncate leading-snug">
                  <span className="font-medium">
                    {entry.buyerName ?? entry.company ?? 'Unknown lead'}
                  </span>
                  {entry.product && (
                    <span className="text-slate-500 ml-1">· {entry.product}</span>
                  )}
                </p>
                {entry.message && (
                  <p className="text-xs text-slate-500 truncate mt-0.5 leading-snug">
                    {entry.message}
                  </p>
                )}
              </div>

              <span className="text-xs text-slate-600 flex-shrink-0 mt-0.5">
                {fmtTime(entry.timestamp)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
