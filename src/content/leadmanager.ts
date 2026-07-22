/**
 * leadmanager.ts
 *
 * Direct DOM Lead Extractor for seller.indiamart.com/messagecentre.
 * Maps columns dynamically from the table header or uses IndiaMART's exact
 * column layout so Sender, Phone, Requirement, Message, Location, Source, Date,
 * and Labels are populated 100% accurately.
 */

import type { Lead } from '@/types';

// ─── Regex Helpers ────────────────────────────────────────────────────────────

const PHONE_RE = /(?:0|\+91|91)?([6-9]\d{9}|\d{10})/;
const PHONE_GLOBAL_RE = /(?:0|\+91|91)?([6-9]\d{9}|\d{10})/g;

function clean(text: string | null | undefined, max = 500): string | null {
  if (!text) return null;
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > max ? t.substring(0, max) : t || null;
}

function extractPhone(text: string): string | null {
  PHONE_RE.lastIndex = 0;
  const m = PHONE_RE.exec(text);
  return m ? m[1] : null;
}

// ─── Column Mapping ───────────────────────────────────────────────────────────

interface ColumnMapping {
  sender: number;
  requirement: number;
  labels: number;
  messages: number;
  location: number;
  source: number;
  date: number;
}

/**
 * Detect column indices dynamically by inspecting table header cells (th / td).
 * Defaults to IndiaMART's standard Lead Manager layout if headers aren't explicit.
 */
function getColumnMapping(): ColumnMapping {
  const mapping: ColumnMapping = {
    sender: 2,
    requirement: 3,
    labels: 4,
    messages: 7,
    location: 8,
    source: 10,
    date: 11,
  };

  // Look for header row (tr containing th or header text)
  const headerRow = document.querySelector('tr:has(th), tr.table-header, thead tr, tr[class*="header"]');
  if (!headerRow) return mapping;

  const headerCells = Array.from(headerRow.querySelectorAll('th, td'));
  headerCells.forEach((cell, idx) => {
    const txt = (cell.textContent ?? '').trim().toUpperCase();
    if (txt.includes('SENDER') || txt.includes('CONTACT')) mapping.sender = idx;
    else if (txt.includes('REQUIREMENT') || txt.includes('PRODUCT')) mapping.requirement = idx;
    else if (txt.includes('LABEL')) mapping.labels = idx;
    else if (txt.includes('MESSAGE')) mapping.messages = idx;
    else if (txt.includes('LOCATION') || txt.includes('CITY')) mapping.location = idx;
    else if (txt.includes('SOURCE')) mapping.source = idx;
    else if (txt.includes('DATE') || txt.includes('TIME')) mapping.date = idx;
  });

  return mapping;
}

// ─── Extract Lead from Row ────────────────────────────────────────────────────

