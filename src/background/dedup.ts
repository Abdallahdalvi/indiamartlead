/**
 * SHA-256 deduplication service.
 *
 * Maintains an in-memory Set<string> of known Lead IDs for the
 * current session. The set is populated lazily on first sync by
 * reading ONLY column A (fetchLeadIdColumn) — one API call regardless
 * of how many rows or columns exist.
 *
 * After a successful import the new hash is added to the in-memory
 * index, so subsequent leads in the same batch are deduplicated
 * without additional API calls.
 */

import { computeLeadId } from '@/utils/hash';
import { fetchLeadIdColumn } from './sheets';
import type { Lead } from '@/types';

// ─── In-memory cache ──────────────────────────────────────────────────────────

let _index:          Set<string> | null = null;
let _spreadsheetId:  string | null      = null;
let _sheetName:      string | null      = null;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build (or return cached) dedup index for the given sheet.
 *
 * Pass `forceRefresh = true` to re-fetch even if the cache is warm.
 * The cache is automatically invalidated whenever the spreadsheet or
 * sheet name changes (see invalidateDedupIndex).
 */
export async function buildDedupIndex(
  token:         string,
  spreadsheetId: string,
  sheetName:     string,
  forceRefresh   = false,
): Promise<Set<string>> {
  const cacheHit =
    !forceRefresh &&
    _index !== null &&
    _spreadsheetId === spreadsheetId &&
    _sheetName     === sheetName;

  if (cacheHit) return _index!;

  console.log(`[LeadSync] Building dedup index for "${sheetName}"…`);
  const ids = await fetchLeadIdColumn(token, spreadsheetId, sheetName);

  _index         = new Set(ids);
  _spreadsheetId = spreadsheetId;
  _sheetName     = sheetName;

  console.log(`[LeadSync] Dedup index ready — ${_index.size} existing leads.`);
  return _index;
}

/**
 * O(1) duplicate check. Call after buildDedupIndex().
 */
export function isDuplicate(leadId: string): boolean {
  return _index?.has(leadId) ?? false;
}

/**
 * Add a newly imported Lead ID to the in-memory index so that
 * subsequent sync calls in the same session don't re-fetch the sheet.
 */
export function addToIndex(leadId: string): void {
  _index?.add(leadId);
}

/**
 * Wipe the cached index. Call when the user changes spreadsheet / sheet,
 * or after sign-out.
 */
export function invalidateDedupIndex(): void {
  _index         = null;
  _spreadsheetId = null;
  _sheetName     = null;
  console.log('[LeadSync] Dedup index invalidated.');
}

/**
 * Compute the Lead ID (SHA-256 hash) from a Lead object.
 * Convenience wrapper around computeLeadId from utils/hash.ts.
 */
export async function getLeadId(
  lead: Pick<Lead, 'mobile' | 'company' | 'product' | 'buyerName'>,
): Promise<string> {
  return computeLeadId(lead.mobile, lead.company, lead.product, lead.buyerName);
}
