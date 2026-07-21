/**
 * Side Panel App — lead preview, editing, and import confirmation.
 *
 * Opens via chrome.sidePanel.open() from the popup (Chrome 114+).
 * Displays the lead extracted by the content script, lets the user
 * edit any field before importing, and shows the sync result inline.
 *
 * States:
 *   not-authed   → sign-in prompt
 *   not-config   → select sheet prompt
 *   no-lead      → waiting animation
 *   has-lead     → editable form + import button
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Zap, Link2, AlertTriangle, Edit3, RotateCcw,
  CheckCircle, Copy, XCircle, ExternalLink,
} from 'lucide-react';
import { useAuth }   from '@/hooks/useAuth';
import { useSheets } from '@/hooks/useSheets';
import { useLeads }  from '@/hooks/useLeads';
import { LeadCard }  from '@/components/LeadCard';
import { SyncButton } from '@/components/SyncButton';
import { StatusBadge } from '@/components/StatusBadge';
import type { EditableLead, Lead } from '@/types';

// ─── Result indicator ─────────────────────────────────────────────────────────

function ResultBanner({ status, message }: { status: string; message: string }) {
  const configs = {
    imported:  { cls: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300', Icon: CheckCircle },
    duplicate: { cls: 'bg-amber-500/10  border-amber-500/20  text-amber-300',  Icon: Copy        },
    error:     { cls: 'bg-red-500/10    border-red-500/20    text-red-300',    Icon: XCircle     },
  } as const;
  const cfg = configs[status as keyof typeof configs];
  if (!cfg) return null;
  const { cls, Icon } = cfg;
  return (
    <div className={`flex items-start gap-2 px-3 py-2.5 rounded-xl border text-xs ${cls} animate-slide-up`}>
      <Icon size={12} className="flex-shrink-0 mt-0.5" />
      <p className="leading-snug">{message}</p>
    </div>
  );
}

// ─── Empty states ─────────────────────────────────────────────────────────────

function EmptyState({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6 py-10 space-y-3">
      <div className="w-12 h-12 rounded-2xl bg-surface-800 border border-white/5 flex items-center justify-center mb-1">
        {icon}
      </div>
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      <p className="text-xs text-slate-400 leading-relaxed max-w-[240px]">{body}</p>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SidePanelApp() {
  const { authState }                              = useAuth();
  const { config, fetchConfig }                    = useSheets();
  const { currentLead, syncing, lastResult, syncLead } = useLeads();

  const [editedLead, setEditedLead] = useState<EditableLead | null>(null);
  const [hasEdits,   setHasEdits]   = useState(false);

  // Load config on mount
  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  // When the background pushes a new lead, populate the form
  useEffect(() => {
    if (currentLead) {
      setEditedLead(currentLead);
      setHasEdits(false);
    }
  }, [currentLead]);

  const handleFieldChange = useCallback((field: keyof EditableLead, value: string) => {
    setEditedLead((prev) => prev ? { ...prev, [field]: value || null } : null);
    setHasEdits(true);
  }, []);

  const handleReset = useCallback(() => {
    if (currentLead) { setEditedLead(currentLead); setHasEdits(false); }
  }, [currentLead]);

  const handleSync = useCallback(async () => {
    if (!editedLead) return;
    // Merge edits back into a full Lead object
    const lead: Lead = { ...editedLead };
    await syncLead(lead);
    setHasEdits(false);
  }, [editedLead, syncLead]);

  const isConfigured = !!(config?.spreadsheetId && config?.sheetName);

  // ── Empty states ────────────────────────────────────────────────────────────

  if (!authState.isAuthenticated) {
    return (
      <div className="h-screen bg-surface-950 text-white font-sans">
        <EmptyState
          icon={<Zap size={20} className="text-brand-400" />}
          title="Not connected"
          body="Open the LeadSync popup and sign in with your Google account to get started."
        />
      </div>
    );
  }

  if (!isConfigured) {
    return (
      <div className="h-screen bg-surface-950 text-white font-sans">
        <EmptyState
          icon={<AlertTriangle size={20} className="text-amber-400" />}
          title="No sheet selected"
          body="Open the LeadSync popup to select a Google Spreadsheet and worksheet tab first."
        />
      </div>
    );
  }

  if (!editedLead) {
    return (
      <div className="h-screen bg-surface-950 text-white font-sans">
        <EmptyState
          icon={<Zap size={20} className="text-brand-400 animate-pulse-slow" />}
          title="Waiting for a lead"
          body="Navigate to an IndiaMART lead or message page. LeadSync will automatically extract the details here."
        />
      </div>
    );
  }

  // ── Full lead form ──────────────────────────────────────────────────────────

  return (
    <div className="h-screen flex flex-col bg-surface-950 text-white font-sans">

      {/* Header */}
      <header className="flex-shrink-0 px-4 py-3 bg-surface-900 border-b border-white/5">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
              <Zap size={11} className="text-white" />
            </div>
            <h1 className="text-sm font-bold text-white tracking-tight">Lead Details</h1>
          </div>
          <div className="flex items-center gap-2">
            {hasEdits && (
              <button
                id="btn-reset-edits"
                onClick={handleReset}
                title="Discard edits"
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                <RotateCcw size={10} />
                Reset
              </button>
            )}
            <StatusBadge status={
              syncing ? 'syncing'
              : hasEdits ? 'idle'
              : (lastResult?.status ?? 'idle')
            } />
          </div>
        </div>

        {/* Source URL */}
        {editedLead.sourceUrl && (
          <a
            href={editedLead.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-brand-400 transition-colors max-w-full"
          >
            <Link2 size={9} className="flex-shrink-0" />
            <span className="truncate">{editedLead.sourceUrl}</span>
            <ExternalLink size={9} className="flex-shrink-0" />
          </a>
        )}
      </header>

      {/* Sheet target */}
      <div className="flex-shrink-0 px-4 py-1.5 bg-surface-900/50 border-b border-white/[0.04]">
        <p className="text-[11px] text-slate-500">
          Target:{' '}
          <span className="text-slate-300 font-medium">{config.spreadsheetName ?? config.spreadsheetId}</span>
          <span className="text-slate-600 mx-1">/</span>
          <span className="text-slate-300 font-medium">{config.sheetName}</span>
        </p>
      </div>

      {/* Edits notice */}
      {hasEdits && (
        <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-amber-500/8 border-b border-amber-500/15">
          <Edit3 size={11} className="text-amber-400 flex-shrink-0" />
          <p className="text-[11px] text-amber-300">
            You have unsaved edits — they will be used when syncing.
          </p>
        </div>
      )}

      {/* Scrollable form */}
      <div className="flex-1 overflow-y-auto scrollbar-thin px-4 py-4">
        <LeadCard lead={editedLead} onChange={handleFieldChange} editable />
      </div>

      {/* Footer: result + sync button */}
      <footer className="flex-shrink-0 px-4 py-3 bg-surface-900 border-t border-white/5 space-y-2.5">
        {lastResult && !hasEdits && (
          <ResultBanner status={lastResult.status} message={lastResult.message} />
        )}
        <SyncButton
          id="btn-sidepanel-sync"
          label={syncing ? 'Importing…' : 'Import to Google Sheets'}
          onClick={handleSync}
          loading={syncing}
          result={!hasEdits ? lastResult : null}
          disabled={syncing}
          variant="primary"
        />
      </footer>
    </div>
  );
}
