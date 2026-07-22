/**
 * Sync orchestrator.
 *
 * syncLead()     → sync a single lead to Google Sheets.
 * syncAllLeads() → sync an array of leads sequentially.
 *
 * Sheet row layout (matches IndiaMART Lead Manager columns):
 *   A: Lead ID  | B: Sender Name | C: Phone     | D: Product  |
 *   E: Quantity | F: Message     | G: Location  | H: Source   |
 *   I: Date&Time| J: Labels      | K: Company   | L: Email    |
 *   M: State    | N: Budget      | O: Source URL| P: Imported At
 */

import { ensureToken } from './auth';
import { ensureHeaders, appendRow } from './sheets';
import { buildDedupIndex, isDuplicate, addToIndex, getLeadId } from './dedup';
import { getConfig, incrementStat } from '@/utils/storage';
import { logSyncResult } from '@/utils/logger';
import type { Lead, SyncResult } from '@/types';

// ─── Single Lead ──────────────────────────────────────────────────────────────

export async function syncLead(lead: Lead): Promise<SyncResult> {
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

    const spreadsheetId = config.spreadsheetId;
    const sheetNameStr  = config.sheetName;
    sheetName = sheetNameStr;

    // ── 1. Compute SHA-256 Lead ID ───────────────────────────────────────────
    const leadId = await getLeadId(lead);

    // ── 2. Build / reuse dedup index ──────────────────────────────────────────
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

    // ── 5. Build row — MUST match SHEET_HEADERS order exactly ────────────────
    const importedAt = new Date().toISOString();
    const rowData: (string | null)[] = [
      leadId,                // A: Lead ID  (SHA-256)
      lead.buyerName,        // B: Sender Name
      lead.mobile,           // C: Phone
      lead.product,          // D: Product / Requirement
      lead.quantity,         // E: Quantity
      lead.requirement,      // F: Message preview
      lead.city,             // G: Location
      lead.source ?? null,   // H: Source (Buylead/Direct/Other)
      lead.leadDate,         // I: Date & Time
      lead.labels ?? null,   // J: Labels
      lead.company,          // K: Company
      lead.email,            // L: Email
      lead.state,            // M: State
      lead.budget,           // N: Budget
      lead.sourceUrl,        // O: Source URL
      importedAt,            // P: Imported At
    ];

    // ── 6. Append (INSERT_ROWS — never overwrites existing data) ─────────────
    const rowNumber = await appendRow(token, spreadsheetId, sheetNameStr, rowData);

    // ── 7. Update in-memory index ─────────────────────────────────────────────
    addToIndex(leadId);

    // ── 8. Log & stats ────────────────────────────────────────────────────────
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
 * @param delayBetween  - Milliseconds to wait between rows (default 200ms)
 * @param onProgress    - Optional callback called after each lead
 */
export async function syncAllLeads(
  leads:         Lead[],
  delayBetween   = 200,
  onProgress?:   (result: SyncResult, index: number) => void,
): Promise<SyncResult[]> {
  const results: SyncResult[] = [];

  for (let i = 0; i < leads.length; i++) {
    const result = await syncLead(leads[i]);
    results.push(result);
    onProgress?.(result, i);

    if (delayBetween > 0) {
      await new Promise<void>((r) => setTimeout(r, delayBetween));
    }
  }

  return results;
}
