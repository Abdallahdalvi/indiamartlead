/**
 * Content script entry point.
 *
 * Provides DOM extraction and navigation actions when requested by the
 * Background Service Worker. Because the Background Service Worker controls
 * the bulk sync loop, tab switching / tab hiding will NOT pause or stop automation.
 */

import {
  extractLeadManagerPage,
  findNextButton,
  waitForPageChange,
  getPageSignature,
} from './leadmanager';
import { extractLead } from './extractor';
import { observeNavigation } from './observer';
import type { Lead } from '@/types';

function isLeadManager(): boolean {
  return /seller\.indiamart\.com\/messagecentre/i.test(window.location.href);
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

// ─── Message listener (called by Background Worker) ───────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const type = message?.type;

  // 1. Background asks for current page DOM leads
  if (type === 'EXTRACT_PAGE_LEADS' || type === 'EXTRACT_LEAD') {
    try {
      const leads = extractLeadManagerPage();
      sendResponse({ success: true, data: leads });
    } catch (e) {
      sendResponse({ success: false, error: String(e) });
    }
    return true;
  }

  // 2. Background asks to click Next Page button
  if (type === 'CLICK_NEXT_PAGE') {
    const nextBtn = findNextButton();
    if (!nextBtn) {
      sendResponse({ success: true, data: { hasNext: false } });
    } else {
      // Dispatch full mouse sequence to ensure SPA frameworks pick it up
      nextBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      nextBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      nextBtn.click();
      sendResponse({ success: true, data: { hasNext: true } });
    }
    return true;
  }

  return false;
});

// ─── Initialise ───────────────────────────────────────────────────────────────

function init(): void {
  if (isLeadManager()) {
    console.log('[LeadSync] Content script active on Lead Manager.');
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
