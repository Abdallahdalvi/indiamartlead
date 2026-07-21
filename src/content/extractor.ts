/**
 * IndiaMART lead extractor.
 *
 * Multi-strategy extraction to handle IndiaMART's varied page layouts:
 *   - /messagebox/    (Buyer Requirement Messages inbox)
 *   - /buy-lead/      (Individual lead detail pages)
 *   - /leadmanager/   (Lead management dashboard)
 *   - seller.indiamart.com (Seller portal)
 *   - my.indiamart.com     (Buyer-central dashboard)
 *
 * Strategy chain (applied in order until a value is found):
 *   1. CSS selector list (specific → generic)
 *   2. Label-based text scanning (looks for "Mobile:", "Email:" etc.)
 *   3. Regex on visible text
 *   4. JSON-LD structured data
 *   5. Meta tags
 */

import type { Lead } from '@/types';

// ─── Selector Lists ───────────────────────────────────────────────────────────
// Ordered most-specific → most-generic. First match wins.

const SELECTORS = {
  buyerName: [
    '.buyer-name', '.buyerName', '.bname', '.sender-name', '.from-name',
    '[data-field="buyer_name"]', '[data-testid="buyer-name"]',
    '.cnt-detail .name', '.lead-detail .buyer', '.enquiry-buyer-name',
    '.buyRqrmnt .name', '.seller-lead-buyer',
    '[class*="buyerName"]', '[class*="buyer_name"]', '[class*="BuyerName"]',
    'h2.name', 'h3.name', 'h1.name',
  ],
  company: [
    '.company-name', '.companyName', '.company', '.org-name', '.buyer-company',
    '[data-field="company"]', '[data-testid="company-name"]',
    '.cnt-detail .org', '.from-company',
    '[class*="companyName"]', '[class*="company_name"]', '[class*="Company"]',
    '.company.buyer',
  ],
  mobile: [
    '.mobile-number', '.mobNum', '.mob-no', '.phone', '.contact-mobile',
    '[data-field="mobile"]', '[data-testid="mobile"]',
    'a[href^="tel:"]',
    '[class*="mobile"]', '[class*="Mobile"]', '[class*="phone"]', '[class*="Phone"]',
    '.cnt-detail .mob', '.buyer-mobile', '.phone-number',
  ],
  email: [
    '.email-id', '.emailId', '.email', '.buyer-email',
    '[data-field="email"]', '[data-testid="email"]',
    'a[href^="mailto:"]',
    '[class*="email"]', '[class*="Email"]',
    '.cnt-detail .email',
  ],
  product: [
    '.product-name', '.productName', '.prd-name', '.prdName', '.item-name',
    '[data-field="product"]', '[data-testid="product-name"]',
    '.requirement-product', '.lead-product', '.enquiry-product',
    '.buyRqrmnt .prd',
    '[class*="productName"]', '[class*="product_name"]', '[class*="ProductName"]',
    'h1.product', 'h2.product', 'h1.prd', 'h2.prd',
  ],
  quantity: [
    '.quantity', '.qty', '.req-qty',
    '[data-field="quantity"]',
    '[class*="quantity"]', '[class*="Quantity"]', '[class*="qty"]',
    '.lead-quantity', '.req-quantity',
  ],
  budget: [
    '.budget', '.price-range', '.expected-price', '.req-budget',
    '[data-field="budget"]',
    '[class*="budget"]', '[class*="Budget"]', '[class*="price"]',
    '.lead-budget',
  ],
  requirement: [
    '.requirement-detail', '.reqDetail', '.req-detail', '.description',
    '.lead-description', '.enquiry-message', '.message-body', '.req-text',
    '[data-field="requirement"]', '[data-testid="requirement"]',
    '.buyRqrmnt .desc', '.note', '.lead-note',
    '[class*="requirement"]', '[class*="Requirement"]', '[class*="description"]',
    'p.description', 'div.description',
  ],
  city: [
    '.city', '.addr-city', '.buyer-city',
    '[data-field="city"]',
    '[class*="city"]', '[class*="City"]',
    '.location .city',
  ],
  state: [
    '.state', '.addr-state', '.buyer-state',
    '[data-field="state"]',
    '[class*="state"]', '[class*="State"]',
    '.location .state',
  ],
  leadDate: [
    'time[datetime]', 'time',
    '.lead-date', '.date', '.posted-date', '.postedDate', '.enquiry-date',
    '[data-field="date"]', '[data-testid="lead-date"]',
    '[class*="date"]', '[class*="Date"]',
    '.created-at', '.lead-time',
  ],
  location: [
    '.location', '.lcation', '.addr', '.address', '.place',
    '.from-location', '.buyer-location',
    '[class*="location"]', '[class*="Location"]', '[class*="address"]',
  ],
} as const;

