/**
 * Popup App — main control panel for LeadSync.
 *
 * Layout (top → bottom):
 *   Header       — logo, version, active-tab indicator
 *   Auth         — Google sign-in / signed-in card
 *   Error banner — any transient error
 *   Sheet config — spreadsheet + worksheet pickers
 *   Stats bar    — imported / duplicates / errors counters
 *   Tab bar      — Sync Controls | Import Log
 *   Tab content  — actions / log
 *   Footer
 */

import { useEffect, useState, useCallback } from 'react';
import {
  Zap, Activity, PanelRight, ToggleLeft, ToggleRight,
  RotateCcw, AlertTriangle, RefreshCw,
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
import type { Spreadsheet, Worksheet } from '@/types';

type Tab = 'sync' | 'log';

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

  const [activeTab,    setActiveTab]    = useState<Tab>('sync');
  const [isOnIndiaMART, setIsOnIndiaMART] = useState(false);

  // Detect active tab URL
  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      setIsOnIndiaMART(!!(tab?.url?.includes('indiamart.com')));
    });
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
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_LEAD' });
      // The content script will update storage; useLeads listens to storage changes
      if (res) console.log('[LeadSync Popup] Refresh result:', res);
    }
  }, []);

  const isConfigured = !!(config?.spreadsheetId && config?.sheetName);
  const canSync      = authState.isAuthenticated && isConfigured && isOnIndiaMART;
  const combinedError = authError ?? syncError;

  return (
    <div className="w-[400px] min-h-[520px] max-h-[640px] flex flex-col bg-surface-950 text-white font-sans">

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
          ${isOnIndiaMART
            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
            : 'bg-slate-800 text-slate-500 border border-white/5'}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full ${isOnIndiaMART ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
          {isOnIndiaMART ? 'IndiaMART active' : 'Off-site'}
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
                  { key: 'imported',  label: 'Imported',  color: 'text-emerald-400', bg: 'bg-emerald-500/10'  },
                  { key: 'duplicates',label: 'Duplicates', color: 'text-amber-400',  bg: 'bg-amber-500/10'   },
                  { key: 'errors',    label: 'Errors',     color: 'text-red-400',    bg: 'bg-red-500/10'     },
                ] as const).map(({ key, label, color, bg }) => (
                  <div key={key} className={`flex flex-col items-center justify-center py-3 rounded-xl ${bg} border border-white/5`}>
                    <span className={`text-xl font-bold ${color}`}>
                      {syncStats[key]}
                    </span>
                    <span className="text-[10px] text-slate-500 mt-0.5 font-medium uppercase tracking-wide">
                      {label}
                    </span>
                  </div>
                ))}
              </section>

              {/* Last result pill */}
              {lastResult && (
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
                      <p className="text-xs text-amber-300">Navigate to IndiaMART to sync leads.</p>
                    </div>
                  )}

                  {/* Current lead preview */}
                  {currentLead && (
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
                    label="Sync All Visible Leads"
                    icon={Activity}
                    onClick={syncAllLeads}
                    disabled={!canSync}
                    loading={syncing}
                    variant="secondary"
                  />

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
