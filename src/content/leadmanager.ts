/**
 * Lead Manager extractor for seller.indiamart.com/messagecentre
 *
 * Extracts all visible leads from the Lead Manager table.
 * Uses multi-strategy extraction:
 *   1. XHR/Fetch interception (most reliable — raw API data)
 *   2. DOM table scraping with IndiaMART-specific selectors
 *   3. Column-index fallback
 *
 * Column layout matches IndiaMART exactly:
 *   Sender Name | Phone | Requirement/Product | Quantity |
 *   Message Preview | Location | Source | Date/Time | Labels
 */

import type { Lead } from '@/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clean(text: string | null | undefined, max = 500): string | null {
  if (!text) return null;
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > max ? t.substring(0, max) : t || null;
}

function extractPhone(text: string): string | null {
  const m = text.match(/(?:\+91[-\s]?|0)?[6-9]\d{9}/g);
  return m ? m[0].replace(/[\s\-]/g, '') : null;
}

// ─── Row selectors ────────────────────────────────────────────────────────────
// IndiaMART Lead Manager uses a table with data-uid or data-gid on each row.
// We try the most specific first, then fall back to generic tbody rows.

const ROW_SELECTORS = [
  'tr[data-uid]',
  'tr[data-gid]',
  'tr[data-contactid]',
  'tr[data-lead-id]',
  'tr.datarow',
  'tr.contactrow',
  'tr.leadrow',
  'tr.msgrow',
  '[class*="lead-row"]',
  '[class*="contactRow"]',
  '[class*="msgRow"]',
  'table tbody tr:not([class*="header"]):not([class*="thead"])',
];

// ─── Find lead rows ───────────────────────────────────────────────────────────

export function findLeadRows(): Element[] {
  for (const sel of ROW_SELECTORS) {
    try {
      const rows = Array.from(document.querySelectorAll<Element>(sel));
      // Filter out rows with < 3 cells (likely header/empty)
      const dataRows = rows.filter((r) => r.querySelectorAll('td').length >= 3);
      if (dataRows.length > 0) return dataRows;
    } catch { continue; }
  }
  return [];
}

// ─── Per-row extraction ───────────────────────────────────────────────────────

/**
 * Extract all lead fields from a single row element.
 * Tries named selectors within the row, then falls back to TD column index.
 */
