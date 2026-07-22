/**
 * Sync orchestrator.
 *
 * Simplified sheet row layout:
 *   A: Lead ID    | B: Sender    | C: Phone    | D: Requirement |
 *   E: Message    | F: Location  | G: Source   | H: Date        |
 *   I: Source URL | J: Labels    | K: Imported At
 */

import { ensureToken }  from './auth';
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

    // 1. Compute Lead ID
    const leadId = await getLeadId(lead);

    // 2. Build / reuse dedup index
    await buildDedupIndex(token, spreadsheetId, sheetNameStr);

    // 3. Duplicate check
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

    // 4. Ensure header row exists (idempotent)
    await ensureHeaders(token, spreadsheetId, sheetNameStr);

    // 5. Build row — matches SHEET_HEADERS exactly
    //    A: Lead ID  | B: Sender      | C: Phone    | D: Requirement |
    //    E: Message  | F: Location    | G: Source   | H: Date        |
    //    I: SourceURL| J: Labels      | K: Imported At
    const importedAt = new Date().toISOString();
    const rowData: (string | null)[] = [
      leadId,                      // A: Lead ID
      lead.buyerName,              // B: Sender
      lead.mobile,                 // C: Phone
      lead.product,                // D: Requirement
      lead.requirement,            // E: Message
      lead.city,                   // F: Location
      lead.source ?? null,         // G: Source
      lead.leadDate,               // H: Date
      lead.sourceUrl,              // I: Source URL
      lead.labels ?? null,         // J: Labels
      importedAt,                  // K: Imported At
    ];

    // 6. Append (INSERT_ROWS — never overwrites)
    const rowNumber = await appendRow(token, spreadsheetId, sheetNameStr, rowData);

    // 7. Update in-memory index
    addToIndex(leadId);

    // 8. Stats & log
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

export async function syncAllLeads(
  leads:        Lead[],
  delayBetween  = 200,
  onProgress?:  (result: SyncResult, index: number) => void,
): Promise<SyncResult[]> {
  const results: SyncResult[] = [];

  for (let i = 0; i < leads.length; i++) {
    const result = await syncLead(leads[i]);
    results.push(result);
    onProgress?.(result, i);
    if (delayBetween > 0) await new Promise<void>((r) => setTimeout(r, delayBetween));
  }

  return results;
}
