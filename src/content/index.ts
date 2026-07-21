/**
 * Content script entry point — runs on every IndiaMART page.
 *
 * Responsibilities:
 *  1. Extract lead data when a lead page is detected.
 *  2. Send extracted data to the background service worker.
 *  3. Watch for SPA navigation and re-extract on URL change.
 *  4. Respond to messages from the popup (EXTRACT_LEAD, SYNC_ALL_LEADS).
 *  5. Respect the autoSync toggle stored in chrome.storage.sync.
 *
 * NOTE: This file is compiled as IIFE (see vite.content.config.ts).
 *       All imports are bundled inline — no ES module output.
 */

import { extractLead, extractAllVisibleLeads } from './extractor';
import { observeNavigation, isLeadPage } from './observer';
import type { Message, MessageResponse } from '@/types';

// ─── State ────────────────────────────────────────────────────────────────────

let autoSync = false;

// ─── Messaging helpers ────────────────────────────────────────────────────────

/** Send a typed message to the background service worker. */
async function toBackground<T = unknown>(msg: Message): Promise<MessageResponse<T>> {
  try {
    return await chrome.runtime.sendMessage(msg) as MessageResponse<T>;
  } catch (err) {
    // Extension context invalidated (e.g., extension was reloaded)
    return { success: false, error: String(err) };
  }
}

// ─── Lead page handler ────────────────────────────────────────────────────────

/**
 * Extract a lead from the current page and forward it to the background.
 * Waits briefly for dynamic content to settle after a navigation event.
 */
async function handleLeadPage(delayMs = 900): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, delayMs));

  const lead = extractLead();
  if (!lead) return;

  const type = autoSync ? 'AUTO_SYNC_TRIGGERED' : 'LEAD_EXTRACTED';
  await toBackground({ type, payload: { lead, autoSync } });
}

// ─── Auto-sync initialisation ─────────────────────────────────────────────────

async function initAutoSync(): Promise<void> {
  try {
    const res = await toBackground<{ autoSync: boolean }>({ type: 'GET_CONFIG' });
    if (res.success && res.data) {
      autoSync = res.data.autoSync;
    }
  } catch {
    // Background may not be ready — default to false
  }

  // React to future config changes in real time
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes['leadsync_config']?.newValue) {
      const newAutoSync = changes['leadsync_config'].newValue.autoSync;
      if (typeof newAutoSync === 'boolean') {
        autoSync = newAutoSync;
      }
    }
  });
}

// ─── Inbound messages from popup / background ─────────────────────────────────

chrome.runtime.onMessage.addListener(
  (
    message:      Message,
    _sender:      chrome.runtime.MessageSender,
    sendResponse: (r: MessageResponse) => void,
  ) => {
    (async () => {
      switch (message.type) {
        case 'EXTRACT_LEAD': {
          const lead = extractLead();
          sendResponse({ success: true, data: lead });
          break;
        }

        case 'SYNC_ALL_LEADS': {
          // Popup asked content script to collect all visible leads,
          // then forward them to background for syncing.
          const leads = extractAllVisibleLeads();
          if (leads.length === 0) {
            sendResponse({ success: false, error: 'No leads found on this page.' });
            break;
          }
          const res = await toBackground({ type: 'SYNC_ALL_LEADS', payload: leads });
          sendResponse(res);
          break;
        }

        default:
          sendResponse({ success: false, error: `Unknown type: ${message.type}` });
      }
    })();

    // Return true to keep the response channel open for async operations
    return true;
  },
);

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await initAutoSync();

  // Handle the page that was already loaded when the content script injected
  if (isLeadPage()) {
    await handleLeadPage();
  }

  // Watch for SPA navigations
  observeNavigation(async (newUrl) => {
    if (isLeadPage(newUrl)) {
      // Give the SPA time to render the new page content
      await handleLeadPage(1200);
    }
  });
}

main().catch((err) => console.error('[LeadSync Content] Fatal error:', err));
