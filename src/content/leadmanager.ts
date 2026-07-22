/**
 * leadmanager.ts
 *
 * Direct DOM Lead Extractor for seller.indiamart.com/messagecentre.
 * Does not require API keys or network interception. Reads directly
 * from what is displayed on the screen.
 */

import type { Lead } from '@/types';

// ─── Regex Patterns ───────────────────────────────────────────────────────────

// Matches Indian mobile numbers (10 digits starting 6-9, or prefixed with 0, 91, +91)
const PHONE_RE = /(?:0|\+91|91)?([6-9]\d{9}|\d{10})/;
const PHONE_GLOBAL_RE = /(?:0|\+91|91)?([6-9]\d{9}|\d{10})/g;

const NOISE_WORDS_RE = /add note|tomorrow|\b\d{1,2}:\d{2}\s*(?:am|pm)?\b|follow.?up|deal done|contacted|fresh|catalog|catalogue|reminder|manage col|all contacts/i;
const DATE_PATTERNS = /\b(?:\d{1,2}:\d{2}\s*(?:AM|PM)?|Yesterday|\d{1,2}\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/i;
const KNOWN_SOURCES = /^(Buylead|Direct|Other|Call|Catalog Link|Catalogue Link|Buy Leads)$/i;

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

// ─── Find Row Containers ──────────────────────────────────────────────────────

/**
 * Finds all row elements on the page.
 * Works whether IndiaMART uses <table>/<tr> or <div>/<div> list items.
 */
function findRowElements(): Element[] {
  const rows: Element[] = [];

  // Strategy 1: Check standard <tr> inside table (excluding header <th> rows)
  const trs = Array.from(document.querySelectorAll('tr')).filter((tr) => {
    if (tr.querySelector('th')) return false;
    const text = tr.textContent ?? '';
    return PHONE_RE.test(text);
  });

  if (trs.length > 0) return trs;

  // Strategy 2: Look for div/li/section elements that contain phone numbers
  const allElements = Array.from(document.querySelectorAll('div, li, section, article'));
  const candidates: Element[] = [];

  for (const el of allElements) {
    // Must contain a phone number directly in text
    if (!PHONE_RE.test(el.textContent ?? '')) continue;

    // Check if it looks like a row container (width > 300px, height between 25px and 300px)
    const rect = el.getBoundingClientRect();
    if (rect.width > 300 && rect.height >= 25 && rect.height <= 300) {
      // Avoid picking outer wrapper if child also matches
      const hasChildCandidate = Array.from(el.children).some((child) => {
        const cRect = child.getBoundingClientRect();
        return cRect.width > 300 && cRect.height >= 25 && PHONE_RE.test(child.textContent ?? '');
      });
      if (!hasChildCandidate) {
        candidates.push(el);
      }
    }
  }

  return candidates;
}

// ─── Extract Lead from Row Container ──────────────────────────────────────────

function extractLeadFromRow(row: Element): Lead | null {
  const rowText = row.textContent ?? '';
  const mobile = extractPhone(rowText);
  if (!mobile) return null;

  // Get cell / column elements inside this row
  let cells = Array.from(row.querySelectorAll('td'));
  if (cells.length === 0) {
    // Div-based layout: collect direct or 1-level deep block children
    cells = Array.from(row.children).filter((c) => {
      const tag = c.tagName.toUpperCase();
      return tag !== 'SCRIPT' && tag !== 'STYLE' && tag !== 'INPUT';
    }) as HTMLTableCellElement[];
  }

  let buyerName: string | null = null;
  let product: string | null = null;
  let requirement: string | null = null;
  let city: string | null = null;
  let source: string | null = null;
  let leadDate: string | null = null;
  let labels: string | null = null;

  // Extract cells by inspection
  if (cells.length >= 3) {
    // 1. Locate Sender Cell (the cell containing the phone number)
    let senderCellIdx = -1;
    for (let i = 0; i < cells.length; i++) {
      if (PHONE_RE.test(cells[i].textContent ?? '')) {
        senderCellIdx = i;
        break;
      }
    }

    if (senderCellIdx !== -1) {
      // Sender Name = cell text minus phone number, minus GST / extra icons
      const senderText = cells[senderCellIdx].textContent ?? '';
      buyerName = clean(
        senderText
          .replace(PHONE_GLOBAL_RE, '')
          .replace(/GST/gi, '')
          .replace(/Verified/gi, '')
          .replace(/Add note|\+/gi, '')
          .trim()
          .split('\n')[0]
      );

      // Requirement = cell after Sender
      if (senderCellIdx + 1 < cells.length) {
        const reqText = (cells[senderCellIdx + 1].textContent ?? '').trim();
        if (reqText && reqText !== '-' && !reqText.startsWith('+ Label')) {
          product = clean(reqText.replace(/\s+/g, ' '));
        }
      }

      // Check all remaining cells for specific field signatures
      for (let i = 0; i < cells.length; i++) {
        const txt = (cells[i].textContent ?? '').trim();
        if (!txt || i === senderCellIdx) continue;

        // Source
        if (KNOWN_SOURCES.test(txt)) {
          source = source ?? clean(txt);
          continue;
        }

        // Date
        if (DATE_PATTERNS.test(txt) && !txt.includes('Tomorrow')) {
          leadDate = leadDate ?? clean(txt);
          continue;
        }

        // Labels badge
        const badgeEls = cells[i].querySelectorAll('[class*="badge"], [class*="label"], [class*="tag"]');
        if (badgeEls.length > 0) {
          const badgeTexts = Array.from(badgeEls)
            .map((b) => b.textContent?.trim())
            .filter((t) => t && t !== '+ Label' && t !== 'Add note');
          if (badgeTexts.length > 0) {
            labels = labels ?? clean(badgeTexts.join(', '));
            continue;
          }
        }

        // Message Preview (cell with length > 15, not containing 'Add note' or 'Tomorrow')
        if (
          !requirement &&
          txt.length > 12 &&
          !NOISE_WORDS_RE.test(txt) &&
          i !== senderCellIdx + 1
        ) {
          requirement = clean(txt);
          continue;
        }

        // Location / City (short text without numbers, coming after requirement)
        if (!city && txt.length > 2 && txt.length < 35 && /^[A-Za-z\s]+$/.test(txt)) {
          // Verify it's not a noise word
          if (!/^(Tomorrow|Add note|Buylead|Direct|Other|Call|Fresh|Contacted|Deal Done)$/i.test(txt)) {
            city = clean(txt);
          }
        }
      }
    }
  }

  // Fallback: If Sender Name is missing, use text node preceding the phone number
  if (!buyerName) {
    const rawText = rowText.replace(/\s+/g, ' ');
    const phoneIdx = rawText.indexOf(mobile);
    if (phoneIdx > 0) {
      const preceding = rawText.substring(Math.max(0, phoneIdx - 60), phoneIdx);
      buyerName = clean(preceding.replace(/GST|Verified|\+/gi, '').trim().split(' ').slice(-3).join(' '));
    }
  }

  const anchor = row.querySelector<HTMLAnchorElement>('a[href*="messagecentre"], a[href*="lead"], a[href*="contact"]');

  return {
    buyerName: buyerName || 'IndiaMART Lead',
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
  const rowEls = findRowElements();
  const leads: Lead[] = [];
  const seenPhones = new Set<string>();

  for (const row of rowEls) {
    try {
      const lead = extractLeadFromRow(row);
      if (!lead || !lead.mobile) continue;

      if (seenPhones.has(lead.mobile)) continue;
      seenPhones.add(lead.mobile);

      leads.push(lead);
    } catch (e) {
      console.warn('[LeadSync] Error parsing row:', e);
    }
  }

  console.log(`[LeadSync] DOM Extracted ${leads.length} leads from ${rowEls.length} rows.`);
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
  // 1. Explicit CSS selectors
  for (const sel of NEXT_SELECTORS) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el && isVisible(el)) return el;
  }

  // 2. Pagination containers (e.g. "Page 1 >" or "Page 1 of 20")
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

  // 3. Global scan for clickable elements containing 'Next', '>', '›', '»'
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

// Memory getters/setters for content script
let _capturedLeads: Lead[] = [];
export function setCapturedLeads(leads: Lead[]): void { _capturedLeads = leads; }
export function getCapturedLeads(): Lead[] { return _capturedLeads; }
export function clearCapturedLeads(): void { _capturedLeads = []; }
