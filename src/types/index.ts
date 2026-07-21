/**
 * Shared TypeScript types and interfaces used across the entire extension.
 * All runtime-erased (no JavaScript output from this file).
 */

// ─── Core Domain ──────────────────────────────────────────────────────────────

/** A lead extracted from an IndiaMART page. */
export interface Lead {
  /** SHA-256 hash used as the unique Lead ID (set by background after hashing). */
  leadId?: string;
  buyerName:   string | null;
  company:     string | null;
  mobile:      string | null;
  email:       string | null;
  product:     string | null;
  quantity:    string | null;
  budget:      string | null;
  requirement: string | null;
  city:        string | null;
  state:       string | null;
  leadDate:    string | null;
  sourceUrl:   string;
  importedAt?: string;
}

/** Mutable version used in the side-panel form (no computed / readonly fields). */
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
  | 'GET_IMPORT_LOG'
  | 'CLEAR_IMPORT_LOG'
  | 'GET_SYNC_STATS'
  | 'RESET_SYNC_STATS'
  | 'OPEN_SIDE_PANEL'
  | 'EXTRACT_LEAD'             // Popup → Content: extract current page
  | 'LEAD_EXTRACTED'           // Content/Background → All: new lead available
  | 'AUTO_SYNC_TRIGGERED';     // Content → Background: auto-sync a detected lead

export interface Message<T = unknown> {
  type:     MessageType;
  payload?: T;
}

export interface MessageResponse<T = unknown> {
  success: boolean;
  data?:   T;
  error?:  string;
}
