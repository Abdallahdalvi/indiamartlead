/**
 * Content script entry point (IIFE bundle).
 *
 * Responsibilities:
 *   1. Detect whether we're on the IndiaMART Lead Manager (messagecentre)
 *   2. Extract leads from the current page
 *   3. Auto-paginate through ALL pages to collect all 530 leads
 *   4. Send leads to the background for dedup + Sheet append
 *   5. Report progress back to the popup in real-time
 *   6. Handle single-lead auto-sync on buyer detail pages
 *   7. Listen for SPA navigation (IndiaMART React router)
 */

import { extractLeadManagerPage, findNextButton, waitForPageChange } from './leadmanager';
import { extractLead } from './extractor';
import { observeNavigation } from './observer';
import type { Lead, BulkSyncProgress } from '@/types';

// ─── Detect page type ─────────────────────────────────────────────────────────

function isLeadManager(): boolean {
  return /seller\.indiamart\.com\/messagecentre/i.test(window.location.href);
}

// ─── Send a lead to background for sync ──────────────────────────────────────

async function syncSingleLead(lead: Lead): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: 'SYNC_LEAD', payload: lead });
  } catch (e) {
    console.warn('[LeadSync] syncSingleLead error:', e);
  }
}

// ─── Broadcast current lead to popup / sidepanel ──────────────────────────────

async function broadcastLead(lead: Lead): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: 'LEAD_EXTRACTED', payload: lead });
  } catch { /* popup may not be open */ }
}

// ─── Auto-sync a single detected lead (buyer detail pages) ───────────────────

let lastAutoSyncUrl = '';
async function runAutoSync(): Promise<void> {
  if (isLeadManager()) return; // handled separately
  if (window.location.href === lastAutoSyncUrl) return;
  lastAutoSyncUrl = window.location.href;

  const lead = await extractLead();
  if (!lead) return;

  await broadcastLead(lead);

  // Check if auto-sync is enabled
  const config = await chrome.runtime.sendMessage({ type: 'GET_CONFIG' });
  if (config?.data?.autoSync) {
    await chrome.runtime.sendMessage({ type: 'AUTO_SYNC_TRIGGERED', payload: lead });
  }
}

// ─── Bulk sync ALL pages of the Lead Manager ─────────────────────────────────

let bulkSyncRunning = false;

async function runBulkSync(): Promise<void> {
  if (bulkSyncRunning) {
    console.log('[LeadSync] Bulk sync already running, ignoring.');
    return;
  }
  bulkSyncRunning = true;

  console.log('[LeadSync] Starting bulk sync of all Lead Manager pages...');

  let page        = 1;
  let totalSynced = 0;
  let imported    = 0;
  let duplicates  = 0;
  let errors      = 0;
  const allLeads: Lead[] = [];

  const sendProgress = (done: boolean) => {
    const progress: BulkSyncProgress = {
      total:      530,   // shown as estimate; updated as we go
      current:    totalSynced,
      imported,
      duplicates,
      errors,
      page,
      done,
    };
    chrome.runtime.sendMessage({ type: 'BULK_SYNC_PROGRESS', payload: progress }).catch(() => {});
    chrome.storage.local.set({ leadsync_bulk_progress: progress });
  };

  try {
    while (true) {
      // ── Extract leads from current page ──────────────────────────────────
      const pageLeads = extractLeadManagerPage();
      console.log(`[LeadSync] Page ${page}: found ${pageLeads.length} leads`);

      if (pageLeads.length === 0) {
        console.log('[LeadSync] No leads found on this page, stopping.');
        break;
      }

      // ── Sync each lead on this page ───────────────────────────────────────
      for (const lead of pageLeads) {
        try {
          const resp = await chrome.runtime.sendMessage({ type: 'SYNC_LEAD', payload: lead });
          const result = resp?.data;
          if (result?.status === 'imported')  imported++;
          else if (result?.status === 'duplicate') duplicates++;
          else errors++;
          totalSynced++;
          allLeads.push(lead);
        } catch {
          errors++;
          totalSynced++;
        }

        // Small delay between leads to avoid API rate limits
        await new Promise<void>((r) => setTimeout(r, 150));
      }

      sendProgress(false);

      // ── Try to go to next page ───────────────────────────────────────────
      const firstRowText = (document.querySelector('tr[data-uid], tr[data-gid], tbody tr')
        ?.textContent ?? '') + page;

      const nextBtn = findNextButton();
      if (!nextBtn) {
        console.log('[LeadSync] No next page button found. All pages done.');
        break;
      }

      console.log(`[LeadSync] Navigating to page ${page + 1}...`);
      nextBtn.click();

      // Wait for DOM to update with new page content
      const changed = await waitForPageChange(firstRowText, 10_000);
      if (!changed) {
        console.log('[LeadSync] Page did not change after 10s, stopping.');
        break;
      }

      page++;

      // Safety: stop after 50 pages (1000+ leads) to prevent runaway
      if (page > 50) break;
    }
  } finally {
    bulkSyncRunning = false;
    sendProgress(true);
    console.log(
      `[LeadSync] Bulk sync complete. Pages: ${page}, ` +
      `Imported: ${imported}, Duplicates: ${duplicates}, Errors: ${errors}`
    );
  }
}

// ─── Extract current page leads (for popup "Sync All Visible Leads") ─────────

function extractCurrentPage(): Lead[] {
  if (isLeadManager()) return extractLeadManagerPage();
  return [];
}

// ─── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message?.type;

  if (type === 'EXTRACT_LEAD') {
    (async () => {
      if (isLeadManager()) {
        const leads = extractLeadManagerPage();
        const first = leads[0] ?? null;
        if (first) broadcastLead(first);
        sendResponse({ success: true, data: first });
      } else {
        const lead = await extractLead();
        sendResponse({ success: true, data: lead });
      }
    })();
    return true;
  }

  if (type === 'SYNC_ALL_LEADS') {
    // Sync only the current visible page
    (async () => {
      const leads = extractCurrentPage();
      sendResponse({ success: true, data: { total: leads.length } });
      for (const lead of leads) {
        await syncSingleLead(lead);
        await new Promise<void>((r) => setTimeout(r, 150));
      }
    })();
    return true;
  }

  if (type === 'SYNC_ALL_PAGES') {
    // Bulk sync ALL pages (the 530-lead sync)
    runBulkSync().catch(console.error);
    sendResponse({ success: true, data: { started: true } });
    return true;
  }

  return false;
});

// ─── Initialise ───────────────────────────────────────────────────────────────

function init(): void {
  if (isLeadManager()) {
    console.log('[LeadSync] Lead Manager detected. Ready for bulk sync.');
    // Extract first page and broadcast so popup shows live count
    setTimeout(() => {
      const leads = extractLeadManagerPage();
      if (leads[0]) broadcastLead(leads[0]);
      console.log(`[LeadSync] Found ${leads.length} leads on current page.`);
    }, 1500);
  } else {
    // Buyer detail page — auto-extract
    setTimeout(runAutoSync, 1000);
  }
}

// Start and watch SPA navigation
init();
observeNavigation(() => {
  setTimeout(() => {
    if (!isLeadManager()) runAutoSync();
  }, 1200);
});