export function extractRowLead(row: Element): Lead | null {
  const cells = Array.from(row.querySelectorAll('td'));
  if (cells.length < 3) return null;

  // ── Sender Name ─────────────────────────────────────────────────────────
  const nameSels = [
    '.cname a', '.cname', '.sname', '.contact-name', '.contactName',
    '.name a', '.name', 'a.cname', 'a.sname',
    '[class*="cname"]', '[class*="contactName"]',
    '[class*="senderName"]', '[class*="sender-name"]',
  ];
  let buyerName: string | null = null;
  for (const sel of nameSels) {
    const el = row.querySelector(sel);
    if (el?.textContent?.trim()) { buyerName = clean(el.textContent); break; }
  }

  // ── Phone ─────────────────────────────────────────────────────────────────
  const phoneSels = [
    '.mob', '.phone', '.mobile', '.mobNum', '.cphone',
    '[data-mobile]', 'a[href^="tel:"]',
    '[class*="mob"]', '[class*="phone"]',
  ];
  let mobile: string | null = null;
  for (const sel of phoneSels) {
    const el = row.querySelector(sel);
    if (!el) continue;
    if (el.tagName === 'A') {
      mobile = (el as HTMLAnchorElement).href.replace('tel:', '').trim() || null;
    } else {
      mobile = extractPhone(el.textContent ?? '');
    }
    if (mobile) break;
  }

  // ── Product / Requirement ─────────────────────────────────────────────────
  const prodSels = [
    '.prd a', '.prd', '.product a', '.product', '.req a', '.req',
    '.requirement a', '.requirement', '.reqmnt', '.prdName',
    '[class*="prdName"]', '[class*="reqName"]', '[class*="product"]',
  ];
  let product: string | null = null;
  for (const sel of prodSels) {
    const el = row.querySelector(sel);
    if (el?.textContent?.trim()) { product = clean(el.textContent); break; }
  }

  // ── Quantity ──────────────────────────────────────────────────────────────
  const qtySels = [
    '.qty', '.quantity', '[class*="qty"]', '[class*="quantity"]',
  ];
  let quantity: string | null = null;
  for (const sel of qtySels) {
    const el = row.querySelector(sel);
    if (el?.textContent?.trim()) { quantity = clean(el.textContent); break; }
  }

  // ── Message Preview ───────────────────────────────────────────────────────
  const msgSels = [
    '.msg-text', '.msg', '.message', '.msgText', '.msgContent',
    '.last-msg', '.lastMsg', '[class*="msg"]', '[class*="message"]',
  ];
  let requirement: string | null = null;
  for (const sel of msgSels) {
    const el = row.querySelector(sel);
    if (el?.textContent?.trim()) { requirement = clean(el.textContent, 500); break; }
  }

  // ── Location ──────────────────────────────────────────────────────────────
  const locSels = [
    '.loc', '.city', '.location', '[class*="loc"]', '[class*="city"]',
    '[class*="location"]',
  ];
  let city: string | null = null;
  for (const sel of locSels) {
    const el = row.querySelector(sel);
    if (el?.textContent?.trim()) { city = clean(el.textContent); break; }
  }

  // ── Source ────────────────────────────────────────────────────────────────
  const srcSels = [
    '.src', '.source', '.leadSrc', '[class*="source"]', '[class*="src"]',
    '[class*="leadSource"]',
  ];
  let source: string | null = null;
  for (const sel of srcSels) {
    const el = row.querySelector(sel);
    if (el?.textContent?.trim()) { source = clean(el.textContent); break; }
  }

  // ── Date / Time ───────────────────────────────────────────────────────────
  const dateSels = [
    'time[datetime]', '.date', '.time', '.datetime', '.leadDate',
    '[class*="date"]', '[class*="time"]',
  ];
  let leadDate: string | null = null;
  for (const sel of dateSels) {
    const el = row.querySelector(sel);
    if (!el) continue;
    const dt = el.getAttribute('datetime');
    leadDate = clean(dt ?? el.textContent);
    if (leadDate) break;
  }

  // ── Labels ────────────────────────────────────────────────────────────────
  const labelSels = [
    '.label', '.tag', '.badge', '[class*="label"]', '[class*="tag"]',
  ];
  const labelTexts: string[] = [];
  for (const sel of labelSels) {
    row.querySelectorAll(sel).forEach((el) => {
      const t = el.textContent?.trim();
      if (t && t !== '+Label') labelTexts.push(t);
    });
    if (labelTexts.length) break;
  }
  const labels = labelTexts.length ? labelTexts.join(', ') : null;

  // ── Column-index fallback ─────────────────────────────────────────────────
  // If named selectors missed, guess from column positions.
  // IndiaMART Lead Manager column order (0-indexed td):
  //   0=checkbox, 1=star, 2=sender, 3=requirement, 4=labels,
  //   5=notes, 6=reminders, 7=messages, 8=location, 9=actions, 10=source, 11=date

  if (!buyerName && cells[2]) {
    const raw = cells[2].textContent ?? '';
    // Name is usually the first "word-group" before the phone number
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
    buyerName = clean(lines[0]);
    if (!mobile) mobile = extractPhone(raw);
  }

  if (!product && cells[3]) {
    const lines = (cells[3].textContent ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
    product  = clean(lines[0]);
    quantity = quantity ?? clean(lines[1]);
  }

  if (!requirement && cells[7]) requirement = clean(cells[7].textContent, 500);
  if (!city       && cells[8]) city         = clean(cells[8].textContent);
  if (!source     && cells[10]) source       = clean(cells[10].textContent);
  if (!leadDate   && cells[11]) leadDate     = clean(cells[11].textContent);

  // ── Require at least name or phone ───────────────────────────────────────
  if (!buyerName && !mobile && !product) return null;

  // Try to get a link to the individual lead for sourceUrl
  const anchor = row.querySelector<HTMLAnchorElement>('a[href*="messagecentre"], a[href*="lead"]');

  return {
    buyerName,
    company:     null,
    mobile,
    email:       null,
    product,
    quantity,
    requirement,
    city,
    state:       null,
    budget:      null,
    source,
    leadDate,
    labels,
    leadDate2:   undefined,
    sourceUrl:   anchor?.href ?? window.location.href,
  };
}

// ─── Public: extract all visible leads on current page ────────────────────────

/**
 * Extract all lead rows visible on the current Lead Manager page.
 * Returns an array of leads (may be 20–30 per page).
 */
export function extractLeadManagerPage(): Lead[] {
  const rows = findLeadRows();
  const leads: Lead[] = [];

  for (const row of rows) {
    try {
      const lead = extractRowLead(row);
      if (lead) leads.push(lead);
    } catch { continue; }
  }

  return leads;
}

// ─── Pagination ───────────────────────────────────────────────────────────────

const NEXT_BTN_SELECTORS = [
  'a[title="Next"]',
  'a[aria-label="Next"]',
  'a[aria-label="next"]',
  '.pagination .next:not(.disabled)',
  '.pagination .next a',
  'button[aria-label="Next Page"]',
  '.next-page:not(.disabled)',
  '.nextpage:not(.disabled)',
  'li.next:not(.disabled) a',
  '[class*="pagination"] a[href*="page"]',
  'a.nextpg',
  'button.next',
  // Text-based fallback
  'a, button',
];

/**
 * Find the "Next Page" button on the current page.
 * Returns null if no next page exists (last page).
 */
export function findNextButton(): HTMLElement | null {
  for (const sel of NEXT_BTN_SELECTORS) {
    if (!sel.includes('a, button')) {
      const el = document.querySelector<HTMLElement>(sel);
      if (el) return el;
      continue;
    }
    // Text-based: find any clickable element containing "Next" or ">"
    const candidates = Array.from(document.querySelectorAll<HTMLElement>('a, button'));
    for (const c of candidates) {
      const txt = c.textContent?.trim().toLowerCase() ?? '';
      if ((txt === 'next' || txt === '›' || txt === '»' || txt === 'next >') &&
          !c.classList.contains('disabled') &&
          !c.hasAttribute('disabled')) {
        return c;
      }
    }
  }
  return null;
}

/**
 * Returns the current page number visible in the UI.
 * Used to detect when the page has actually changed.
 */
export function getCurrentPageNumber(): string {
  const sels = [
    '.pagination .active', '.pagination .current',
    '[class*="pageNum"]', '[class*="currentPage"]',
    '.page-number', '#pageNum',
  ];
  for (const sel of sels) {
    const el = document.querySelector(sel);
    if (el?.textContent?.trim()) return el.textContent.trim();
  }
  return document.title + window.location.href;
}

/**
 * Wait until the lead table content changes (new page loaded).
 * Uses MutationObserver with a timeout.
 */
export function waitForPageChange(
  previousFirstRowText: string,
  timeoutMs = 8000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const rows = findLeadRows();
    const check = () => {
      const newRows = findLeadRows();
      if (newRows.length > 0) {
        const firstText = newRows[0].textContent ?? '';
        if (firstText !== previousFirstRowText) {
          observer.disconnect();
          resolve(true);
        }
      }
    };

    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      resolve(false); // timeout — stop pagination
    }, timeoutMs);
  });
}
