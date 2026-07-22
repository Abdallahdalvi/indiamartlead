/**
 * Content script entry point (IIFE bundle).
 *
 * On seller.indiamart.com/messagecentre (Lead Manager):
 *   1. Ask background to inject the XHR/fetch interceptor via
 *      chrome.scripting.executeScript({ world: 'MAIN' }) — CSP-safe.
 *   2. Listen for captured API lead data via window.postMessage.
 *   3. On SYNC_ALL_PAGES: sync leads page by page with auto-pagination.
 *
 * On buyer detail / other IndiaMART pages:
 *   Single-lead extraction + optional auto-sync.
 */

import { triggerLeadRefresh } from './pageInjector';
import {
  extractLeadManagerPage,
  findNextButton,
  waitForPageChange,
  getPageSignature,
  setCapturedLeads,
  getCapturedLeads,
  clearCapturedLeads,
} from './leadmanager';
import { extractLead } from './extractor';
import { observeNavigation } from './observer';
import type { Lead, BulkSyncProgress } from '@/types';

// ─── Inject interceptor via background (CSP-safe) ───────────────────────────
// IndiaMART has a strict CSP that blocks inline <script> tags.
// We ask the background worker to call chrome.scripting.executeScript
// with world:'MAIN' which Chrome injects natively — bypasses CSP.

async function injectViaBackground(): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: 'INJECT_INTERCEPTOR' });
    console.log('[LeadSync] Interceptor injection requested.');
  } catch (e) {
    console.warn('[LeadSync] Could not inject interceptor:', e);
  }
}


function isLeadManager(): boolean {
  return /seller\.indiamart\.com\/messagecentre/i.test(window.location.href);
}

// ─── Send lead to background ──────────────────────────────────────────────────

async function syncOneToBackground(lead: Lead): Promise<{ status: string } | null> {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'SYNC_LEAD', payload: lead });
    return resp?.data ?? null;
  } catch {
    return null;
  }
}

// ─── Listen for API captures from injected page script ───────────────────────
// The injected script runs in the MAIN world and posts back here.

let apiLeadsBuffer: Lead[] = [];
let onApiLeadsCb: (() => void) | null = null;

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) return;
  if (event.data?.type !== 'LEADSYNC_API_LEADS') return;

  const raw: Record<string, unknown>[] = event.data.leads ?? [];
  if (!raw.length) return;

  console.log(`[LeadSync] API captured ${raw.length} leads from ${event.data.url}`);

  // The injector already parsed them into our Lead shape
  const leads = raw as unknown as Lead[];
  apiLeadsBuffer = leads;
  setCapturedLeads(leads);

  // Notify any waiting bulk-sync that new leads arrived
  onApiLeadsCb?.();
  onApiLeadsCb = null;
});

/** Wait up to `timeoutMs` for the API interceptor to deliver new leads. */
function waitForApiCapture(timeoutMs = 10_000): Promise<Lead[]> {
  return new Promise((resolve) => {
    // If already populated, return immediately
    if (apiLeadsBuffer.length > 0) {
      const leads = [...apiLeadsBuffer];
      apiLeadsBuffer = [];
      resolve(leads);
      return;
    }
    const timer = setTimeout(() => {
      onApiLeadsCb = null;
      resolve([]);
    }, timeoutMs);
    onApiLeadsCb = () => {
      clearTimeout(timer);
      const leads = [...apiLeadsBuffer];
      apiLeadsBuffer = [];
      resolve(leads);
    };
  });
}

// ─── Bulk sync: all pages ─────────────────────────────────────────────────────

let bulkSyncRunning = false;

async function runBulkSync(): Promise<void> {
  if (bulkSyncRunning) return;
  bulkSyncRunning = true;
  clearCapturedLeads();
  apiLeadsBuffer = [];

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
      // ── Get leads for this page ─────────────────────────────────────────
      let pageLeads: Lead[] = [];

      // Try API capture first (reliable)
      // Trigger a refresh to force a new API call for the current page
      triggerLeadRefresh();
      const apiLeads = await waitForApiCapture(8_000);

      if (apiLeads.length > 0) {
        pageLeads = apiLeads;
        console.log(`[LeadSync] Page ${page}: API gave ${pageLeads.length} leads`);
      } else {
        // Fallback: DOM phone-number walk
        pageLeads = extractLeadManagerPage();
        console.log(`[LeadSync] Page ${page}: DOM fallback gave ${pageLeads.length} leads`);
      }

      if (pageLeads.length === 0) {
        console.log('[LeadSync] No leads on this page, stopping.');
        break;
      }

      // ── Sync each lead ─────────────────────────────────────────────────
      for (const lead of pageLeads) {
        const result = await syncOneToBackground(lead);
        const status = result?.status ?? 'error';
        if (status === 'imported')  imported++;
        else if (status === 'duplicate') duplicates++;
        else errors++;
        totalSynced++;

        // Rate limit: 150ms between rows
        await new Promise<void>((r) => setTimeout(r, 150));
      }

      sendProgress(false);

      // ── Paginate ────────────────────────────────────────────────────────
      const sig = getPageSignature();
      const nextBtn = findNextButton();
      if (!nextBtn) {
        console.log('[LeadSync] No next page button, done.');
        break;
      }

      // Clear buffer before clicking next so we wait for new capture
      apiLeadsBuffer = [];

      nextBtn.click();
      const changed = await waitForPageChange(sig, 10_000);
      if (!changed) {
        console.log('[LeadSync] Page did not update after 10s, stopping.');
        break;
      }

      // Wait a bit for the page's own API call to fire
      await new Promise<void>((r) => setTimeout(r, 1_500));
      page++;
      if (page > 50) break; // safety cap
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
  } catch { /* popup not open */ }
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
        await new Promise<void>((r) => setTimeout(r, 150));
      }
    })();
    return true;
  }

  return false;
});

// ─── Initialise ───────────────────────────────────────────────────────────────

function init(): void {
  if (isLeadManager()) {
    // Ask background to inject interceptor into MAIN world (CSP-safe)
    injectViaBackground().then(() => {
      console.log('[LeadSync] Lead Manager ready.');
      // Sanity check: how many rows does DOM see?
      setTimeout(() => {
        const domLeads = extractLeadManagerPage();
        console.log(`[LeadSync] DOM sanity check: ${domLeads.length} leads on page 1.`);
      }, 2_000);
    });
  } else {
    setTimeout(runAutoSync, 1_000);
  }
}

init();
observeNavigation(() => {
  setTimeout(() => {
    if (isLeadManager()) injectViaBackground();
    else runAutoSync();
  }, 1_200);
});
