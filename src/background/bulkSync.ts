/**
 * bulkSync.ts
 *
 * Background Service Worker Bulk Sync Orchestrator.
 *
 * Why this is immune to tab switching:
 *   Service Workers in MV3 run in a background process. Chrome NEVER throttles
 *   Service Worker execution timers or API calls when a user switches tabs,
 *   minimizes Chrome, or works in another application.
 */

import { syncLead } from './sync';
import type { Lead, BulkSyncProgress, MessageResponse } from '@/types';

let bulkSyncActive = false;
let cancelRequested = false;

export function isBulkSyncActive(): boolean {
  return bulkSyncActive;
}

export function cancelBulkSync(): void {
  if (bulkSyncActive) {
    cancelRequested = true;
  }
}

/**
 * Finds the active or open IndiaMART Lead Manager tab ID.
 */
async function getLeadManagerTabId(): Promise<number | null> {
  // 1. Try active tab in current window
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab?.id && activeTab.url && /seller\.indiamart\.com\/messagecentre/i.test(activeTab.url)) {
    return activeTab.id;
  }

  // 2. Try any tab across all windows matching IndiaMART messagecentre
  const tabs = await chrome.tabs.query({ url: '*://seller.indiamart.com/messagecentre*' });
  if (tabs.length > 0 && tabs[0].id) {
    return tabs[0].id;
  }

  return null;
}

/**
 * Executes full 530-lead bulk sync directly from background Service Worker.
 */
export async function startBackgroundBulkSync(): Promise<void> {
  if (bulkSyncActive) return;

  const tabId = await getLeadManagerTabId();
  if (!tabId) {
    throw new Error('Please open seller.indiamart.com/messagecentre tab first.');
  }

  bulkSyncActive = true;
  cancelRequested = false;

  let page        = 1;
  let totalSynced = 0;
  let imported    = 0;
  let duplicates  = 0;
  let errors      = 0;

  const updateProgress = async (done: boolean) => {
    const progress: BulkSyncProgress = {
      total: 530,
      current: totalSynced,
      imported,
      duplicates,
      errors,
      page,
      done,
    };

    // Save to storage (popup reads this instantly)
    await chrome.storage.local.set({ leadsync_bulk_progress: progress });

    // Broadcast to any open extension popups
    chrome.runtime.sendMessage({ type: 'BULK_SYNC_PROGRESS', payload: progress }).catch(() => {});
  };

  try {
    console.log('[LeadSync Background] Starting background-driven bulk sync on tab:', tabId);

    while (!cancelRequested) {
      // Step A: Extract DOM leads on current page from tab
      let response: MessageResponse<Lead[]> | null = null;
      try {
        response = (await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_PAGE_LEADS' })) as MessageResponse<Lead[]>;
      } catch (err) {
        console.warn('[LeadSync Background] Could not communicate with tab:', err);
        break;
      }

      const pageLeads = response?.data ?? [];
      console.log(`[LeadSync Background] Page ${page}: received ${pageLeads.length} leads from tab.`);

      if (pageLeads.length === 0) {
        console.log('[LeadSync Background] No leads found on page. Sync complete.');
        break;
      }

      // Step B: Sync each lead to Google Sheets (Service Worker handles API calls)
      for (const lead of pageLeads) {
        if (cancelRequested) break;

        const result = await syncLead(lead);
        if (result.status === 'imported')       imported++;
        else if (result.status === 'duplicate') duplicates++;
        else                                    errors++;

        totalSynced++;
        await updateProgress(false);

        // Rate limit delay between rows
        await new Promise<void>((r) => setTimeout(r, 120));
      }

      if (cancelRequested) break;

      // Step C: Ask tab to click Next Page
      let navResponse: MessageResponse<{ hasNext: boolean }> | null = null;
      try {
        navResponse = (await chrome.tabs.sendMessage(tabId, { type: 'CLICK_NEXT_PAGE' })) as MessageResponse<{ hasNext: boolean }>;
      } catch {
        break;
      }

      if (!navResponse?.data?.hasNext) {
        console.log('[LeadSync Background] Next page button not found or disabled. Finished.');
        break;
      }

      // Step D: Wait in background Service Worker (never throttled by Chrome tab state!)
      // Poll until the first lead on the page changes, indicating the new page loaded.
      let pageChanged = false;
      for (let w = 0; w < 10; w++) {
        if (cancelRequested) break;
        await new Promise<void>((r) => setTimeout(r, 1000));
        try {
          const checkResp = (await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_PAGE_LEADS' })) as MessageResponse<Lead[]>;
          const newLeads = checkResp?.data ?? [];
          if (newLeads.length > 0 && newLeads[0].mobile !== pageLeads[0]?.mobile) {
            pageChanged = true;
            break;
          }
        } catch {
          // Tab might be refreshing
        }
      }

      if (!pageChanged) {
        console.log('[LeadSync Background] Page did not change after 10s. Stopping.');
        break;
      }

      page++;

      if (page > 60) break; // Safety cap
    }
  } finally {
    bulkSyncActive = false;
    await updateProgress(true);
    console.log('[LeadSync Background] Bulk sync finished.');
  }
}