// ─── Selector Query ───────────────────────────────────────────────────────────

/**
 * Try each selector in order, return the first non-empty text.
 * Special handling for <a href="tel:"> and <a href="mailto:"> and <time>.
 */
function queryText(
  selectors: readonly string[],
  root: Element | Document = document,
): string | null {
  for (const sel of selectors) {
    try {
      const el = root.querySelector(sel);
      if (!el) continue;

      // tel: links
      if (el.tagName === 'A') {
        const href = (el as HTMLAnchorElement).href;
        if (href.startsWith('tel:'))     return href.replace('tel:', '').trim() || null;
        if (href.startsWith('mailto:'))  return href.replace('mailto:', '').split('?')[0].trim() || null;
      }

      // <time datetime="…">
      if (el.tagName === 'TIME') {
        const dt = el.getAttribute('datetime');
        if (dt) return dt;
      }

      const text = el.textContent?.trim();
      if (text && text.length > 0) return text;
    } catch {
      continue;
    }
  }
  return null;
}

// ─── Phone Helpers ────────────────────────────────────────────────────────────

const PHONE_RE = /(?:\+91[-\s]?|0)?[6-9]\d{9}/g;

function extractPhone(text: string): string | null {
  const match = text.match(PHONE_RE);
  return match ? match[0].replace(/[\s-]/g, '') : null;
}

function extractPhoneByLabel(): string | null {
  const labels = ['mobile', 'phone', 'contact', 'mob', 'tel'];
  // Search all text nodes for "Mobile: 98XXXXXX" patterns
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const text = node.textContent ?? '';
    const lower = text.toLowerCase();
    for (const lbl of labels) {
      if (lower.includes(lbl) && lower.includes(':')) {
        const phone = extractPhone(text);
        if (phone) return phone;
      }
    }
  }
  return null;
}

// ─── Email Helper ─────────────────────────────────────────────────────────────

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;

function extractEmailFromText(text: string): string | null {
  const match = text.match(EMAIL_RE);
  return match ? match[0] : null;
}

// ─── Location Parser ──────────────────────────────────────────────────────────

function extractLocation(root: Element | Document = document): {
  city: string | null;
  state: string | null;
} {
  // Try combined location field first (e.g. "Mumbai, Maharashtra")
  for (const sel of SELECTORS.location) {
    const el = root.querySelector(sel);
    if (!el?.textContent?.trim()) continue;
    const text  = el.textContent.trim();
    const parts = text.split(/[,\-\/]/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return { city: parts[0] ?? null, state: parts[1] ?? null };
    }
    if (parts.length === 1) {
      return { city: parts[0], state: null };
    }
  }

  // Fallback: separate city / state selectors
  return {
    city:  queryText(SELECTORS.city,  root),
    state: queryText(SELECTORS.state, root),
  };
}

// ─── JSON-LD Structured Data ──────────────────────────────────────────────────

function extractFromJsonLd(): Partial<Lead> {
  const scripts = document.querySelectorAll<HTMLScriptElement>(
    'script[type="application/ld+json"]'
  );
  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent ?? '') as Record<string, unknown>;
      if (data && typeof data === 'object') {
        return {
          buyerName:   (data['name'] as string | undefined)          ?? null,
          company:     (data['organization'] as string | undefined)  ?? null,
          mobile:      (data['telephone'] as string | undefined)     ?? null,
          email:       (data['email'] as string | undefined)         ?? null,
          product:     (data['product'] as string | undefined)       ?? null,
          requirement: (data['description'] as string | undefined)   ?? null,
        };
      }
    } catch {
      continue;
    }
  }
  return {};
}

// ─── Public: extract single lead ─────────────────────────────────────────────

/**
 * Extract all lead fields from the current IndiaMART page.
 * Returns null if no meaningful data could be found.
 */
