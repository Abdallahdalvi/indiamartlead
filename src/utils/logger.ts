/**
 * Structured import logger.
 * Every sync result (imported / duplicate / error) is persisted
 * as an ImportLogEntry via appendLogEntry().
 */

import type { SyncResult, ImportLogEntry, Lead } from '@/types';
import { appendLogEntry } from './storage';

// Monotonic counter for within-millisecond uniqueness
let _counter = 0;

function uniqueId(): string {
  return `log_${Date.now()}_${++_counter}`;
}

/**
 * Persist a sync result to the rolling import log.
 *
 * @param result     - The SyncResult returned by syncLead()
 * @param lead       - The lead that was synced (for display in the log)
 * @param sheetName  - The target worksheet name (optional)
 */
export async function logSyncResult(
  result:    SyncResult,
  lead:      Pick<Lead, 'buyerName' | 'company' | 'product' | 'mobile'>,
  sheetName?: string,
): Promise<void> {
  const entry: ImportLogEntry = {
    id:         uniqueId(),
    timestamp:  new Date().toISOString(),
    status:     result.status,
    leadId:     result.leadId,
    buyerName:  lead.buyerName,
    company:    lead.company,
    product:    lead.product,
    mobile:     lead.mobile,
    message:    result.message,
    sheetName,
    rowNumber:  result.rowNumber,
  };

  await appendLogEntry(entry);
}
