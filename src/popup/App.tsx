/**
 * Popup App — main control panel for LeadSync.
 *
 * Layout (top → bottom):
 *   Header       — logo, version, active-tab indicator
 *   Auth         — Google sign-in / signed-in card
 *   Error banner — any transient error
 *   Sheet config — spreadsheet + worksheet pickers
 *   Stats bar    — imported / duplicates / errors counters
 *   Bulk progress— live progress bar for 530-lead sync
 *   Tab bar      — Sync Controls | Import Log
 *   Tab content  — actions / log
 *   Footer
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Zap, Activity, PanelRight, ToggleLeft, ToggleRight,
  RotateCcw, AlertTriangle, RefreshCw, Layers,
  CheckCircle2, Loader2,
} from 'lucide-react';
import { useAuth }   from '@/hooks/useAuth';
import { useSheets } from '@/hooks/useSheets';
import { useLeads }  from '@/hooks/useLeads';
import { AuthButton }         from '@/components/AuthButton';
import { SpreadsheetPicker }  from '@/components/SpreadsheetPicker';
import { WorksheetPicker }    from '@/components/WorksheetPicker';
import { SyncButton }         from '@/components/SyncButton';
import { ImportLog }          from '@/components/ImportLog';
import { StatusBadge }        from '@/components/StatusBadge';
import type { Spreadsheet, Worksheet, BulkSyncProgress } from '@/types';

type Tab = 'sync' | 'log';

// ─── Bulk progress bar ────────────────────────────────────────────────────────

function BulkProgressBar({ progress }: { progress: BulkSyncProgress }) {
  const pct = progress.total > 0
    ? Math.min(100, Math.round((progress.current / progress.total) * 100))
    : 0;

  return (
    <div className="px-3 py-3 rounded-2xl bg-brand-600/10 border border-brand-500/20 space-y-2">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5">
          {progress.done
            ? <CheckCircle2 size={12} className="text-emerald-400" />
            : <Loader2 size={12} className="text-brand-400 animate-spin" />}
          <span className="font-semibold text-white">
            {progress.done ? 'Bulk sync complete' : `Syncing all leads…`}
          </span>
        </div>
        <span className="text-slate-400 tabular-nums">
          {progress.current} / {progress.total}
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-surface-800 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-400 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Stats */}
      <div className="flex items-center gap-3 text-[11px]">
        <span className="text-emerald-400">✓ {progress.imported} imported</span>
        <span className="text-amber-400">⊘ {progress.duplicates} dup</span>
        <span className="text-red-400">✕ {progress.errors} errors</span>
        <span className="ml-auto text-slate-500">Page {progress.page}</span>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const { authState, loading: authLoading, error: authError, signIn, signOut } = useAuth();
  const {
    spreadsheets, worksheets, config, loading: sheetsLoading,
    fetchConfig, fetchSpreadsheets, fetchWorksheets, updateConfig,
  } = useSheets();
  const {
    currentLead, syncStats, importLog,
    syncing, lastResult, error: syncError,
    syncLead, syncAllLeads, resetStats, clearLog,
  } = useLeads();

  const [activeTab,     setActiveTab]     = useState<Tab>('sync');
  const [isOnIndiaMART, setIsOnIndiaMART] = useState(false);
  const [isLeadManager, setIsLeadManager] = useState(false);
  const [bulkProgress,  setBulkProgress]  = useState<BulkSyncProgress | null>(null);
  const [bulkRunning,   setBulkRunning]   = useState(false);
  const activeTabIdRef = useRef<number | null>(null);

  // Detect active tab URL
  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab?.id) activeTabIdRef.current = tab.id;
      const url = tab?.url ?? '';
      setIsOnIndiaMART(url.includes('indiamart.com'));
      setIsLeadManager(/seller\.indiamart\.com\/messagecentre/i.test(url));
    });
  }, []);

  // Listen for bulk progress updates from content script
  useEffect(() => {
    const handler = (message: { type: string; payload?: BulkSyncProgress }) => {
      if (message.type === 'BULK_SYNC_PROGRESS' && message.payload) {
        setBulkProgress(message.payload);
        if (message.payload.done) setBulkRunning(false);
      }
    };
    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  // Load config once authenticated
  useEffect(() => {
    if (authState.isAuthenticated) fetchConfig();
  }, [authState.isAuthenticated, fetchConfig]);

  // Load worksheets when spreadsheet selection changes
  useEffect(() => {
    if (config?.spreadsheetId) fetchWorksheets(config.spreadsheetId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.spreadsheetId]);

  const handleSelectSpreadsheet = useCallback(async (sheet: Spreadsheet) => {
    await updateConfig({
      spreadsheetId:   sheet.id,
      spreadsheetName: sheet.name,
      sheetName:       undefined,
      sheetId:         undefined,
    });
    await fetchWorksheets(sheet.id);
  }, [updateConfig, fetchWorksheets]);

  const handleSelectWorksheet = useCallback(async (ws: Worksheet) => {
    await updateConfig({ sheetName: ws.title, sheetId: ws.id });
  }, [updateConfig]);

  const handleToggleAutoSync = useCallback(async () => {
    await updateConfig({ autoSync: !config?.autoSync });
  }, [updateConfig, config?.autoSync]);

  const handleOpenSidePanel = useCallback(async () => {
    await chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL' });
  }, []);

  const handleRefreshLead = useCallback(async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_LEAD' });
    }
  }, []);

  // ── Bulk sync all 530 leads ───────────────────────────────────────────────
  const handleBulkSync = useCallback(async () => {
    const tabId = activeTabIdRef.current;
    if (!tabId) return;
    setBulkRunning(true);
    setBulkProgress({ total: 530, current: 0, imported: 0, duplicates: 0, errors: 0, page: 1, done: false });
    await chrome.tabs.sendMessage(tabId, { type: 'SYNC_ALL_PAGES' });
  }, []);

  const isConfigured  = !!(config?.spreadsheetId && config?.sheetName);
  const canSync       = authState.isAuthenticated && isConfigured && isOnIndiaMART;
  const combinedError = authError ?? syncError;

  return (
    <div className="w-[400px] min-h-[520px] max-h-[680px] flex flex-col bg-surface-950 text-white font-sans">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-surface-900 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-lg shadow-brand-900/60">
            <Zap size={13} className="text-white" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-white leading-none tracking-tight">LeadSync</h1>
            <p className="text-[10px] text-slate-500 leading-none mt-0.5">IndiaMART → Google Sheets</p>
          </div>
        </div>

        {/* Active tab indicator */}
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium
          ${isLeadManager
            ? 'bg-brand-500/10 text-brand-400 border border-brand-500/20'
            : isOnIndiaMART
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'bg-slate-800 text-slate-500 border border-white/5'}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${
            isLeadManager ? 'bg-brand-400 animate-pulse' :
            isOnIndiaMART ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'
          }`} />
          {isLeadManager ? 'Lead Manager' : isOnIndiaMART ? 'IndiaMART active' : 'Off-site'}
        </div>
      </header>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="p-4 space-y-4 animate-fade-in">

          {/* Auth */}
          <section>
            <AuthButton
              authState={authState}
              loading={authLoading}
              onSignIn={signIn}
              onSignOut={signOut}
            />
          </section>

          {/* Error banner */}
          {combinedError && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 animate-slide-up">
              <AlertTriangle size={13} className="text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-300 leading-snug">{combinedError}</p>
            </div>
          )}

          {authState.isAuthenticated && (
            <>
              {/* Sheet config */}
              <section className="p-3 rounded-2xl bg-surface-800/40 border border-white/5 space-y-3">
                <SpreadsheetPicker
                  spreadsheets={spreadsheets}
                  config={config}
                  loading={sheetsLoading}
                  onFetch={fetchSpreadsheets}
                  onSelect={handleSelectSpreadsheet}
                />
                <WorksheetPicker
                  worksheets={worksheets}
                  config={config}
                  loading={sheetsLoading}
                  onSelect={handleSelectWorksheet}
                />
              </section>

              {/* Stats bar */}
              <section className="grid grid-cols-3 gap-2">
                {([
                  { key: 'imported',   label: 'Imported',   color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
                  { key: 'duplicates', label: 'Duplicates', color: 'text-amber-400',   bg: 'bg-amber-500/10'  },
                  { key: 'errors',     label: 'Errors',     color: 'text-red-400',     bg: 'bg-red-500/10'    },
                ] as const).map(({ key, label, color, bg }) => (
                  <div key={key} className={`flex flex-col items-center justify-center py-3 rounded-xl ${bg} border border-white/5`}>
                    <span className={`text-xl font-bold ${color}`}>{syncStats[key]}</span>
                    <span className="text-[10px] text-slate-500 mt-0.5 font-medium uppercase tracking-wide">{label}</span>
                  </div>
                ))}
              </section>

              {/* Bulk progress bar — shown while syncing all pages */}
              {bulkProgress && (
                <BulkProgressBar progress={bulkProgress} />
              )}

              {/* Last result pill */}
              {lastResult && !bulkRunning && (
                <div className="flex items-center justify-between text-xs px-1">
                  <span className="text-slate-600">Last sync:</span>
                  <StatusBadge
                    status={lastResult.status}
                    message={lastResult.message.length > 42
                      ? lastResult.message.substring(0, 42) + '…'
                      : lastResult.message}
                  />
                </div>
              )}

              {/* Tab bar */}
              <div className="flex gap-1 p-1 rounded-xl bg-surface-800/50 border border-white/5">
                {(['sync', 'log'] as Tab[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                      activeTab === tab
                        ? 'bg-brand-600 text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    {tab === 'sync' ? 'Sync Controls' : `Log (${importLog.length})`}
                  </button>
                ))}
              </div>

              {/* Sync controls */}
              {activeTab === 'sync' && (
                <section className="space-y-2.5 animate-fade-in">
                  {!isOnIndiaMART && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
                      <AlertTriangle size={12} className="text-amber-400 flex-shrink-0" />
                      <p className="text-xs text-amber-300">
                        Navigate to <strong>seller.indiamart.com/messagecentre</strong> to sync all leads.
                      </p>
                    </div>
                  )}

                  {/* ── BULK SYNC ALL 530 LEADS (Lead Manager) ── */}
                  {isLeadManager && (
                    <div className="p-3 rounded-2xl bg-gradient-to-br from-brand-600/20 to-brand-800/10 border border-brand-500/30 space-y-2.5">
                      <div className="flex items-center gap-2">
                        <Layers size={14} className="text-brand-400" />
                        <p className="text-xs font-semibold text-white">Lead Manager detected</p>
                      </div>
                      <p className="text-[11px] text-slate-400 leading-snug">
                        LeadSync will auto-paginate through all pages and import every lead into your Google Sheet.
                        Duplicates are skipped automatically.
                      </p>
                      <button
                        id="btn-bulk-sync-all"
                        onClick={handleBulkSync}
                        disabled={!canSync || bulkRunning}
                        className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all duration-200 ${
                          bulkRunning
                            ? 'bg-brand-700/50 text-brand-300 cursor-not-allowed'
                            : canSync
                              ? 'bg-brand-600 hover:bg-brand-500 text-white shadow-lg shadow-brand-900/40'
                              : 'bg-surface-700 text-slate-500 cursor-not-allowed'
                        }`}
                      >
                        {bulkRunning
                          ? <><Loader2 size={14} className="animate-spin" /> Syncing all leads…</>
                          : <><Zap size={14} /> Sync All 530 Leads</>}
                      </button>
                    </div>
                  )}

                  {/* Current lead preview */}
                  {currentLead && !isLeadManager && (
                    <div className="px-3 py-2.5 rounded-xl bg-surface-800/50 border border-white/5 space-y-1">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium text-slate-300 truncate flex-1">
                          {currentLead.buyerName ?? currentLead.company ?? 'Detected lead'}
                        </p>
                        <button
                          onClick={handleRefreshLead}
                          title="Re-extract from current page"
                          className="ml-2 text-slate-600 hover:text-slate-400 transition-colors"
                        >
                          <RefreshCw size={11} />
                        </button>
                      </div>
                      {currentLead.product && (
                        <p className="text-xs text-slate-500 truncate">{currentLead.product}</p>
                      )}
                      {currentLead.mobile && (
                        <p className="text-xs text-slate-500">{currentLead.mobile}</p>
                      )}
                    </div>
                  )}

                  {!isLeadManager && (
                    <>
                      <SyncButton
                        id="btn-sync-current"
                        label="Sync Current Lead"
                        onClick={() => currentLead && syncLead(currentLead)}
                        disabled={!canSync || !currentLead}
                        loading={syncing}
                        result={lastResult}
                        variant="primary"
                      />

                      <SyncButton
                        id="btn-sync-all"
                        label="Sync Visible Leads (this page)"
                        icon={Activity}
                        onClick={syncAllLeads}
                        disabled={!canSync}
                        loading={syncing}
                        variant="secondary"
                      />
                    </>
                  )}

                  <SyncButton
                    id="btn-open-sidepanel"
                    label="View & Edit Lead Details"
                    icon={PanelRight}
                    onClick={handleOpenSidePanel}
                    disabled={!currentLead}
                    variant="secondary"
                  />

                  {/* Auto-sync toggle */}
                  <div className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-surface-800/40 border border-white/5">
                    <div className="min-w-0 mr-3">
                      <p className="text-sm font-medium text-slate-300 leading-none">Auto-Sync</p>
                      <p className="text-xs text-slate-500 leading-snug mt-0.5">
                        Import leads automatically while browsing
                      </p>
                    </div>
                    <button
                      id="btn-toggle-autosync"
                      onClick={handleToggleAutoSync}
                      aria-pressed={config?.autoSync}
                      className={`flex-shrink-0 transition-colors ${
                        config?.autoSync ? 'text-brand-400' : 'text-slate-600'
                      }`}
                    >
                      {config?.autoSync
                        ? <ToggleRight size={30} />
                        : <ToggleLeft  size={30} />
                      }
                    </button>
                  </div>

                  {/* Reset */}
                  <button
                    id="btn-reset-stats"
                    onClick={resetStats}
                    className="w-full flex items-center justify-center gap-1.5 py-2 text-xs text-slate-700 hover:text-slate-400 transition-colors"
                  >
                    <RotateCcw size={10} />
                    Reset statistics
                  </button>
                </section>
              )}

              {/* Import log */}
              {activeTab === 'log' && (
                <section className="animate-fade-in">
                  <ImportLog entries={importLog} onClear={clearLog} />
                </section>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="flex items-center justify-center px-4 py-2 border-t border-white/5 flex-shrink-0">
        <p className="text-[10px] text-slate-700 font-medium">LeadSync v1.0.0 · Manifest V3</p>
      </footer>
    </div>
  );
}
