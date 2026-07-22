/**
 * leadmanager.ts
 *
 * Two-strategy lead extraction for seller.indiamart.com/messagecentre:
 *
 * Strategy A — API interception (PRIMARY, most reliable)
 *   The page injector (pageInjector.ts) captures IndiaMART's API responses
 *   and posts them via window.postMessage. This module stores them in memory
 *   so the bulk sync can drain them page by page.
 *
 * Strategy B — DOM phone-number walk (FALLBACK)
 *   Finds Indian phone numbers anywhere on the page, walks up the DOM to
 *   the containing row, then extracts sibling data. Works regardless of
 *   class names or markup changes.
 */

import type { Lead } from '@/types';

// ─── Shared lead store ────────────────────────────────────────────────────────
// Populated by the postMessage listener in index.ts.

let _capturedLeads: Lead[] = [];
let _onLeadsCaptured: ((leads: Lead[]) => void) | null = null;

export function setCapturedLeads(leads: Lead[]): void {
  _capturedLeads = leads;
  _onLeadsCaptured?.(leads);
}

export function getCapturedLeads(): Lead[] {
  return _capturedLeads;
}

export function clearCapturedLeads(): void {
  _capturedLeads = [];
}

export function onLeadsCaptured(cb: (leads: Lead[]) => void): void {
  _onLeadsCaptured = cb;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clean(text: string | null | undefined, max = 500): string | null {
  if (!text) return null;
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > max ? t.substring(0, max) : t || null;
}

const PHONE_RE = /(?:0|\+91|91)?[6-9]\d{9}/g;

function extractPhone(text: string): string | null {
  PHONE_RE.lastIndex = 0;
  const m = PHONE_RE.exec(text);
  return m ? m[0].replace(/[^\d]/g, '') : null;
}

// ─── Strategy B: DOM phone-number walk ───────────────────────────────────────

/**
 * Walk up the DOM from a text node to find the nearest table row (TR)
 * or a block-level container that likely represents one lead.
 */
function findRow(node: Node): Element | null {
  let el: Element | null = node.nodeType === Node.ELEMENT_NODE
    ? (node as Element)
    : node.parentElement;

  for (let i = 0; i < 15 && el; i++) {
    const tag = el.tagName?.toUpperCase();
    if (tag === 'TR') return el;
    // For div-based layouts, look for rows that are wide and contain enough data
    if (tag === 'DIV' || tag === 'LI') {
      const cells = el.querySelectorAll('td, th, [class*="col"], [class*="cell"]');
      if (cells.length >= 2) return el;
      // Large div with enough text content
      if ((el.textContent?.length ?? 0) > 40 &&
          el.children.length >= 2) return el;
    }
    el = el.parentElement;
  }
  return null;
}

/**
 * Given a row element, extract all meaningful text columns.
 * Returns an array of { text, el } tuples ordered by visual position.
 */
function getCells(row: Element): { text: string; el: Element }[] {
  // Prefer explicit TDs
  const tds = Array.from(row.querySelectorAll('td'));
  if (tds.length >= 2) {
    return tds.map((el) => ({ text: el.textContent?.trim() ?? '', el }));
  }
  // Div / span children
  const children = Array.from(row.children).filter((c) => {
    const t = (c.textContent ?? '').trim();
    return t.length > 0 && c.tagName !== 'INPUT' && c.tagName !== 'BUTTON';
  });
  return children.map((el) => ({ text: el.textContent?.trim() ?? '', el }));
}

export function extractLeadManagerPage(): Lead[] {
  const leads: Lead[] = [];
  const seenPhones = new Set<string>();

  // ── Walk all text nodes looking for phone numbers ─────────────────────────
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
  );

  let textNode: Node | null;
  while ((textNode = walker.nextNode()) !== null) {
    const text = textNode.textContent ?? '';
    PHONE_RE.lastIndex = 0;
    if (!PHONE_RE.test(text)) continue;

    const phone = extractPhone(text);
    if (!phone || seenPhones.has(phone)) continue;
    seenPhones.add(phone);

    const row = findRow(textNode);
    if (!row) continue;

    const cells = getCells(row);
    if (cells.length < 2) continue;

    // ── Extract fields from cells ──────────────────────────────────────────
    // The sender cell will contain both name and phone. Find it first.
    let buyerName: string | null = null;
    let mobile:    string | null = phone;
    let product:   string | null = null;
    let message:   string | null = null;
    let city:      string | null = null;
    let source:    string | null = null;
    let leadDate:  string | null = null;
    let labels:    string | null = null;

    // Heuristic: identify each cell by its content characteristics
    for (const { text: ct, el } of cells) {
      if (!ct) continue;

      // Phone-containing cell → sender
      PHONE_RE.lastIndex = 0;
      if (PHONE_RE.test(ct) && !buyerName) {
        // Extract name: text before/after the phone number
        PHONE_RE.lastIndex = 0;
        const name = ct.replace(PHONE_RE, '').replace(/\s+/g, ' ').trim();
        buyerName = clean(name.split('\n')[0]);
        continue;
      }

      // Short cell that matches source types
      if (/^(buylead|direct|other|catalog link|catalogue link)$/i.test(ct.trim())) {
        source = clean(ct); continue;
      }

      // Date-like cell
      if (/\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|\d{2}[\/\-]\d{2}[\/\-]\d{2,4}|\d{2}:\d{2}/i.test(ct)) {
        leadDate = leadDate ?? clean(ct); continue;
      }

      // Label-like cells (short, coloured, badge-like)
      if (el.querySelectorAll('[class*="badge"], [class*="label"], [class*="tag"]').length > 0) {
        labels = labels ?? clean(ct); continue;
      }

      // City: usually short (1-3 words), no numbers, comes after message
      if (!city && ct.length < 40 && /^[A-Za-z\s]+$/.test(ct.trim()) &&
          product && message) {
        city = clean(ct); continue;
      }

      // Long text → message preview
      if (!message && ct.length > 20 && (product || buyerName)) {
        message = clean(ct, 300); continue;
      }

      // Medium text → product / requirement
      if (!product && ct.length > 5 && ct.length < 200) {
        product = clean(ct); continue;
      }
    }

    // Only add if we have at least a phone or name
    if (!mobile && !buyerName) continue;

    // Try to get link for sourceUrl
    const anchor = row.querySelector<HTMLAnchorElement>('a[href]');

    leads.push({
      buyerName,
      company:     null,
      mobile,
      email:       null,
      product,
      quantity:    null,
      requirement: message,
      city,
      state:       null,
      budget:      null,
      source,
      leadDate,
      labels,
      sourceUrl:   anchor?.href ?? window.location.href,
    });
  }

  console.log(`[LeadSync] DOM fallback found ${leads.length} leads`);
  return leads;
}

