/**
 * Shared TypeScript types and interfaces used across the entire extension.
 * All runtime-erased (no JavaScript output from this file).
 */

// ─── Core Domain ──────────────────────────────────────────────────────────────

/** A lead extracted from an IndiaMART page. */
export interface Lead {
  /** SHA-256 hash used as the unique Lead ID (set by background after hashing). */
  leadId?: string;

  // ── IndiaMART Lead Manager columns ──────────────────────────────────────
  buyerName:   string | null;   // SENDER name
  company:     string | null;   // Company (buyer detail pages)
  mobile:      string | null;   // Phone number
  email:       string | null;   // Email
  product:     string | null;   // REQUIREMENT / product name
  quantity:    string | null;   // Quantity from requirement column
  requirement: string | null;   // MESSAGE preview text
  budget:      string | null;   // Budget (buyer detail pages)
  city:        string | null;   // LOCATION
  state:       string | null;   // State
  source:      string | null;   // SOURCE (Buylead / Direct / Other / Catalog Link)
  leadDate:    string | null;   // DATE/TIME column
  labels:      string | null;   // LABELS column (comma-separated)

  // ── Meta ──────────────────────────────────────────────────────────────────
  sourceUrl:   string;
  importedAt?: string;
}

/** Mutable version used in the side-panel form. */
export type EditableLead = Omit<Lead, 'leadId' | 'importedAt'>;

/** Result of a single lead sync attempt. */
export interface SyncResult {
  status:      'imported' | 'duplicate' | 'error' | 'skipped';
  message:     string;
  rowNumber?:  number;
  leadId?:     string;
}

/** Cumulative sync statistics stored in chrome.storage.local. */
export interface SyncStats {
  imported:    number;
  duplicates:  number;
  errors:      number;
  lastSyncAt?: string;
}

// ─── Bulk sync progress ───────────────────────────────────────────────────────

/** Progress update sent during a bulk 530-lead sync. */
export interface BulkSyncProgress {
  total:      number;
  current:    number;
  imported:   number;
  duplicates: number;
  errors:     number;
  page:       number;
  done:       boolean;
}

// ─── Import Log ───────────────────────────────────────────────────────────────

/** One entry in the rolling import log. */
export interface ImportLogEntry {
  id:          string;
  timestamp:   string;
  status:      SyncResult['status'];
  leadId?:     string;
  buyerName?:  string | null;
  company?:    string | null;
  product?:    string | null;
  mobile?:     string | null;
  message?:    string;
  sheetName?:  string;
  rowNumber?:  number;
}

// ─── Configuration ────────────────────────────────────────────────────────────

/** User configuration stored in chrome.storage.sync. */
export interface AppConfig {
  spreadsheetId?:   string;
  spreadsheetName?: string;
  sheetName?:       string;
  sheetId?:         number;
  autoSync:         boolean;
  autoSyncNotify:   boolean;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

/** Authentication state stored in chrome.storage.session. */
export interface AuthState {
  isAuthenticated: boolean;
  email?:          string;
  displayName?:    string;
  picture?:        string;
}

// ─── Google API ───────────────────────────────────────────────────────────────

/** A Google Drive spreadsheet file. */
export interface Spreadsheet {
  id:            string;
  name:          string;
  modifiedTime?: string;
}

/** A worksheet (tab) inside a Google Spreadsheet. */
export interface Worksheet {
  id:           number;
  title:        string;
  index:        number;
  rowCount?:    number;
  columnCount?: number;
}

// ─── Messaging ────────────────────────────────────────────────────────────────

/** All message types exchanged via chrome.runtime.sendMessage. */
export type MessageType =
  | 'SIGN_IN'
  | 'SIGN_OUT'
  | 'GET_AUTH_STATE'
  | 'GET_CONFIG'
  | 'SET_CONFIG'
  | 'GET_SPREADSHEETS'
  | 'GET_WORKSHEETS'
  | 'SYNC_LEAD'
  | 'SYNC_ALL_LEADS'
  | 'SYNC_ALL_PAGES'          // NEW: bulk sync all pages (530 leads)
  | 'BULK_SYNC_PROGRESS'      // NEW: progress update from content → popup
  | 'INJECT_INTERCEPTOR'      // NEW: content → background → executeScript(MAIN world)
  | 'GET_IMPORT_LOG'
  | 'CLEAR_IMPORT_LOG'
  | 'GET_SYNC_STATS'
  | 'RESET_SYNC_STATS'
  | 'OPEN_SIDE_PANEL'
  | 'EXTRACT_LEAD'
  | 'LEAD_EXTRACTED'
  | 'AUTO_SYNC_TRIGGERED';

export interface Message<T = unknown> {
  type:     MessageType;
  payload?: T;
}

export interface MessageResponse<T = unknown> {
  success: boolean;
  data?:   T;
  error?:  string;
}
