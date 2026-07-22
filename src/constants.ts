/**
 * Application-wide constants.
 */

// ─── Sheet Column Layout ──────────────────────────────────────────────────────
// Simplified to exactly what the user needs.
// Column A = SHA-256 Lead ID for O(1) dedup (can be hidden in the sheet).

export const SHEET_COLUMNS = {
  LEAD_ID:     'A',   // SHA-256 hash — hidden dedup key
  BUYER_NAME:  'B',   // Sender Name
  MOBILE:      'C',   // Phone Number
  PRODUCT:     'D',   // Requirement / Product
  REQUIREMENT: 'E',   // Message (preview text)
  CITY:        'F',   // Location / City
  SOURCE:      'G',   // Source (Buylead / Direct / Other / Catalog Link)
  LEAD_DATE:   'H',   // Date & Time
  SOURCE_URL:  'I',   // Source URL
  LABELS:      'J',   // Labels (comma-separated)
  IMPORTED_AT: 'K',   // Imported At (ISO timestamp)
} as const;

/**
 * Header row written to the sheet on first use.
 * Matches the simplified column layout requested by the user.
 */
export const SHEET_HEADERS: string[] = [
  'Lead ID',       // A — hidden dedup key
  'Sender',        // B
  'Phone',         // C
  'Requirement',   // D
  'Message',       // E
  'Location',      // F
  'Source',        // G
  'Date',          // H
  'Source URL',    // I
  'Labels',        // J
  'Imported At',   // K
];

// ─── Google API Endpoints ─────────────────────────────────────────────────────

export const GOOGLE_APIS = {
  SHEETS_BASE:  'https://sheets.googleapis.com/v4/spreadsheets',
  DRIVE_FILES:  'https://www.googleapis.com/drive/v3/files',
  USER_INFO:    'https://www.googleapis.com/oauth2/v2/userinfo',
  TOKEN_REVOKE: 'https://oauth2.googleapis.com/revoke',
} as const;

// ─── Rate Limiting ────────────────────────────────────────────────────────────

export const RATE_LIMIT = {
  MAX_RETRIES:    5,
  BASE_DELAY_MS:  1_000,
  MAX_DELAY_MS:   32_000,
} as const;

// ─── Chrome Storage Keys ──────────────────────────────────────────────────────

export const STORAGE_KEYS = {
  CONFIG:        'leadsync_config',
  AUTH:          'leadsync_auth',
  IMPORT_LOG:    'leadsync_import_log',
  CURRENT_LEAD:  'leadsync_current_lead',
  SYNC_STATS:    'leadsync_sync_stats',
  BULK_PROGRESS: 'leadsync_bulk_progress',
} as const;

/** Maximum number of log entries kept in storage (rolling window). */
export const MAX_LOG_ENTRIES = 500;

// ─── IndiaMART URL Patterns ───────────────────────────────────────────────────

export const INDIAMART_LEAD_PATTERNS = [
  /seller\.indiamart\.com\/messagecentre/i,
  /indiamart\.com\/messagebox/i,
  /indiamart\.com\/buy-lead/i,
  /indiamart\.com\/buyer-central/i,
  /indiamart\.com\/leadmanager/i,
  /indiamart\.com\/.*lead/i,
  /indiamart\.com\/.*enquir/i,
  /indiamart\.com\/.*requirement/i,
  /seller\.indiamart\.com/i,
  /my\.indiamart\.com/i,
];