export function extractLead(): Lead | null {
  if (!window.location.href.includes('indiamart.com')) return null;

  try {
    const jld = extractFromJsonLd();
    const loc = extractLocation();

    const buyerName   = queryText(SELECTORS.buyerName)   ?? jld.buyerName   ?? null;
    const company     = queryText(SELECTORS.company)     ?? jld.company     ?? null;
    const product     = queryText(SELECTORS.product)     ?? jld.product     ?? null;
    const requirement = queryText(SELECTORS.requirement) ?? jld.requirement ?? null;
    const quantity    = queryText(SELECTORS.quantity)    ?? null;
    const budget      = queryText(SELECTORS.budget)      ?? null;
    const leadDate    = queryText(SELECTORS.leadDate)    ?? null;

    // Mobile: selector → label scan → regex on full body text → JSON-LD
    let mobile = queryText(SELECTORS.mobile) ?? null;
    if (!mobile) mobile = extractPhoneByLabel();
    if (!mobile) mobile = extractPhone(document.body.innerText ?? '');
    if (!mobile) mobile = jld.mobile ?? null;

    // Email: selector → regex on full body text → JSON-LD
    let email = queryText(SELECTORS.email) ?? null;
    if (!email) email = extractEmailFromText(document.body.innerText ?? '');
    if (!email) email = jld.email ?? null;

    // Require at least one meaningful field
    if (!buyerName && !mobile && !email && !product && !requirement) return null;

    return {
      buyerName:   cap(buyerName,   200),
      company:     cap(company,     200),
      mobile:      mobile ? mobile.replace(/\s+/g, '').substring(0, 20) : null,
      email:       cap(email,       200),
      product:     cap(product,     300),
      quantity:    cap(quantity,    100),
      budget:      cap(budget,      100),
      requirement: cap(requirement, 1000),
      city:        cap(loc.city,    100),
      state:       cap(loc.state,   100),
      leadDate:    cap(leadDate,    100),
      sourceUrl:   window.location.href,
    };
  } catch (err) {
    console.error('[LeadSync] extractLead error:', err);
    return null;
  }
}

// ─── Public: extract all visible leads on a list page ────────────────────────

const LIST_CONTAINER_SELECTORS = [
  '.lead-item', '.lead-card', '.enquiry-item', '.message-item',
  '.buyRqrmntCls', '.lead-row', '.requirement-item',
  '[class*="leadItem"]', '[class*="lead-item"]',
  '[class*="enquiry-item"]', '[class*="LeadItem"]',
  'tr.lead', 'li.lead',
];

/**
 * Extract all lead cards visible on a list / dashboard page.
 * Falls back to extractLead() (single lead) if no list containers are found.
 */
export function extractAllVisibleLeads(): Lead[] {
  let containers: NodeListOf<Element> | null = null;

  for (const sel of LIST_CONTAINER_SELECTORS) {
    const els = document.querySelectorAll<Element>(sel);
    if (els.length > 0) { containers = els; break; }
  }

  if (!containers) {
    const single = extractLead();
    return single ? [single] : [];
  }

  const leads: Lead[] = [];

  for (const container of containers) {
    try {
      const loc  = extractLocation(container);
      const name = queryText(SELECTORS.buyerName, container);
      const mob  = queryText(SELECTORS.mobile,    container) ??
                   extractPhone(container.textContent ?? '');
      const mail = queryText(SELECTORS.email,     container) ??
                   extractEmailFromText(container.textContent ?? '');
      const prod = queryText(SELECTORS.product,   container);

      if (!name && !mob && !mail && !prod) continue;

      // Try to find the detail-page link inside the container
      const anchor     = container.querySelector<HTMLAnchorElement>('a[href*="indiamart"]');
      const sourceUrl  = anchor?.href ?? window.location.href;

      leads.push({
        buyerName:   cap(name,                                             200),
        company:     cap(queryText(SELECTORS.company,     container),     200),
        mobile:      mob ? mob.replace(/\s+/g, '').substring(0, 20)          : null,
        email:       cap(mail,                                             200),
        product:     cap(prod,                                             300),
        quantity:    cap(queryText(SELECTORS.quantity,    container),     100),
        budget:      cap(queryText(SELECTORS.budget,      container),     100),
        requirement: cap(queryText(SELECTORS.requirement, container),    1000),
        city:        cap(loc.city,                                         100),
        state:       cap(loc.state,                                        100),
        leadDate:    cap(queryText(SELECTORS.leadDate,    container),     100),
        sourceUrl,
      });
    } catch {
      continue;
    }
  }

  return leads;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Cap a nullable string to maxLen characters. */
function cap(value: string | null | undefined, maxLen: number): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > maxLen ? trimmed.substring(0, maxLen) : trimmed || null;
}