function extractLeadFromRow(row: Element, map: ColumnMapping): Lead | null {
  let cells = Array.from(row.querySelectorAll('td'));
  if (cells.length === 0) {
    cells = Array.from(row.children).filter((c) => {
      const tag = c.tagName.toUpperCase();
      return tag !== 'SCRIPT' && tag !== 'STYLE' && tag !== 'INPUT';
    }) as HTMLTableCellElement[];
  }

  if (cells.length < 3) return null;

  // 1. Locate Sender Cell & Phone
  let senderIdx = map.sender;
  if (senderIdx >= cells.length || !PHONE_RE.test(cells[senderIdx]?.textContent ?? '')) {
    // Fallback: search first 4 cells for phone number
    senderIdx = -1;
    for (let i = 0; i < Math.min(4, cells.length); i++) {
      if (PHONE_RE.test(cells[i].textContent ?? '')) {
        senderIdx = i;
        break;
      }
    }
  }

  if (senderIdx === -1) return null;

  const senderCellText = cells[senderIdx].textContent ?? '';
  const mobile = extractPhone(senderCellText);
  if (!mobile) return null;

  // Sender Name
  const buyerName = clean(
    senderCellText
      .replace(PHONE_GLOBAL_RE, '')
      .replace(/GST/gi, '')
      .replace(/Verified/gi, '')
      .replace(/Add note|\+/gi, '')
      .trim()
      .split('\n')[0]
  ) || 'IndiaMART Lead';

  // Helper to safely get clean text from a target index
  const getCellText = (idx: number, fallbackOffset?: number): string | null => {
    let cell = cells[idx];
    if (!cell && fallbackOffset !== undefined && senderIdx + fallbackOffset < cells.length) {
      cell = cells[senderIdx + fallbackOffset];
    }
    if (!cell) return null;
    const txt = (cell.textContent ?? '').trim();
    if (!txt || txt === '-' || txt.startsWith('+ Label') || txt.startsWith('Add note')) return null;
    return clean(txt);
  };

  // 2. Requirement (Product Name & Quantity)
  const product = getCellText(map.requirement, 1);

  // 3. Message Preview
  let requirement = getCellText(map.messages, 5);
  // Clean out common UI noise in messages column
  if (requirement && /^(Tomorrow|Add note|\+|\d{1,2}:\d{2})$/i.test(requirement)) {
    requirement = null;
  }

  // 4. Location / City
  let city = getCellText(map.location, 6);
  if (city && /^(Tomorrow|Add note|Buylead|Direct|Other|Call|Actions)$/i.test(city)) {
    city = null;
  }

  // 5. Source (Buylead / Other / Call / Direct)
  let source = getCellText(map.source, 8);
  if (source) {
    const srcMatch = source.match(/(Buylead|Direct|Other|Call|Catalog Link|Buy Leads)/i);
    source = srcMatch ? srcMatch[0] : source;
  }

  // 6. Date / Time (10:50 AM, Yesterday, 18 Jul)
  let leadDate = getCellText(map.date, 9);
  if (leadDate) {
    const dateMatch = leadDate.match(/(?:\d{1,2}:\d{2}\s*(?:AM|PM)?|Yesterday|\d{1,2}\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
    leadDate = dateMatch ? dateMatch[0] : leadDate;
  }

  // 7. Labels
  let labels: string | null = null;
  const labelCell = cells[map.labels] ?? cells[senderIdx + 2];
  if (labelCell) {
    const badgeEls = labelCell.querySelectorAll('[class*="badge"], [class*="label"], [class*="tag"]');
    if (badgeEls.length > 0) {
      const badgeTexts = Array.from(badgeEls)
        .map((b) => b.textContent?.trim())
        .filter((t) => t && t !== '+ Label' && t !== 'Add note');
      if (badgeTexts.length > 0) {
        labels = clean(badgeTexts.join(', '));
      }
    } else {
      const txt = (labelCell.textContent ?? '').trim();
      if (txt && !txt.startsWith('+ Label') && !txt.startsWith('Add note')) {
        labels = clean(txt);
      }
    }
  }

  const anchor = row.querySelector<HTMLAnchorElement>('a[href*="messagecentre"], a[href*="lead"], a[href*="contact"]');

  return {
    buyerName,
    company: null,
    mobile,
    email: null,
    product,
    quantity: null,
    requirement,
    city,
    state: null,
    budget: null,
    source,
    leadDate,
    labels: labels || null,
    sourceUrl: anchor?.href ?? window.location.href,
  };
}

// ─── Public DOM Extractor ─────────────────────────────────────────────────────

export function extractLeadManagerPage(): Lead[] {
  const map = getColumnMapping();
  const trs = Array.from(document.querySelectorAll('tr')).filter((tr) => {
    if (tr.querySelector('th')) return false;
    const text = tr.textContent ?? '';
    return PHONE_RE.test(text);
  });

  const leads: Lead[] = [];
  const seenPhones = new Set<string>();

  for (const tr of trs) {
    try {
      const lead = extractLeadFromRow(tr, map);
      if (!lead || !lead.mobile) continue;

      if (seenPhones.has(lead.mobile)) continue;
      seenPhones.add(lead.mobile);

      leads.push(lead);
    } catch (e) {
      console.warn('[LeadSync] Error parsing row:', e);
    }
  }

  console.log(`[LeadSync] DOM Extracted ${leads.length} leads with column mapping:`, map);
  return leads;
}

// ─── Pagination ───────────────────────────────────────────────────────────────

const NEXT_SELECTORS = [
  'a[title*="Next"]',
  'a[aria-label*="Next"]',
  'button[title*="Next"]',
  'button[aria-label*="Next"]',
  '.pagination .next:not(.disabled)',
  '.pagination li.next:not(.disabled) a',
  'li.next:not(.disabled) a',
  '.next-page:not(.disabled)',
  'a.nextpg',
  'button[aria-label="Next Page"]',
  '[class*="pagination"] [class*="next"]',
  '[class*="pagination"] a:last-child',
  '[class*="nextPage"]',
  '[class*="btn-next"]',
  '[id*="btnNext"]',
  '[id*="nextPage"]',
];

function isVisible(el: HTMLElement): boolean {
  if (el.classList.contains('disabled') || el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).display !== 'none';
}

export function findNextButton(): HTMLElement | null {
  for (const sel of NEXT_SELECTORS) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el && isVisible(el)) return el;
  }

  const pageBars = Array.from(document.querySelectorAll<HTMLElement>('[class*="page"], [class*="pagi"], [id*="page"]'));
  for (const bar of pageBars) {
    const clickable = bar.querySelectorAll<HTMLElement>('a, button, i, span, svg');
    for (const c of clickable) {
      if (!isVisible(c)) continue;
      const txt = (c.textContent ?? '').trim();
      const title = (c.getAttribute('title') ?? '').trim();
      const aria = (c.getAttribute('aria-label') ?? '').trim();

      if (/^(next|>|›|»)$/i.test(txt) || /next|>|›|»/i.test(title) || /next|>|›|»/i.test(aria)) {
        return c;
      }
    }
  }

  const allClickable = Array.from(document.querySelectorAll<HTMLElement>('a, button, span, div[onclick], div[role="button"]'));
  for (const el of allClickable) {
    if (!isVisible(el)) continue;
    const txt = (el.textContent ?? '').trim().toLowerCase();
    const title = (el.getAttribute('title') ?? '').trim().toLowerCase();
    const aria = (el.getAttribute('aria-label') ?? '').trim().toLowerCase();

    if (
      txt === 'next' || txt === '>' || txt === '›' || txt === '»' || txt === 'next >' ||
      title.includes('next') || aria.includes('next') || el.className.toLowerCase().includes('next')
    ) {
      return el;
    }
  }

  return null;
}

export function getPageSignature(): string {
  return (document.body?.textContent ?? '').substring(0, 300);
}

export function waitForPageChange(prevSig: string, timeoutMs = 8_000): Promise<boolean> {
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const sig = (document.body?.textContent ?? '').substring(0, 300);
      if (sig !== prevSig) {
        observer.disconnect();
        resolve(true);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    setTimeout(() => {
      observer.disconnect();
      resolve(false);
    }, timeoutMs);
  });
}

let _capturedLeads: Lead[] = [];
export function setCapturedLeads(leads: Lead[]): void { _capturedLeads = leads; }
export function getCapturedLeads(): Lead[] { return _capturedLeads; }
export function clearCapturedLeads(): void { _capturedLeads = []; }
