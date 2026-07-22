/**
 * Application-wide constants.
 * Keep all magic strings, URLs, and config values here.
 */

// ─── Sheet Column Layout ──────────────────────────────────────────────────────
// Columns match IndiaMART Lead Manager's exact structure.
// Column A = SHA-256 Lead ID for O(1) deduplication (can be hidden).

export const SHEET_COLUMNS = {
  LEAD_ID:     'A',   // SHA-256 hash (hidden / narrow — dedup key)
  BUYER_NAME:  'B',   // SENDER name
  MOBILE:      'C',   // Phone number
  PRODUCT:     'D',   // REQUIREMENT / product name
  QUANTITY:    'E',   // Quantity
  REQUIREMENT: 'F',   // MESSAGE preview
  CITY:        'G',   // LOCATION
  SOURCE:      'H',   // SOURCE (Buylead / Direct / Other / Catalog Link)
  LEAD_DATE:   'I',   // DATE/TIME
  LABELS:      'J',   // LABELS (comma-separated)
  COMPANY:     'K',   // Company (from detail pages, may be blank)
  EMAIL:       'L',   // Email (from detail pages, may be blank)
  STATE:       'M',   // State
  BUDGET:      'N',   // Budget (from detail pages, may be blank)
  SOURCE_URL:  'O',   // Page URL
  IMPORTED_AT: 'P',   // ISO timestamp when we imported
} as const;

/**
 * Header row written to the sheet on first use.
 * Matches IndiaMART Lead Manager columns exactly.
 */
export const SHEET_HEADERS: string[] = [
  'Lead ID',         // A — hidden dedup key
  'Sender Name',     // B ← SENDER
  'Phone',           // C
  'Product/Req.',    // D ← REQUIREMENT
  'Quantity',        // E
  'Message',         // F ← MESSAGES preview
  'Location',        // G ← LOCATION
  'Source',          // H ← SOURCE (Buylead/Direct/Other)
  'Date & Time',     // I ← DATE/TIME
  'Labels',          // J ← LABELS
  'Company',         // K
  'Email',           // L
  'State',           // M
  'Budget',          // N
  'Source URL',      // O
  'Imported At',     // P
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
  BASE_DELAY_MS:  1_000,   // 1 second initial delay
  MAX_DELAY_MS:   32_000,  // cap at 32 seconds
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
  /seller\.indiamart\.com\/messagecentre/i,  // Lead Manager (primary target)
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

