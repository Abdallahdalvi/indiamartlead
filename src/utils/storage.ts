/**
 * Type-safe, promise-based wrappers around chrome.storage.
 *
 * Storage tiers:
 *   chrome.storage.sync    → AppConfig  (synced across user's devices, small)
 *   chrome.storage.session → AuthState  (ephemeral, cleared on browser close)
 *   chrome.storage.local   → Log, Stats, CurrentLead  (large, persistent)
 */

import type { AppConfig, AuthState, ImportLogEntry, SyncStats } from '@/types';
import { STORAGE_KEYS, MAX_LOG_ENTRIES } from '@/constants';

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: AppConfig = {
  spreadsheetId:   undefined,
  spreadsheetName: undefined,
  sheetName:       undefined,
  sheetId:         undefined,
  autoSync:        false,
  autoSyncNotify:  true,
};

// ─── Config (chrome.storage.sync) ────────────────────────────────────────────

export async function getConfig(): Promise<AppConfig> {
  const result = await chrome.storage.sync.get(STORAGE_KEYS.CONFIG);
  return { ...DEFAULT_CONFIG, ...(result[STORAGE_KEYS.CONFIG] ?? {}) };
}

export async function setConfig(updates: Partial<AppConfig>): Promise<void> {
  const current = await getConfig();
  await chrome.storage.sync.set({
    [STORAGE_KEYS.CONFIG]: { ...current, ...updates },
  });
}

// ─── Auth (chrome.storage.session with local fallback) ────────────────────────

export async function getAuthState(): Promise<AuthState> {
  try {
    const result = await chrome.storage.session.get(STORAGE_KEYS.AUTH);
    if (result[STORAGE_KEYS.AUTH]) return result[STORAGE_KEYS.AUTH] as AuthState;
  } catch {
    // session storage unavailable (e.g., content-script context)
  }
  const result = await chrome.storage.local.get(STORAGE_KEYS.AUTH);
  return (result[STORAGE_KEYS.AUTH] as AuthState | undefined) ?? { isAuthenticated: false };
}

export async function setAuthState(state: AuthState): Promise<void> {
  try {
    await chrome.storage.session.set({ [STORAGE_KEYS.AUTH]: state });
  } catch {
    // no-op — fall through to local
  }
  // Mirror to local so popup/sidepanel can also read it
  await chrome.storage.local.set({ [STORAGE_KEYS.AUTH]: state });
}

export async function clearAuthState(): Promise<void> {
  try {
    await chrome.storage.session.remove(STORAGE_KEYS.AUTH);
  } catch {
    // no-op
  }
  await chrome.storage.local.remove(STORAGE_KEYS.AUTH);
}

// ─── Import Log (chrome.storage.local) ───────────────────────────────────────

export async function getImportLog(): Promise<ImportLogEntry[]> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.IMPORT_LOG);
  return (result[STORAGE_KEYS.IMPORT_LOG] as ImportLogEntry[] | undefined) ?? [];
}

export async function appendLogEntry(entry: ImportLogEntry): Promise<void> {
  const log     = await getImportLog();
  const updated = [entry, ...log].slice(0, MAX_LOG_ENTRIES); // newest-first, capped
  await chrome.storage.local.set({ [STORAGE_KEYS.IMPORT_LOG]: updated });
}

export async function clearImportLog(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.IMPORT_LOG);
}

// ─── Sync Stats (chrome.storage.local) ───────────────────────────────────────

export async function getSyncStats(): Promise<SyncStats> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.SYNC_STATS);
  return (result[STORAGE_KEYS.SYNC_STATS] as SyncStats | undefined) ??
    { imported: 0, duplicates: 0, errors: 0 };
}

export async function incrementStat(key: 'imported' | 'duplicates' | 'errors'): Promise<SyncStats> {
  const stats = await getSyncStats();
  stats[key]        = (stats[key] ?? 0) + 1;
  stats.lastSyncAt  = new Date().toISOString();
  await chrome.storage.local.set({ [STORAGE_KEYS.SYNC_STATS]: stats });
  return stats;
}

export async function resetSyncStats(): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEYS.SYNC_STATS]: { imported: 0, duplicates: 0, errors: 0 },
  });
}

// ─── Current Lead (chrome.storage.local) ─────────────────────────────────────

export async function setCurrentLead(lead: unknown): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.CURRENT_LEAD]: lead });
}

export async function getCurrentLead(): Promise<unknown | null> {
  const result = await chrome.storage.local.get(STORAGE_KEYS.CURRENT_LEAD);
  return result[STORAGE_KEYS.CURRENT_LEAD] ?? null;
}
