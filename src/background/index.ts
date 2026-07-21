/**
 * Service Worker entry point (MV3 background script).
 *
 * Responsibilities:
 *   - Handle all chrome.runtime.sendMessage() calls from popup,
 *     side panel, and content scripts.
 *   - Broadcast "LEAD_EXTRACTED" events to listening extension pages.
 *   - Manage extension lifecycle (install, keepAlive alarm).
 *
 * Message routing: popup/sidepanel → sendMessage → here → service → response
 */

import { signIn, signOut, getAuthState, ensureToken } from './auth';
import { listSpreadsheets, listWorksheets } from './sheets';
import { syncLead, syncAllLeads } from './sync';
import { invalidateDedupIndex } from './dedup';
import {
  getConfig,
  setConfig,
  getImportLog,
  clearImportLog,
  getSyncStats,
  resetSyncStats,
  setCurrentLead,
} from '@/utils/storage';
import type { Lead, Message, MessageResponse } from '@/types';

// ─── Message Handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (
    message: Message,
    _sender:  chrome.runtime.MessageSender,
    sendResponse: (r: MessageResponse) => void,
  ) => {
    handleMessage(message)
      .then(sendResponse)
      .catch((err: unknown) => {
        console.error('[LeadSync] Unhandled message error:', err);
        sendResponse({ success: false, error: String(err) });
      });

    // Must return true to keep the channel open for async sendResponse
    return true;
  },
);

async function handleMessage(msg: Message): Promise<MessageResponse> {
  switch (msg.type) {

    // ── Auth ──────────────────────────────────────────────────────────────────
    case 'SIGN_IN': {
      const state = await signIn();
      return { success: true, data: state };
    }
    case 'SIGN_OUT': {
      await signOut();
      invalidateDedupIndex();
      return { success: true };
    }
    case 'GET_AUTH_STATE': {
      const state = await getAuthState();
      return { success: true, data: state };
    }

    // ── Config ────────────────────────────────────────────────────────────────
    case 'GET_CONFIG': {
      const config = await getConfig();
      return { success: true, data: config };
    }
    case 'SET_CONFIG': {
      await setConfig(msg.payload as Parameters<typeof setConfig>[0]);
      invalidateDedupIndex(); // Sheet changed → stale index
      return { success: true };
    }

    // ── Google API ────────────────────────────────────────────────────────────
    case 'GET_SPREADSHEETS': {
      const token  = await ensureToken();
      const sheets = await listSpreadsheets(token);
      return { success: true, data: sheets };
    }
    case 'GET_WORKSHEETS': {
      const token  = await ensureToken();
      const { spreadsheetId } = msg.payload as { spreadsheetId: string };
      const tabs   = await listWorksheets(token, spreadsheetId);
      return { success: true, data: tabs };
    }

    // ── Sync ──────────────────────────────────────────────────────────────────
    case 'SYNC_LEAD': {
      const result = await syncLead(msg.payload as Lead);
      return { success: true, data: result };
    }
    case 'SYNC_ALL_LEADS': {
      const leads   = msg.payload as Lead[];
      const results = await syncAllLeads(leads);
      return { success: true, data: results };
    }

    // ── Import Log ────────────────────────────────────────────────────────────
    case 'GET_IMPORT_LOG': {
      const log = await getImportLog();
      return { success: true, data: log };
    }
    case 'CLEAR_IMPORT_LOG': {
      await clearImportLog();
      return { success: true };
    }

    // ── Stats ─────────────────────────────────────────────────────────────────
    case 'GET_SYNC_STATS': {
      const stats = await getSyncStats();
      return { success: true, data: stats };
    }
    case 'RESET_SYNC_STATS': {
      await resetSyncStats();
      return { success: true };
    }

    // ── Side Panel ────────────────────────────────────────────────────────────
    case 'OPEN_SIDE_PANEL': {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab?.windowId) {
          await chrome.sidePanel.open({ windowId: tab.windowId });
        }
      } catch (e) {
        console.warn('[LeadSync] sidePanel.open failed (Chrome < 114?):', e);
      }
      return { success: true };
    }

    // ── Lead Events (from content script) ────────────────────────────────────
    case 'LEAD_EXTRACTED': {
      const { lead } = msg.payload as { lead: Lead };
      await setCurrentLead(lead);
      // Broadcast to any open extension pages (side panel, popup)
      broadcastToExtensionPages({ type: 'LEAD_EXTRACTED', payload: lead });
      return { success: true, data: lead };
    }

    case 'AUTO_SYNC_TRIGGERED': {
      const { lead, autoSync } = msg.payload as { lead: Lead; autoSync: boolean };
      await setCurrentLead(lead);
      broadcastToExtensionPages({ type: 'LEAD_EXTRACTED', payload: lead });

      if (autoSync) {
        const result = await syncLead(lead);
        return { success: true, data: result };
      }
      return { success: true, data: lead };
    }

    // ── Content script extract ────────────────────────────────────────────────
    case 'EXTRACT_LEAD': {
      // Forwarded from popup → active tab's content script
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return { success: false, error: 'No active tab.' };
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_LEAD' }) as MessageResponse;
      return response;
    }

    default:
      return { success: false, error: `Unknown message type: ${(msg as Message).type}` };
  }
}

// ─── Broadcast helper ─────────────────────────────────────────────────────────

/** Send a message to all open extension pages (popup, side panel). Best-effort. */
function broadcastToExtensionPages(message: Message): void {
  chrome.runtime.sendMessage(message).catch(() => {
    // Throws if no listeners — that's fine when popup/sidepanel are closed
  });
}

// ─── Extension Lifecycle ──────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[LeadSync] Installed/updated:', details.reason);

  // Don't hijack the action button — let the popup open normally
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {
    // API not available on older Chrome
  });
});

// ─── Keep-alive alarm ─────────────────────────────────────────────────────────
// MV3 service workers sleep after ~30 s of inactivity.
// A periodic alarm wakes them up so long-running syncs aren't killed.

chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    // No-op — the listener itself prevents the SW from being killed
  }
});

console.log('[LeadSync] Service worker started.');
