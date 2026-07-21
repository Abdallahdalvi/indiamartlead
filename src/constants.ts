/**
 * Application-wide constants.
 * Keep all magic strings, URLs, and config values here.
 */

// ─── Sheet Column Layout ──────────────────────────────────────────────────────
// Column A stores the SHA-256 Lead ID for O(1) deduplication.
// Columns B–N store the actual lead data.

export const SHEET_COLUMNS = {
  LEAD_ID:     'A',  // SHA-256 hash (hidden / narrow column)
  BUYER_NAME:  'B',
  COMPANY:     'C',
  MOBILE:      'D',
  EMAIL:       'E',
  PRODUCT:     'F',
  QUANTITY:    'G',
  BUDGET:      'H',
  REQUIREMENT: 'I',
  CITY:        'J',
  STATE:       'K',
  LEAD_DATE:   'L',
  SOURCE_URL:  'M',
  IMPORTED_AT: 'N',
} as const;

/** Header row written to the sheet on first use. */
export const SHEET_HEADERS: string[] = [
  'Lead ID',
  'Buyer Name',
  'Company',
  'Mobile',
  'Email',
  'Product',
  'Quantity',
  'Budget',
  'Requirement',
  'City',
  'State',
  'Lead Date',
  'Source URL',
  'Imported At',
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
} as const;

/** Maximum number of log entries kept in storage (rolling window). */
export const MAX_LOG_ENTRIES = 500;

// ─── IndiaMART URL Patterns ───────────────────────────────────────────────────

export const INDIAMART_LEAD_PATTERNS = [
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
