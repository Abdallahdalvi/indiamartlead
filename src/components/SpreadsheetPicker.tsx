import { useEffect } from 'react';
import { Table2, ChevronDown, Loader2, RefreshCw } from 'lucide-react';
import type { Spreadsheet, AppConfig } from '@/types';

interface SpreadsheetPickerProps {
  spreadsheets: Spreadsheet[];
  config:       AppConfig | null;
  loading:      boolean;
  onFetch:      () => void;
  onSelect:     (sheet: Spreadsheet) => void;
}

export function SpreadsheetPicker({
  spreadsheets, config, loading, onFetch, onSelect,
}: SpreadsheetPickerProps) {
  // Auto-load on first render
  useEffect(() => {
    if (spreadsheets.length === 0) onFetch();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor="select-spreadsheet" className="text-xs font-medium text-slate-400 uppercase tracking-wider">
          Spreadsheet
        </label>
        <button
          onClick={onFetch}
          disabled={loading}
          className="flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300 disabled:opacity-40 transition-colors"
          title="Refresh spreadsheet list"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-surface-800 border border-white/5">
          <Loader2 size={13} className="text-brand-400 animate-spin" />
          <span className="text-sm text-slate-400">Loading your sheets…</span>
        </div>
      ) : (
        <div className="relative">
          <Table2 size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          <select
            id="select-spreadsheet"
            value={config?.spreadsheetId ?? ''}
            onChange={(e) => {
              const sheet = spreadsheets.find((s) => s.id === e.target.value);
              if (sheet) onSelect(sheet);
            }}
            className="w-full pl-8 pr-8 py-2.5 rounded-xl bg-surface-800 border border-white/5
              text-sm text-slate-200 appearance-none cursor-pointer
              hover:border-brand-500/30 focus:border-brand-500
              focus:outline-none focus:ring-1 focus:ring-brand-500/20
              transition-colors"
          >
            <option value="">Select a spreadsheet…</option>
            {spreadsheets.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
        </div>
      )}
    </div>
  );
}
