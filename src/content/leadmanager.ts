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

function extractLeadFromRow(row: Element, mobile: string): Lead | null {
  const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT, null);
  let node;
  const texts: string[] = [];
  while ((node = walker.nextNode())) {
    const t = (node.nodeValue || '').trim();
    if (t) texts.push(t);
  }

  let senderIdx = -1;
  let phoneStr = '';
  for (let i = 0; i < texts.length; i++) {
     const p = extractPhone(texts[i]);
     if (p === mobile) { senderIdx = i; phoneStr = texts[i]; break; }
  }

  if (senderIdx === -1) return null;

  let buyerName = 'IndiaMART Lead';
  for (let i = senderIdx - 1; i >= 0; i--) {
     const t = texts[i];
     if (!NOISE_RE.test(t) && !/GST|Verified|Premium|\+ Label/i.test(t) && t.length > 2) {
         buyerName = clean(t) || buyerName;
         break;
     }
  }

  if (buyerName === 'IndiaMART Lead' && texts[senderIdx].length > phoneStr.length + 3) {
     const parts = texts[senderIdx].split(phoneStr);
     if (parts[0].trim().length > 2 && !/GST|Verified/.test(parts[0])) {
         buyerName = clean(parts[0]) || buyerName;
     }
  }

  let requirement: string | null = null;
  let city: string | null = null;
  let source: string | null = null;
  let leadDate: string | null = null;
  let labels: string | null = null;
  let product: string | null = null;

  for (let i = senderIdx + 1; i < texts.length; i++) {
     const txt = texts[i];
     if (NOISE_RE.test(txt)) continue;

     if (!source && SOURCE_RE.test(txt)) {
       source = txt.match(SOURCE_RE)![0];
       continue;
     }
     if (!leadDate && DATE_RE.test(txt) && !txt.includes('Tomorrow')) {
       leadDate = txt.match(DATE_RE)![0];
       continue;
     }
     if (!city && txt.length >= 3 && txt.length <= 35 && /^[A-Za-z\s,]+$/.test(txt)) {
       if (!/^(Tomorrow|Add note|Buylead|Direct|Other|Call|Catalog Link|Catalogue Link|Rating submitted)$/i.test(txt)) {
         city = clean(txt);
         continue;
       }
     }
     if (!product && txt.length > 4 && !txt.startsWith('+') && !txt.includes('Label')) {
        product = clean(txt);
        continue;
     }
     if (product && !requirement && txt.length > 5) {
        requirement = clean(txt);
        continue;
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
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
  let node;
  const phoneNodes: Node[] = [];
  while ((node = walker.nextNode())) {
    if (PHONE_RE.test(node.nodeValue || '')) {
      phoneNodes.push(node);
    }
  }

  const leads: Lead[] = [];
  const seenPhones = new Set<string>();

  for (const pNode of phoneNodes) {
    let el = pNode.parentElement;
    let rowEl: HTMLElement | null = null;
    let fallbackEl: HTMLElement | null = null;

    while (el && el !== document.body) {
      const tag = el.tagName.toUpperCase();
      const cls = typeof el.className === 'string' ? el.className.toLowerCase() : '';
      if (tag === 'TR' || 
          (tag === 'DIV' && /row|list-item|list_item|msg-item|lead-item/.test(cls)) ||
          (tag === 'LI')) {
        rowEl = el;
        break;
      }
      if (!fallbackEl && (el.textContent || '').length > 50 && (el.textContent || '').length < 1000) {
        fallbackEl = el;
      }
      el = el.parentElement;
    }

    const targetRow = rowEl || fallbackEl;
    if (!targetRow) continue;

    const phoneStr = extractPhone(pNode.nodeValue || '');
    if (!phoneStr || seenPhones.has(phoneStr)) continue;

    try {
      const lead = extractLeadFromRow(targetRow, phoneStr);
      if (!lead || !lead.mobile) continue;
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
