import { Layers, ChevronDown, Loader2 } from 'lucide-react';
import type { Worksheet, AppConfig } from '@/types';

interface WorksheetPickerProps {
  worksheets: Worksheet[];
  config:     AppConfig | null;
  loading:    boolean;
  onSelect:   (ws: Worksheet) => void;
}

export function WorksheetPicker({ worksheets, config, loading, onSelect }: WorksheetPickerProps) {
  if (!config?.spreadsheetId) return null;

  return (
    <div className="space-y-1.5">
      <label htmlFor="select-worksheet" className="block text-xs font-medium text-slate-400 uppercase tracking-wider">
        Worksheet
      </label>

      {loading ? (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-surface-800 border border-white/5">
          <Loader2 size={13} className="text-brand-400 animate-spin" />
          <span className="text-sm text-slate-400">Loading tabs…</span>
        </div>
      ) : (
        <div className="relative">
          <Layers size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <select
            id="select-worksheet"
            value={config?.sheetName ?? ''}
            onChange={(e) => {
              const ws = worksheets.find((w) => w.title === e.target.value);
              if (ws) onSelect(ws);
            }}
            className="w-full pl-8 pr-8 py-2.5 rounded-xl bg-surface-800 border border-white/5
              text-sm text-slate-200 appearance-none cursor-pointer
              hover:border-brand-500/30 focus:border-brand-500
              focus:outline-none focus:ring-1 focus:ring-brand-500/20
              transition-colors"
          >
            <option value="">Select a worksheet tab…</option>
            {worksheets.map((w) => (
              <option key={w.id} value={w.title}>
                {w.title}
                {w.rowCount ? ` (${w.rowCount.toLocaleString()} rows)` : ''}
              </option>
            ))}
          </select>
          <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
        </div>
      )}
    </div>
  );
}