// ─── Pagination ───────────────────────────────────────────────────────────────

const NEXT_BTN_SELECTORS = [
  'a[title="Next"]',
  'a[aria-label="Next"]',
  '.pagination .next:not(.disabled)',
  '.pagination li.next:not(.disabled) a',
  'li.next:not(.disabled) a',
  '.next-page:not(.disabled)',
  'button[aria-label="Next Page"]',
  'a.nextpg',
];

export function findNextButton(): HTMLElement | null {
  for (const sel of NEXT_BTN_SELECTORS) {
    const el = document.querySelector<HTMLElement>(sel);
    if (el) return el;
  }
  // Text-based fallback
  for (const el of document.querySelectorAll<HTMLElement>('a, button')) {
    const txt = (el.textContent ?? '').trim().toLowerCase();
    if ((txt === 'next' || txt === '›' || txt === '»' || txt === 'next >') &&
        !el.classList.contains('disabled') && !el.hasAttribute('disabled')) {
      return el;
    }
  }
  return null;
}

export function waitForPageChange(
  prevSignature: string,
  timeoutMs = 10_000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const sig = (document.querySelector('body')?.textContent ?? '').substring(0, 200);
      if (sig !== prevSignature) {
        observer.disconnect();
        resolve(true);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    setTimeout(() => { observer.disconnect(); resolve(false); }, timeoutMs);
  });
}

export function getPageSignature(): string {
  return (document.body?.textContent ?? '').substring(0, 200);
}
