/**
 * Sync orchestrator.
 *
 * syncLead()     → sync a single lead to Google Sheets.
 * syncAllLeads() → sync an array of leads sequentially with a small
 *                  inter-row delay to respect API rate limits.
 *
 * Flow for each lead:
 *   1. Obtain a valid OAuth token.
 *   2. Load the user's selected spreadsheet / sheet from config.
 *   3. Compute the SHA-256 Lead ID.
 *   4. Build (or reuse) the in-memory dedup index (reads column A once).
 *   5. If duplicate → skip and log.
 *   6. If new → ensureHeaders → appendRow (INSERT_ROWS, never overwrites).
 *   7. Add the new hash to the in-memory index.
 *   8. Log the result and update cumulative stats.
 */

import { ensureToken } from './auth';
import { ensureHeaders, appendRow } from './sheets';
import { buildDedupIndex, isDuplicate, addToIndex, getLeadId } from './dedup';
import { getConfig, incrementStat } from '@/utils/storage';
import { logSyncResult } from '@/utils/logger';
import type { Lead, SyncResult } from '@/types';

// ─── Single Lead ──────────────────────────────────────────────────────────────

/**
 * Sync one lead.
 * Always returns a SyncResult — never throws (errors are caught and logged).
 */
export async function syncLead(lead: Lead): Promise<SyncResult> {
  // Declared outside try so catch block can log with it
  let sheetName: string | undefined;

  try {
    const [token, config] = await Promise.all([ensureToken(), getConfig()]);
    sheetName = config.sheetName;

    if (!config.spreadsheetId || !config.sheetName) {
      return {
        status:  'error',
        message: 'No spreadsheet configured. Open the popup and select a sheet first.',
      };
    }

    // Both are non-null after the guard — extract as narrowed strings
    const spreadsheetId = config.spreadsheetId;
    const sheetNameStr  = config.sheetName;
    sheetName = sheetNameStr;

    // ── 1. Compute SHA-256 Lead ID ───────────────────────────────────────────
    const leadId = await getLeadId(lead);

    // ── 2. Build / reuse dedup index (reads column A once per session) ───────
    await buildDedupIndex(token, spreadsheetId, sheetNameStr);

    // ── 3. Duplicate check ───────────────────────────────────────────────────
    if (isDuplicate(leadId)) {
      await incrementStat('duplicates');
      const result: SyncResult = {
        status:  'duplicate',
        message: `Duplicate: ${lead.buyerName ?? 'Unknown'} (${lead.mobile ?? 'no phone'})`,
        leadId,
      };
      await logSyncResult(result, lead, sheetNameStr);
      return result;
    }

    // ── 4. Ensure headers exist (idempotent) ─────────────────────────────────
    await ensureHeaders(token, spreadsheetId, sheetNameStr);

    // ── 5. Build row — column order must match SHEET_HEADERS exactly ─────────
    const importedAt = new Date().toISOString();
    const rowData: (string | null)[] = [
      leadId,             // A: Lead ID  (SHA-256)
      lead.buyerName,     // B: Buyer Name
      lead.company,       // C: Company
      lead.mobile,        // D: Mobile
      lead.email,         // E: Email
      lead.product,       // F: Product
      lead.quantity,      // G: Quantity
      lead.budget,        // H: Budget
      lead.requirement,   // I: Requirement
      lead.city,          // J: City
      lead.state,         // K: State
      lead.leadDate,      // L: Lead Date
      lead.sourceUrl,     // M: Source URL
      importedAt,         // N: Imported At
    ];

    // ── 6. Append (INSERT_ROWS — never overwrites existing data) ─────────────
    const rowNumber = await appendRow(token, spreadsheetId, sheetNameStr, rowData);

    // ── 7. Update in-memory index so subsequent leads in same session skip ───
    addToIndex(leadId);

    // ── 8. Log & stats ───────────────────────────────────────────────────────
    await incrementStat('imported');
    const result: SyncResult = {
      status:    'imported',
      message:   `Imported: ${lead.buyerName ?? 'Unknown'} → Row ${rowNumber}`,
      rowNumber,
      leadId,
    };
    await logSyncResult(result, lead, sheetNameStr);
    return result;

  } catch (error) {
    await incrementStat('errors');
    const message = error instanceof Error ? error.message : 'Unknown error during sync.';
    console.error('[LeadSync] syncLead error:', error);
    const result: SyncResult = { status: 'error', message };
    await logSyncResult(result, lead, sheetName);
    return result;
  }
}

// ─── Batch ────────────────────────────────────────────────────────────────────

/**
 * Sync an array of leads sequentially.
 * A small delay between rows avoids bursting the Sheets API quota.
 *
 * @param leads         - Array of leads to process
 * @param delayBetween  - Milliseconds to wait between rows (default 150ms)
 */
export async function syncAllLeads(
  leads:         Lead[],
  delayBetween   = 150,
): Promise<SyncResult[]> {
  const results: SyncResult[] = [];

  for (const lead of leads) {
    const result = await syncLead(lead);
    results.push(result);

    if (delayBetween > 0) {
      await new Promise<void>((r) => setTimeout(r, delayBetween));
    }
  }

  return results;
}
