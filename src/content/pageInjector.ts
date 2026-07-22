/**
 * pageInjector.ts
 *
 * Injects into the PAGE's MAIN world to intercept fetch() + XHR.
 * Captures ANY JSON response that contains an array of lead-like objects.
 * No URL filtering — IndiaMART's API URL may vary; we detect by content.
 */

const INJECTOR_CODE = /* javascript */ `
(function () {
  if (window.__leadsyncInjected) return;
  window.__leadsyncInjected = true;

  var KNOWN_NAME_FIELDS   = ['glusr_cntct_nm','contact_name','name','sender_name','cntct_nm','buyer_name','cname','ContactName'];
  var KNOWN_MOBILE_FIELDS = ['cntct_mob','mobile','phone','contact_mobile','mob','Mobile','ContactMobile','mobileNo'];
  var KNOWN_PROD_FIELDS   = ['prod_desc','product','requirement','req','prd_desc','Product','Requirement','prodDesc'];
  var KNOWN_MSG_FIELDS    = ['msg','message','last_msg','lastMessage','inq_msg','query','Msg','Message'];
  var KNOWN_CITY_FIELDS   = ['glusr_city_nm','city','location','city_nm','City','Location'];
  var KNOWN_SRC_FIELDS    = ['src_type','source','lead_source','srctype','lsrc','Source','LeadSource'];
  var KNOWN_DATE_FIELDS   = ['msgdt','date','created_at','dt','msg_dt','lead_date','Date','LeadDate','adddt'];
  var KNOWN_LABEL_FIELDS  = ['label_nm','labels','label','tag','Labels','Label'];

  function first(obj, fields) {
    for (var i = 0; i < fields.length; i++) {
      var v = obj[fields[i]];
      if (v !== null && v !== undefined && String(v).trim()) return String(v).trim();
    }
    // fallback: scan all keys case-insensitively
    var keys = Object.keys(obj);
    for (var j = 0; j < fields.length; j++) {
      var f = fields[j].toLowerCase();
      for (var k = 0; k < keys.length; k++) {
        if (keys[k].toLowerCase() === f && obj[keys[k]] !== null && obj[keys[k]] !== undefined) {
          return String(obj[keys[k]]).trim() || null;
        }
      }
    }
    return null;
  }

  function looksLikeLead(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
    var keys = Object.keys(obj);
    var hasName   = keys.some(function(k){ return /name|nm|cntct|sender/i.test(k); });
    var hasMobile = keys.some(function(k){ return /mob|phone|contact|cntct/i.test(k); });
    return hasName || hasMobile;
  }

  function parseLead(obj) {
    return {
      buyerName:   first(obj, KNOWN_NAME_FIELDS),
      mobile:      first(obj, KNOWN_MOBILE_FIELDS),
      product:     first(obj, KNOWN_PROD_FIELDS),
      requirement: first(obj, KNOWN_MSG_FIELDS),
      city:        first(obj, KNOWN_CITY_FIELDS),
      source:      first(obj, KNOWN_SRC_FIELDS),
      leadDate:    first(obj, KNOWN_DATE_FIELDS),
      labels:      first(obj, KNOWN_LABEL_FIELDS),
      quantity:    first(obj, ['qty','quantity']),
      company:     first(obj, ['glusr_cmpny_nm','company','Company']),
      email:       first(obj, ['email','cntct_email','Email']),
      state:       first(obj, ['state','glusr_state_nm','State']),
      budget:      null,
      sourceUrl:   window.location.href,
    };
  }

  function tryExtract(data) {
    if (!data) return null;

    var candidates = [
      data, data.data, data.DATA, data.result, data.results,
      data.response, data.RESPONSE, data.contacts, data.Contacts,
      data.leads, data.Leads, data.rows, data.list, data.items,
      data.records, data.Contact, data.payload, data.body,
    ].filter(function(x){ return x != null; });

    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];

      // Direct array of lead objects
      if (Array.isArray(c) && c.length > 0 && looksLikeLead(c[0])) {
        var parsed = c.map(parseLead).filter(function(l){ return l.buyerName || l.mobile; });
        if (parsed.length > 0) return parsed;
      }

      // Nested: { "0":{...}, "1":{...} } style
      if (c && typeof c === 'object' && !Array.isArray(c)) {
        var vals = Object.values(c);
        if (vals.length >= 5 && looksLikeLead(vals[0])) {
          var parsed2 = vals.map(parseLead).filter(function(l){ return l.buyerName || l.mobile; });
          if (parsed2.length > 0) return parsed2;
        }
      }
    }
    return null;
  }

  function handleResponse(url, data) {
    var leads = tryExtract(data);
    if (!leads || leads.length === 0) return;

    console.log('[LeadSync] Captured', leads.length, 'leads from:', url);
    window.postMessage({ type: 'LEADSYNC_API_LEADS', leads: leads, url: url }, '*');
  }

  function safeParse(text) {
    if (!text) return null;
    var t = text.trimStart();
    if (t[0] !== '{' && t[0] !== '[') return null;
    try { return JSON.parse(text); } catch(e) { return null; }
  }

  // ── Intercept fetch ──────────────────────────────────────────────────────
  var origFetch = window.fetch;
  window.fetch = function() {
    var url = '';
    if (typeof arguments[0] === 'string') url = arguments[0];
    else if (arguments[0] && arguments[0].url) url = arguments[0].url;

    return origFetch.apply(this, arguments).then(function(resp) {
      var contentType = resp.headers ? resp.headers.get('content-type') || '' : '';
      if (contentType.indexOf('json') !== -1 || url.indexOf('.json') !== -1) {
        resp.clone().text().then(function(text) {
          var data = safeParse(text);
          if (data) handleResponse(url, data);
        }).catch(function(){});
      }
      return resp;
    });
  };

  // ── Intercept XHR ────────────────────────────────────────────────────────
  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url) {
    this._lsUrl = url;
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function() {
    var xhr = this;
    xhr.addEventListener('load', function() {
      if (xhr.status < 200 || xhr.status >= 300) return;
      var ct = xhr.getResponseHeader ? xhr.getResponseHeader('Content-Type') || '' : '';
      var isJson = ct.indexOf('json') !== -1 || (xhr._lsUrl && xhr._lsUrl.indexOf('.json') !== -1);
      if (!isJson) {
        var text = xhr.responseText || '';
        var t = text.trimStart();
        if (t[0] !== '{' && t[0] !== '[') return;
      }
      var data = safeParse(xhr.responseText);
      if (data) handleResponse(xhr._lsUrl || '', data);
    });
    return origSend.apply(this, arguments);
  };

  console.log('[LeadSync] API interceptor ready');
})();
`;

export function injectInterceptor(): void {
  if (document.querySelector('[data-leadsync-injected]')) return;
  const script = document.createElement('script');
  script.setAttribute('data-leadsync-injected', 'true');
  script.textContent = INJECTOR_CODE;
  (document.head ?? document.documentElement).appendChild(script);
  script.remove();
}

/**
 * Trigger IndiaMART to re-issue its lead list API call.
 * Clicks the "All" contacts tab which forces a data refresh.
 */
export function triggerLeadRefresh(): void {
  // Click "All" tab to reload current page's leads
  const allTab = Array.from(document.querySelectorAll<HTMLElement>('a, button, li span, div'))
    .find((el) => {
      const txt = (el.textContent ?? '').trim();
      return /^all$/i.test(txt) || /^all contacts$/i.test(txt);
    });

  if (allTab) {
    allTab.click();
    return;
  }

  // Fallback: click any active filter tab to re-trigger the current query
  const activeTab = document.querySelector<HTMLElement>('.active a, a.active, .selected a, li.active');
  if (activeTab) activeTab.click();
}
