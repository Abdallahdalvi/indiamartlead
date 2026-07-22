/**
 * pageInjector.ts
 *
 * Injects a small script into the PAGE's main world (not the isolated content
 * script world) so it can intercept fetch() and XMLHttpRequest before
 * IndiaMART's own code sends them.
 *
 * Captured lead payloads are relayed to the content script via
 * window.postMessage({ type: 'LEADSYNC_API_LEADS', leads: [...] }).
 */

const INJECTOR_CODE = /* javascript */ `
(function () {
  if (window.__leadsyncInjected) return;
  window.__leadsyncInjected = true;

  // ── Field name maps for IndiaMART's JSON ──────────────────────────────────
  // IndiaMART uses abbreviated field names in their API responses.
  // We try both their internal names AND generic equivalents.

  function str(v) {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s || null;
  }

  function parseSingleLead(obj) {
    if (!obj || typeof obj !== 'object') return null;
    const k = Object.keys(obj);
    // Must have something that looks like a name or phone
    const hasData = k.some(function(key) {
      return key.match(/name|nm|mob|phone|contact|cntct/i);
    });
    if (!hasData) return null;

    return {
      buyerName:   str(obj.glusr_cntct_nm) || str(obj.contact_name) || str(obj.name) ||
                   str(obj.sender_name)     || str(obj.cntct_nm)     || str(obj.buyer_name),
      mobile:      str(obj.cntct_mob)  || str(obj.mobile)  || str(obj.phone) ||
                   str(obj.contact_mobile) || str(obj.mob),
      product:     str(obj.prod_desc)  || str(obj.product) || str(obj.requirement) ||
                   str(obj.req)        || str(obj.prd_desc),
      requirement: str(obj.msg)        || str(obj.message) || str(obj.last_msg)    ||
                   str(obj.lastMessage)|| str(obj.inq_msg) || str(obj.query),
      city:        str(obj.glusr_city_nm) || str(obj.city) || str(obj.location)    ||
                   str(obj.city_nm),
      source:      str(obj.src_type)   || str(obj.source)  || str(obj.lead_source) ||
                   str(obj.srctype)    || str(obj.lsrc),
      leadDate:    str(obj.msgdt)      || str(obj.date)    || str(obj.created_at)  ||
                   str(obj.dt)         || str(obj.msg_dt)  || str(obj.lead_date),
      labels:      str(obj.label_nm)   || str(obj.labels)  || str(obj.label)       ||
                   str(obj.tag),
      quantity:    str(obj.qty)        || str(obj.quantity),
      company:     str(obj.glusr_cmpny_nm) || str(obj.company),
      email:       str(obj.email)      || str(obj.cntct_email),
      state:       str(obj.state)      || str(obj.glusr_state_nm),
      budget:      null,
      sourceUrl:   window.location.href,
    };
  }

  function tryExtractLeads(data) {
    if (!data || typeof data !== 'object') return null;

    // Candidates to check for lead arrays
    const sources = [
      data,
      data.data,
      data.DATA,
      data.result,
      data.results,
      data.response,
      data.contacts,
      data.leads,
      data.rows,
      data.list,
      data.items,
      data.records,
      data.Contact,
      data.Contacts,
    ];

    for (let i = 0; i < sources.length; i++) {
      const src = sources[i];
      if (!src) continue;

      if (Array.isArray(src) && src.length > 0) {
        const leads = src.map(parseSingleLead).filter(Boolean);
        if (leads.length > 0) return leads;
      }

      // Sometimes it's { '0': {...}, '1': {...} }
      if (typeof src === 'object' && !Array.isArray(src)) {
        const vals = Object.values(src);
        if (vals.length > 0 && typeof vals[0] === 'object' && vals[0] !== null) {
          const leads = vals.map(parseSingleLead).filter(Boolean);
          if (leads.length > 5) return leads; // at least 5 to avoid false positives
        }
      }
    }
    return null;
  }

  function handleData(url, data) {
    // Only care about indiamart URLs
    if (!url) return;
    const u = String(url).toLowerCase();
    const relevant = u.includes('messagecentre') || u.includes('msgcntr') ||
                     u.includes('contact')       || u.includes('getall')  ||
                     u.includes('lead')          || u.includes('seller');
    if (!relevant) return;

    const leads = tryExtractLeads(data);
    if (leads && leads.length > 0) {
      console.log('[LeadSync] Captured', leads.length, 'leads from API:', url);
      window.postMessage({ type: 'LEADSYNC_API_LEADS', leads: leads, url: url }, '*');
    }
  }

  // ── Intercept fetch ────────────────────────────────────────────────────────
  var origFetch = window.fetch;
  window.fetch = function() {
    var url = (typeof arguments[0] === 'string') ? arguments[0]
            : (arguments[0] && arguments[0].url) ? arguments[0].url : '';
    return origFetch.apply(this, arguments).then(function(resp) {
      resp.clone().text().then(function(text) {
        try {
          if (text && (text.trimStart()[0] === '{' || text.trimStart()[0] === '[')) {
            handleData(url, JSON.parse(text));
          }
        } catch(e) {}
      }).catch(function() {});
      return resp;
    });
  };

  // ── Intercept XHR ─────────────────────────────────────────────────────────
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url) {
    this._lsUrl = url;
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function() {
    var xhr = this;
    xhr.addEventListener('load', function() {
      if (xhr.status >= 200 && xhr.status < 300 && xhr._lsUrl) {
        try {
          var text = xhr.responseText;
          if (text && (text.trimStart()[0] === '{' || text.trimStart()[0] === '[')) {
            handleData(xhr._lsUrl, JSON.parse(text));
          }
        } catch(e) {}
      }
    });
    return origSend.apply(this, arguments);
  };

  console.log('[LeadSync] Interceptor ready on', window.location.href);
})();
`;

export function injectInterceptor(): void {
  // Only inject once
  if (document.querySelector('[data-leadsync-injected]')) return;

  const script = document.createElement('script');
  script.setAttribute('data-leadsync-injected', 'true');
  script.textContent = INJECTOR_CODE;
  (document.head ?? document.documentElement).appendChild(script);
  script.remove(); // Remove the element but the code has already run
}

/**
 * Trigger IndiaMART to re-fetch its lead list by simulating a tab click.
 * This forces the page to make a fresh API call which our interceptor captures.
 */
export function triggerLeadRefresh(): void {
  // Try clicking the "All" contacts tab
  const allTabSelectors = [
    'a[data-filter="all"]',
    '.tab-all', '.all-tab', '[data-tab="all"]',
    '.filter-tab:first-child', '.contacts-tab:first-child',
    'li.active a', '.tab.active',
    // Text-based
    'a, button, li',
  ];

  for (const sel of allTabSelectors) {
    if (!sel.includes(', ')) {
      const el = document.querySelector<HTMLElement>(sel);
      if (el) { el.click(); return; }
      continue;
    }
    // Text-based: find "All" tab
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(sel));
    for (const c of candidates) {
      const txt = (c.textContent ?? '').trim();
      if (/^all$/i.test(txt) || /^all contacts$/i.test(txt)) {
        c.click();
        return;
      }
    }
  }

  // Last resort: reload the page (will re-trigger API calls)
  console.log('[LeadSync] Could not find refresh trigger, data will be captured on next navigation.');
}
