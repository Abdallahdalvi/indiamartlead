/**
 * Google Sheets API service.
 *
 * All functions accept a Bearer token and return typed responses.
 * Every network call is wrapped with withRetry() for rate-limit handling.
 *
 * Sheet column layout (see src/constants.ts → SHEET_HEADERS):
 *   A: Lead ID (SHA-256) | B: Buyer Name | C: Company | D: Mobile |
 *   E: Email | F: Product | G: Quantity | H: Budget | I: Requirement |
 *   J: City | K: State | L: Lead Date | M: Source URL | N: Imported At
 */

import { GOOGLE_APIS, SHEET_HEADERS } from '@/constants';
import { apiRequest, withRetry } from './rateLimit';
import type { Spreadsheet, Worksheet } from '@/types';

// ─── Internal Google API response shapes ──────────────────────────────────────

interface ValuesResponse {
  values?:          string[][];
  majorDimension?:  string;
  range?:           string;
}

interface AppendResponse {
  updates: {
    updatedRange:   string;
    updatedRows:    number;
    updatedColumns: number;
    updatedCells:   number;
  };
}

interface SpreadsheetMeta {
  spreadsheetId: string;
  properties:    { title: string };
  sheets: Array<{
    properties: {
      sheetId:        number;
      title:          string;
      index:          number;
      gridProperties?: { rowCount: number; columnCount: number };
    };
  }>;
}

interface DriveFilesResponse {
  files: Array<{ id: string; name: string; modifiedTime: string }>;
  nextPageToken?: string;
}

// ─── Drive: list spreadsheets ─────────────────────────────────────────────────

/**
 * List the user's Google Sheets spreadsheets (most-recently-modified first).
 * Fetches up to 100 files per call (covers most users).
 */
export async function listSpreadsheets(token: string): Promise<Spreadsheet[]> {
  const params = new URLSearchParams({
    q:       "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
    orderBy: 'modifiedTime desc',
    fields:  'files(id,name,modifiedTime)',
    pageSize: '100',
  });

  const data = await withRetry(
    () => apiRequest<DriveFilesResponse>(`${GOOGLE_APIS.DRIVE_FILES}?${params}`, token),
    'listSpreadsheets',
  );

  return data.files.map((f) => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime }));
}

// ─── Sheets: list worksheets (tabs) ──────────────────────────────────────────

/**
 * Get all worksheet tabs for a given spreadsheet.
 */
export async function listWorksheets(token: string, spreadsheetId: string): Promise<Worksheet[]> {
  const url  = `${GOOGLE_APIS.SHEETS_BASE}/${spreadsheetId}?fields=sheets.properties`;
  const data = await withRetry(
    () => apiRequest<SpreadsheetMeta>(url, token),
    'listWorksheets',
  );

  return data.sheets.map((s) => ({
    id:          s.properties.sheetId,
    title:       s.properties.title,
    index:       s.properties.index,
    rowCount:    s.properties.gridProperties?.rowCount,
    columnCount: s.properties.gridProperties?.columnCount,
  }));
}

// ─── Deduplication: read Lead ID column only ──────────────────────────────────

/**
 * Fetch ONLY column A (Lead ID / SHA-256 hashes) from the sheet.
 *
 * This is the core of the O(1) deduplication strategy:
 *   - One API call regardless of how many data columns exist.
 *   - Skips the header row (row 1).
 *   - Returns empty array if the sheet is empty or has only headers.
 */
export async function fetchLeadIdColumn(
  token:         string,
  spreadsheetId: string,
  sheetName:     string,
): Promise<string[]> {
  const range = encodeURIComponent(`${sheetName}!A:A`);
  const url   = `${GOOGLE_APIS.SHEETS_BASE}/${spreadsheetId}/values/${range}`;

  const data = await withRetry(
    () => apiRequest<ValuesResponse>(url, token),
    'fetchLeadIdColumn',
  );

  if (!data.values || data.values.length <= 1) return [];

  // Slice off header row, flatten, filter empty
  return data.values
    .slice(1)
    .map((row) => (row[0] ?? '').trim())
    .filter(Boolean);
}

// ─── Headers: ensure row 1 has the correct header ───────────────────────────

/**
 * Idempotent: reads row 1. If it's empty (new sheet), writes SHEET_HEADERS.
 * Never overwrites an existing row 1 — preserves any user-added headers.
 */
export async function ensureHeaders(
  token:         string,
  spreadsheetId: string,
  sheetName:     string,
): Promise<void> {
  const checkRange = encodeURIComponent(`${sheetName}!A1:N1`);
  const checkUrl   = `${GOOGLE_APIS.SHEETS_BASE}/${spreadsheetId}/values/${checkRange}`;

  const existing = await withRetry(
    () => apiRequest<ValuesResponse>(checkUrl, token),
    'checkHeaders',
  );

  // Already has headers — do nothing
  if (existing.values?.[0]?.length) return;

  // Write headers
  const writeRange = encodeURIComponent(`${sheetName}!A1:N1`);
  const writeUrl   = `${GOOGLE_APIS.SHEETS_BASE}/${spreadsheetId}/values/${writeRange}` +
                     `?valueInputOption=USER_ENTERED`;

  await withRetry(
    () => apiRequest<unknown>(writeUrl, token, {
      method: 'PUT',
      body:   JSON.stringify({
        range:          `${sheetName}!A1:N1`,
        majorDimension: 'ROWS',
        values:         [SHEET_HEADERS],
      }),
    }),
    'writeHeaders',
  );
}

// ─── Append row ───────────────────────────────────────────────────────────────

/**
 * Append exactly one row to the sheet.
 *
 * Uses `insertDataOption=INSERT_ROWS` which:
 *   - NEVER overwrites existing data.
 *   - Inserts a new row AFTER the last populated row.
 *   - Preserves all filters, conditional formats, and formulas.
 *
 * Returns the 1-indexed row number where the data landed.
 */
export async function appendRow(
  token:         string,
  spreadsheetId: string,
  sheetName:     string,
  rowData:       (string | null)[],
): Promise<number> {
  const range = encodeURIComponent(`${sheetName}!A:N`);
  const url   = `${GOOGLE_APIS.SHEETS_BASE}/${spreadsheetId}/values/${range}:append` +
                `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;

  const data = await withRetry(
    () => apiRequest<AppendResponse>(url, token, {
      method: 'POST',
      body:   JSON.stringify({
        majorDimension: 'ROWS',
        // Map null → '' so the sheet receives empty strings (not "null")
        values: [rowData.map((v) => v ?? '')],
      }),
    }),
    'appendRow',
  );

  // Parse row number from updatedRange, e.g. "Sheet1!A7:N7" → 7
  const match = data.updates?.updatedRange?.match(/!A(\d+):/);
  return match ? parseInt(match[1], 10) : -1;
}
