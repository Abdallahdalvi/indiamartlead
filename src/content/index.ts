/**
 * Content script entry point.
 *
 * Direct DOM-based extraction for seller.indiamart.com/messagecentre.
 * No API key or network interceptor required.
 */

import {
  extractLeadManagerPage,
  findNextButton,
  waitForPageChange,
  getPageSignature,
} from './leadmanager';
import { extractLead } from './extractor';
import { observeNavigation } from './observer';
import type { Lead, BulkSyncProgress } from '@/types';

function isLeadManager(): boolean {
  return /seller\.indiamart\.com\/messagecentre/i.test(window.location.href);
}

// ─── Send lead to background worker ──────────────────────────────────────────

async function syncOneToBackground(lead: Lead): Promise<{ status: string } | null> {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'SYNC_LEAD', payload: lead });
    return resp?.data ?? null;
  } catch {
    return null;
  }
}

// ─── Bulk sync: all pages via DOM extraction ──────────────────────────────────

let bulkSyncRunning = false;

async function runBulkSync(): Promise<void> {
  if (bulkSyncRunning) return;
  bulkSyncRunning = true;

  let page        = 1;
  let totalSynced = 0;
  let imported    = 0;
  let duplicates  = 0;
  let errors      = 0;

  const sendProgress = (done: boolean) => {
    const progress: BulkSyncProgress = {
      total:      530,
      current:    totalSynced,
      imported,
      duplicates,
      errors,
      page,
      done,
    };
    chrome.runtime.sendMessage({ type: 'BULK_SYNC_PROGRESS', payload: progress }).catch(() => {});
    chrome.storage.local.set({ leadsync_bulk_progress: progress });
    console.log(`[LeadSync] Page ${page} — synced:${totalSynced} imported:${imported} dup:${duplicates}`);
  };

  try {
    while (true) {
      // 1. Extract leads directly from DOM on current page
      const pageLeads = extractLeadManagerPage();
      console.log(`[LeadSync] Page ${page}: extracted ${pageLeads.length} leads from DOM.`);

      if (pageLeads.length === 0) {
        console.log('[LeadSync] No leads found on this page. Stopping.');
        break;
      }

      // 2. Sync each lead to Google Sheets
      for (const lead of pageLeads) {
        const result = await syncOneToBackground(lead);
        const status = result?.status ?? 'error';
        if (status === 'imported')       imported++;
        else if (status === 'duplicate') duplicates++;
        else                            errors++;
        totalSynced++;

        // Small rate limit delay between rows
        await new Promise<void>((r) => setTimeout(r, 120));
      }

      sendProgress(false);

      // 3. Auto-paginate to next page
      const sig = getPageSignature();
      const nextBtn = findNextButton();
      if (!nextBtn) {
        console.log('[LeadSync] Reached end (no Next button). Sync complete.');
        break;
      }

      console.log(`[LeadSync] Navigating to page ${page + 1}...`);
      nextBtn.click();

      const changed = await waitForPageChange(sig, 8_000);
      if (!changed) {
        console.log('[LeadSync] Page did not update after 8s. Stopping.');
        break;
      }

      // Short wait for DOM render
      await new Promise<void>((r) => setTimeout(r, 1_000));
      page++;

      if (page > 60) break; // Safety limit
    }
  } finally {
    bulkSyncRunning = false;
    sendProgress(true);
  }
}

// ─── Single-lead auto-sync (buyer detail pages) ───────────────────────────────

let lastAutoSyncUrl = '';
async function runAutoSync(): Promise<void> {
  if (isLeadManager()) return;
  if (window.location.href === lastAutoSyncUrl) return;
  lastAutoSyncUrl = window.location.href;

  const lead = await extractLead();
  if (!lead) return;

  try {
    await chrome.runtime.sendMessage({ type: 'LEAD_EXTRACTED', payload: lead });
    const config = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
    if (config?.data?.autoSync) {
      await chrome.runtime.sendMessage({ type: 'AUTO_SYNC_TRIGGERED', payload: lead });
    }
  } catch { /* popup closed */ }
}

// ─── Message listener ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message?.type;

  if (type === 'EXTRACT_LEAD') {
    (async () => {
      if (isLeadManager()) {
        const leads = extractLeadManagerPage();
        sendResponse({ success: true, data: leads[0] ?? null });
      } else {
        const lead = await extractLead();
        sendResponse({ success: true, data: lead });
      }
    })();
    return true;
  }

  if (type === 'SYNC_ALL_PAGES') {
    runBulkSync().catch(console.error);
    sendResponse({ success: true, data: { started: true } });
    return true;
  }

  if (type === 'SYNC_ALL_LEADS') {
    (async () => {
      const leads = extractLeadManagerPage();
      sendResponse({ success: true, data: { total: leads.length } });
      for (const lead of leads) {
        await syncOneToBackground(lead);
        await new Promise<void>((r) => setTimeout(r, 120));
      }
    })();
    return true;
  }

  return false;
});

// ─── Initialise ───────────────────────────────────────────────────────────────

function init(): void {
  if (isLeadManager()) {
    console.log('[LeadSync] Lead Manager DOM Extractor active.');
    setTimeout(() => {
      const domLeads = extractLeadManagerPage();
      console.log(`[LeadSync] Ready: ${domLeads.length} leads detected on page 1.`);
    }, 1_500);
  } else {
    setTimeout(runAutoSync, 1_000);
  }
}

init();
observeNavigation(() => {
  setTimeout(() => {
    if (!isLeadManager()) runAutoSync();
  }, 1_000);
});
