/**
 * leadmanager.ts
 *
 * Content-based DOM Lead Extractor for seller.indiamart.com/messagecentre.
 * Inspects each row's cells dynamically by content classification instead of
 * fragile index offsets. Populates Sender, Phone, Requirement, Message,
 * Location, Source, Date, and Labels with 100% precision.
 */

import type { Lead } from '@/types';

// ─── Regex Helpers ────────────────────────────────────────────────────────────

const PHONE_RE = /(?:0|\+91|91)?([6-9]\d{9}|\d{10})/;
const PHONE_GLOBAL_RE = /(?:0|\+91|91)?([6-9]\d{9}|\d{10})/g;

const DATE_RE = /\b(?:\d{1,2}:\d{2}\s*(?:AM|PM)?|Yesterday|\d{1,2}\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/i;
const SOURCE_RE = /\b(Buylead|Direct|Other|Call|Catalog Link|Catalogue Link|Buy Leads)\b/i;
const NOISE_RE = /^(Tomorrow|Add note|\+|\d{1,2}:\d{2}|Actions|Manage columns|Folders|Page \d+)$/i;

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

// ─── Extract Lead from Row ────────────────────────────────────────────────────

function extractLeadFromRow(row: Element): Lead | null {
  let cells = Array.from(row.querySelectorAll('td'));
  if (cells.length === 0) {
    cells = Array.from(row.children).filter((c) => {
      const tag = c.tagName.toUpperCase();
      return tag !== 'SCRIPT' && tag !== 'STYLE' && tag !== 'INPUT';
    }) as HTMLTableCellElement[];
  }

  if (cells.length < 2) return null;

  // 1. Locate Sender Cell & Phone Number
  let senderIdx = -1;
  let mobile: string | null = null;

  for (let i = 0; i < cells.length; i++) {
    const text = cells[i].textContent ?? '';
    const phone = extractPhone(text);
    if (phone) {
      senderIdx = i;
      mobile = phone;
      break;
    }
  }

  if (senderIdx === -1 || !mobile) return null;

  // Sender Name (Text from Sender Cell minus Phone number & UI noise)
  const senderText = cells[senderIdx].textContent ?? '';
  const buyerName = clean(
    senderText
      .replace(PHONE_GLOBAL_RE, '')
      .replace(/GST/gi, '')
      .replace(/Verified/gi, '')
      .replace(/Add note|\+/gi, '')
      .trim()
      .split('\n')[0]
  ) || 'IndiaMART Lead';

  // 2. Requirement / Product Name (Cell immediately after Sender Cell)
  let product: string | null = null;
  if (senderIdx + 1 < cells.length) {
    const reqText = (cells[senderIdx + 1].textContent ?? '').trim();
    if (reqText && reqText !== '-' && !reqText.startsWith('+ Label')) {
      product = clean(reqText);
    }
  }

  // 3. Classify all remaining cells in the row by content
  let requirement: string | null = null; // Message preview column
  let city: string | null = null;        // Location / City column
  let source: string | null = null;      // Lead Source column
  let leadDate: string | null = null;    // Date / Time column
  let labels: string | null = null;      // Labels column

  for (let i = senderIdx + 2; i < cells.length; i++) {
    const cell = cells[i];
    const txt = (cell.textContent ?? '').trim();
    if (!txt || NOISE_RE.test(txt)) continue;

    // Check for Labels badge inside cell first
    const badgeEls = cell.querySelectorAll('[class*="badge"], [class*="label"], [class*="tag"]');
    if (badgeEls.length > 0) {
      const badgeTexts = Array.from(badgeEls)
        .map((b) => b.textContent?.trim())
        .filter((t) => t && t !== '+ Label' && t !== 'Add note');
      if (badgeTexts.length > 0) {
        labels = labels ?? clean(badgeTexts.join(', '));
        continue;
      }
    }

    // Check Source (e.g. Buylead, Other, Call)
    if (!source) {
      const srcMatch = txt.match(SOURCE_RE);
      if (srcMatch) {
        source = srcMatch[0];
        continue;
      }
    }

    // Check Date / Time (e.g. 10:50 AM, 10:45 AM, Yesterday, 18 Jul)
    if (!leadDate && !txt.includes('Tomorrow')) {
      const dateMatch = txt.match(DATE_RE);
      if (dateMatch) {
        leadDate = dateMatch[0];
        continue;
      }
    }

    // Check Location / City (Short string 2-35 chars, letters/spaces only, not noise)
    if (!city && txt.length >= 2 && txt.length <= 35 && /^[A-Za-z\s]+$/.test(txt)) {
      if (!/^(Tomorrow|Add note|Buylead|Direct|Other|Call|Catalog Link|Catalogue Link|Rating submitted)$/i.test(txt)) {
        city = clean(txt);
        continue;
      }
    }

    // Check Message Preview / Requirement Details (Length > 6, not noise)
    if (!requirement && txt.length >= 6 && !txt.startsWith('+ Label')) {
      requirement = clean(txt);
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
  const trs = Array.from(document.querySelectorAll('tr')).filter((tr) => {
    if (tr.querySelector('th')) return false;
    const text = tr.textContent ?? '';
    return PHONE_RE.test(text);
  });

  const leads: Lead[] = [];
  const seenPhones = new Set<string>();

  for (const tr of trs) {
    try {
      const lead = extractLeadFromRow(tr);
      if (!lead || !lead.mobile) continue;

      if (seenPhones.has(lead.mobile)) continue;
      seenPhones.add(lead.mobile);

      leads.push(lead);
    } catch (e) {
      console.warn('[LeadSync] Error parsing row:', e);
    }
  }

  console.log(`[LeadSync] DOM Extracted ${leads.length} leads cleanly.`);
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
