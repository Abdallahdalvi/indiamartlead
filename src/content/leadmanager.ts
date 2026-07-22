/**
 * leadmanager.ts
 *
 * Lead extraction for seller.indiamart.com/messagecentre.
 *
 * DOM Fallback (Strategy B) — fixes the garbage import issue:
 *   • Finds the table with the most phone-containing rows
 *   • For each TR, locates the SENDER cell (the one containing a phone number
 *     in one of the first 3 TDs — not Notes/Messages/Actions columns)
 *   • Uses fixed column offsets from the sender column index
 *   • Skips rows whose "phone" cell also contains known UI noise:
 *     "Add note", "Tomorrow", "USER_", "Catalog Link", "Follow Up", etc.
 */

import type { Lead } from '@/types';

// ─── Shared store (populated by API capture via postMessage) ──────────────────

let _capturedLeads: Lead[] = [];

export function setCapturedLeads(leads: Lead[]): void {
  _capturedLeads = leads;
}
export function getCapturedLeads(): Lead[] {
  return _capturedLeads;
}
export function clearCapturedLeads(): void {
  _capturedLeads = [];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PHONE_RE   = /(?:0|\+91|91)?([6-9]\d{9})/;
const NOISE_RE   = /add note|tomorrow|follow.?up|deal done|contacted|fresh|catalog|catalogue|user_|buylead|direct|other|label|reminder|manage col/i;
const DATE_RE    = /\d{1,2}\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|\d{2}[\/\-]\d{2}[\/\-]\d{2,4}|\d{2}:\d{2}/i;
const SOURCE_RE  = /^(buylead|direct|other|catalog link|catalogue link|buyleads)$/i;

function clean(text: string | null | undefined, max = 400): string | null {
  if (!text) return null;
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > max ? t.substring(0, max) : t || null;
}

function extractPhoneFrom(text: string): string | null {
  PHONE_RE.lastIndex = 0;
  const m = PHONE_RE.exec(text);
  return m ? m[1] : null;
}

function isNoiseText(text: string): boolean {
  return NOISE_RE.test(text) || text.trim().length === 0;
}

// ─── Find the leads table ─────────────────────────────────────────────────────

/**
 * Find the table element that contains the most rows with phone numbers.
 * This is the leads table — distinct from header/sidebar/footer tables.
 */
function findLeadsTable(): Element | null {
  // Try known selectors first
  const known = [
    '#lbody', '#contactListTable', '#leadTable', '#allContactsTable',
    '.contact-list table', '.lead-list table', '.msgcntr-table',
    '[class*="contactList"] table', '[class*="leadList"] table',
    '[id*="contact"][id*="table"]', '[id*="lead"][id*="table"]',
  ];
  for (const sel of known) {
    const el = document.querySelector(sel);
    if (el) return el;
  }

  // Find the table with the most rows containing phone numbers
  let best: Element | null = null;
  let bestCount = 0;

  for (const table of document.querySelectorAll('table')) {
    // Skip tables in header, sidebar, nav
    if (table.closest('header, nav, footer, .sidebar, [class*="header"], [class*="nav"], [id*="header"]')) continue;

    let count = 0;
    for (const tr of table.querySelectorAll('tr')) {
      if (PHONE_RE.test(tr.textContent ?? '')) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      best = table;
    }
  }

  return best;
}

// ─── Extract a single TR row ──────────────────────────────────────────────────

/**
 * IndiaMART Lead Manager column order (0-indexed TD):
 *   0 = Checkbox
 *   1 = Star
 *   2 = SENDER (name + phone)     ← phone must be here
 *   3 = REQUIREMENT (product/qty)
 *   4 = LABELS
 *   5 = NOTES                     ← "Add note" noise, skip
 *   6 = REMINDERS                 ← "Tomorrow 10:00", skip
 *   7 = MESSAGES
 *   8 = LOCATION
 *   9 = ACTIONS                   ← buttons, skip
 *  10 = SOURCE
 *  11 = DATE/TIME
 *
 * We detect which TD is the SENDER by finding the first TD (index 0-3)
 * that contains a phone number and does NOT contain noise text.
 * All other columns are resolved by offset from the sender index.
 */
function extractRow(tr: Element): Lead | null {
  const cells = Array.from(tr.querySelectorAll('td'));
  if (cells.length < 4) return null;

  // ── Find sender cell (must be in first 3 TDs) ─────────────────────────────
  let senderIdx = -1;
  let mobile: string | null = null;

  for (let i = 0; i <= Math.min(3, cells.length - 1); i++) {
    const cellText = cells[i].textContent ?? '';
    const phone    = extractPhoneFrom(cellText);
    if (phone && !isNoiseText(cellText)) {
      senderIdx = i;
      mobile    = phone;
      break;
    }
  }

  if (senderIdx === -1) return null; // No valid phone in sender area

  // ── Extract name from sender cell ─────────────────────────────────────────
  // Name is the text in the cell MINUS the phone number and noise
  const senderRaw = (cells[senderIdx].textContent ?? '').trim();
  const buyerName = clean(
    senderRaw
      .replace(PHONE_RE, '')
      .replace(/GST/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .split('\n')[0]
  );

  // ── Column offsets from sender index ──────────────────────────────────────
  // Based on the known Lead Manager column order
  const off = (offset: number): string | null => {
    const idx = senderIdx + offset;
    if (idx < 0 || idx >= cells.length) return null;
    const text = (cells[idx].textContent ?? '').trim();
    return text && !isNoiseText(text) ? clean(text) : null;
  };

  const product     = off(1);  // REQUIREMENT
  // LABELS (offset 2) — extract badge text
  const labelEls    = cells[senderIdx + 2]?.querySelectorAll('[class*="badge"],[class*="label"],[class*="tag"],[class*="chip"]') ?? [];
  const labels      = labelEls.length
    ? Array.from(labelEls).map((e) => e.textContent?.trim()).filter(Boolean).join(', ') || null
    : off(2);

  // Skip NOTES (offset 3) and REMINDERS (offset 4) — always noise
  const messageRaw  = off(5);  // MESSAGES
  const city        = off(6);  // LOCATION

  // SOURCE (offset 8, skipping ACTIONS at 7)
  const srcRaw8     = off(8);
  const srcRaw7     = off(7);
  const source      = SOURCE_RE.test(srcRaw8 ?? '') ? srcRaw8
                    : SOURCE_RE.test(srcRaw7 ?? '') ? srcRaw7
                    : null;

  // DATE (offset 9 or 10)
  const dateRaw9    = off(9);
  const dateRaw10   = off(10);
  const leadDate    = DATE_RE.test(dateRaw10 ?? '') ? dateRaw10
                    : DATE_RE.test(dateRaw9  ?? '') ? dateRaw9
                    : null;

  // Link for sourceUrl
  const anchor      = tr.querySelector<HTMLAnchorElement>('a[href*="messagecentre"],a[href*="lead"],a[href*="contact"]');

  return {
    buyerName:   buyerName || null,
    company:     null,
    mobile,
    email:       null,
    product,
    quantity:    null,
    requirement: messageRaw,
    city,
    state:       null,
    budget:      null,
    source,
    leadDate,
    labels:      labels || null,
    sourceUrl:   anchor?.href ?? window.location.href,
  };
}

// ─── Public: extract all leads on the current page ───────────────────────────

export function extractLeadManagerPage(): Lead[] {
  const table = findLeadsTable();
  if (!table) {
    console.warn('[LeadSync] Could not find leads table. Will retry with API data.');
    return [];
  }

  const rows = Array.from(table.querySelectorAll('tr'));
  const leads: Lead[] = [];
  const seen  = new Set<string>();

  for (const tr of rows) {
    // Skip header rows (TH cells)
    if (tr.querySelector('th')) continue;
    // Skip rows without enough cells
    if (tr.querySelectorAll('td').length < 4) continue;

    try {
      const lead = extractRow(tr);
      if (!lead) continue;

      // Dedup by phone within this page
      const key = lead.mobile ?? `${lead.buyerName}|${lead.product}`;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      leads.push(lead);
    } catch { continue; }
  }

  console.log(`[LeadSync] DOM extracted ${leads.length} leads from ${rows.length} rows`);
  return leads;
}

// ─── Pagination ───────────────────────────────────────────────────────────────

const NEXT_SELECTORS = [
  'a[title="Next"]', 'a[aria-label="Next"]',
  '.pagination .next:not(.disabled)',
  '.pagination li.next:not(.disabled) a',
  'li.next:not(.disabled) a', '.next-page:not(.disabled)',
  'a.nextpg', 'button[aria-label="Next Page"]',
];

export function findNextButton(): HTMLElement | null {
  for (const sel of NEXT_SELECTORS) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) return el;
  }
  return Array.from(document.querySelectorAll<HTMLElement>('a, button')).find((el) => {
    const txt = (el.textContent ?? '').trim().toLowerCase();
    return (txt === 'next' || txt === '›' || txt === '»' || txt === 'next >') &&
           !el.classList.contains('disabled') && !el.hasAttribute('disabled');
  }) ?? null;
}

export function getPageSignature(): string {
  return (document.body?.textContent ?? '').substring(50, 300);
}

export function waitForPageChange(prev: string, timeoutMs = 10_000): Promise<boolean> {
  return new Promise((resolve) => {
    const ob = new MutationObserver(() => {
      const sig = (document.body?.textContent ?? '').substring(50, 300);
      if (sig !== prev) { ob.disconnect(); resolve(true); }
    });
    ob.observe(document.body, { childList: true, subtree: true, characterData: true });
    setTimeout(() => { ob.disconnect(); resolve(false); }, timeoutMs);
  });
}
