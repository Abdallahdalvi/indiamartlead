/**
 * useLeads — React hook for lead sync operations.
 *
 * Manages:
 *   - currentLead  — the lead detected on the active IndiaMART tab
 *   - syncStats    — cumulative import / duplicate / error counters
 *   - importLog    — rolling history of sync events
 *   - sync actions — syncLead, syncAllLeads
 *
 * The currentLead is kept in sync via:
 *   1. chrome.storage.local.onChanged  (for background-pushed updates)
 *   2. chrome.runtime.onMessage        (for real-time LEAD_EXTRACTED events)
 */

import { useState, useCallback, useEffect } from 'react';
import type { Lead, SyncResult, SyncStats, ImportLogEntry, Message, MessageResponse } from '@/types';
import { STORAGE_KEYS } from '@/constants';

function send<T = unknown>(msg: Message): Promise<MessageResponse<T>> {
  return chrome.runtime.sendMessage(msg) as Promise<MessageResponse<T>>;
}

interface UseLeadsReturn {
  currentLead:   Lead | null;
  setCurrentLead:(lead: Lead | null) => void;
  syncStats:     SyncStats;
  importLog:     ImportLogEntry[];
  syncing:       boolean;
  lastResult:    SyncResult | null;
  error:         string | null;
  syncLead:      (lead: Lead) => Promise<MessageResponse<SyncResult>>;
  syncAllLeads:  () => Promise<MessageResponse>;
  fetchStats:    () => Promise<void>;
  fetchLog:      () => Promise<void>;
  resetStats:    () => Promise<void>;
  clearLog:      () => Promise<void>;
}

export function useLeads(): UseLeadsReturn {
  const [currentLead, setCurrentLead] = useState<Lead | null>(null);
  const [syncStats,   setSyncStats]   = useState<SyncStats>({ imported: 0, duplicates: 0, errors: 0 });
  const [importLog,   setImportLog]   = useState<ImportLogEntry[]>([]);
  const [syncing,     setSyncing]     = useState(false);
  const [lastResult,  setLastResult]  = useState<SyncResult | null>(null);
  const [error,       setError]       = useState<string | null>(null);

  // ── Load stats & log ───────────────────────────────────────────────────────

  const fetchStats = useCallback(async () => {
    const res = await send<SyncStats>({ type: 'GET_SYNC_STATS' });
    if (res.success && res.data) setSyncStats(res.data);
  }, []);

  const fetchLog = useCallback(async () => {
    const res = await send<ImportLogEntry[]>({ type: 'GET_IMPORT_LOG' });
    if (res.success && res.data) setImportLog(res.data);
  }, []);

  useEffect(() => {
    fetchStats();
    fetchLog();
  }, [fetchStats, fetchLog]);

  // ── Current lead: storage polling + live messages ──────────────────────────

  useEffect(() => {
    // Initial read from storage (in case sidepanel was opened after extraction)
    chrome.storage.local.get(STORAGE_KEYS.CURRENT_LEAD, (result) => {
      if (result[STORAGE_KEYS.CURRENT_LEAD]) {
        setCurrentLead(result[STORAGE_KEYS.CURRENT_LEAD] as Lead);
      }
    });

    // React to background writing a new lead
    const storageHandler = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes[STORAGE_KEYS.CURRENT_LEAD]?.newValue) {
        setCurrentLead(changes[STORAGE_KEYS.CURRENT_LEAD].newValue as Lead);
      }
    };
    chrome.storage.local.onChanged.addListener(storageHandler);

    // Also react to LEAD_EXTRACTED messages for instant updates
    const msgHandler = (msg: Message) => {
      if (msg.type === 'LEAD_EXTRACTED' && msg.payload) {
        setCurrentLead(msg.payload as Lead);
      }
    };
    chrome.runtime.onMessage.addListener(msgHandler);

    // Stats/log re-fetch after any storage write
    const statsHandler = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (changes[STORAGE_KEYS.SYNC_STATS]?.newValue) {
        setSyncStats(changes[STORAGE_KEYS.SYNC_STATS].newValue as SyncStats);
      }
      if (changes[STORAGE_KEYS.IMPORT_LOG]?.newValue) {
        setImportLog(changes[STORAGE_KEYS.IMPORT_LOG].newValue as ImportLogEntry[]);
      }
    };
    chrome.storage.local.onChanged.addListener(statsHandler);

    return () => {
      chrome.storage.local.onChanged.removeListener(storageHandler);
      chrome.storage.local.onChanged.removeListener(statsHandler);
      chrome.runtime.onMessage.removeListener(msgHandler);
    };
  }, []);

  // ── Sync a single lead ─────────────────────────────────────────────────────

  const syncLead = useCallback(async (lead: Lead): Promise<MessageResponse<SyncResult>> => {
    setSyncing(true);
    setError(null);
    try {
      const res = await send<SyncResult>({ type: 'SYNC_LEAD', payload: lead });
      if (res.success && res.data) {
        setLastResult(res.data);
      } else {
        setError(res.error ?? 'Sync failed.');
      }
      return res;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sync failed.';
      setError(msg);
      return { success: false, error: msg };
    } finally {
      setSyncing(false);
    }
  }, []);

  // ── Sync all visible leads (via content script) ────────────────────────────

  const syncAllLeads = useCallback(async (): Promise<MessageResponse> => {
    setSyncing(true);
    setError(null);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('No active IndiaMART tab found.');

      // Ask the content script to extract all visible leads, then sync via background
      const res = await chrome.tabs.sendMessage(tab.id, {
        type: 'SYNC_ALL_LEADS',
      }) as MessageResponse;

      if (!res?.success) {
        setError(res?.error ?? 'Sync all failed.');
      }
      return res ?? { success: false, error: 'No response from content script.' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sync all failed.';
      setError(msg);
      return { success: false, error: msg };
    } finally {
      setSyncing(false);
    }
  }, []);

  // ── Housekeeping ───────────────────────────────────────────────────────────

  const resetStats = useCallback(async () => {
    await send({ type: 'RESET_SYNC_STATS' });
    setSyncStats({ imported: 0, duplicates: 0, errors: 0 });
  }, []);

  const clearLog = useCallback(async () => {
    await send({ type: 'CLEAR_IMPORT_LOG' });
    setImportLog([]);
  }, []);

  return {
    currentLead, setCurrentLead,
    syncStats, importLog,
    syncing, lastResult, error,
    syncLead, syncAllLeads,
    fetchStats, fetchLog,
    resetStats, clearLog,
  };
}
