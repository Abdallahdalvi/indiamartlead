/**
 * pageInjector.ts
 *
 * IMPORTANT: IndiaMART uses a strict CSP that blocks inline <script> injection.
 * Instead, we export a standalone function that the BACKGROUND worker injects
 * via chrome.scripting.executeScript({ world: 'MAIN' }) — this is CSP-safe
 * because Chrome injects it natively, not as an inline script.
 *
 * The function must be 100% self-contained (no outer scope references)
 * because chrome.scripting serializes it with .toString().
 */

/**
 * This function runs in the PAGE'S MAIN WORLD (not the content script isolated
 * world). It patches window.fetch and XMLHttpRequest, captures JSON responses
 * that look like lead data, and relays them to the content script via
 * window.postMessage.
 *
 * DO NOT reference any variables outside this function — it runs in isolation.
 */
export function leadsyncInterceptorMain(): void {
  const win = window as Window & { __leadsyncInjected?: boolean };
  if (win.__leadsyncInjected) return;
  win.__leadsyncInjected = true;

  const NAME_FIELDS   = ['glusr_cntct_nm','contact_name','name','sender_name','cntct_nm','buyer_name','cname','ContactName','CONTACT_NAME'];
  const MOBILE_FIELDS = ['cntct_mob','mobile','phone','contact_mobile','mob','Mobile','ContactMobile','mobileNo','MOBILE','contact_mobile_enc'];
  const PROD_FIELDS   = ['prod_desc','product','requirement','req','prd_desc','Product','Requirement','prodDesc','PROD_DESC'];
  const MSG_FIELDS    = ['msg','message','last_msg','lastMessage','inq_msg','query','Msg','Message','MSG','last_message','LAST_MSG'];
  const CITY_FIELDS   = ['glusr_city_nm','city','location','city_nm','City','Location','CITY'];
  const SRC_FIELDS    = ['src_type','source','lead_source','srctype','lsrc','Source','LeadSource','SRC_TYPE','SOURCE'];
  const DATE_FIELDS   = ['msgdt','date','created_at','dt','msg_dt','lead_date','Date','LeadDate','adddt','MSGDT','DATE','msg_date'];
  const LABEL_FIELDS  = ['label_nm','labels','label','tag','Labels','Label','LABEL'];

  function getField(obj: Record<string, unknown>, fields: string[]): string | null {
    for (const f of fields) {
      const v = obj[f];
      if (v !== null && v !== undefined) {
        const s = String(v).trim();
        if (s) return s;
      }
    }
    // Case-insensitive scan
    const keys = Object.keys(obj);
    for (const f of fields) {
      const fl = f.toLowerCase();
      for (const k of keys) {
        if (k.toLowerCase() === fl && obj[k] != null) {
          const s = String(obj[k]).trim();
          if (s) return s;
        }
      }
    }
    return null;
  }

  function isLead(obj: unknown): boolean {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
    const keys = Object.keys(obj as object);
    return keys.some((k) => /name|nm|cntct|sender|mob|phone|contact/i.test(k));
  }

  function parseLead(obj: Record<string, unknown>) {
    return {
      buyerName:   getField(obj, NAME_FIELDS),
      mobile:      getField(obj, MOBILE_FIELDS),
      product:     getField(obj, PROD_FIELDS),
      requirement: getField(obj, MSG_FIELDS),
      city:        getField(obj, CITY_FIELDS),
      source:      getField(obj, SRC_FIELDS),
      leadDate:    getField(obj, DATE_FIELDS),
      labels:      getField(obj, LABEL_FIELDS),
      quantity:    getField(obj, ['qty', 'quantity', 'QTY']),
      company:     getField(obj, ['glusr_cmpny_nm', 'company', 'Company', 'COMPANY']),
      email:       getField(obj, ['email', 'cntct_email', 'Email', 'EMAIL']),
      state:       getField(obj, ['state', 'glusr_state_nm', 'State', 'STATE']),
      budget:      null as null,
      sourceUrl:   window.location.href,
    };
  }

  function extractLeads(data: unknown): ReturnType<typeof parseLead>[] | null {
    if (!data || typeof data !== 'object') return null;

    const d = data as Record<string, unknown>;
    const candidates = [
      data, d['data'], d['DATA'], d['result'], d['results'],
      d['response'], d['RESPONSE'], d['contacts'], d['Contacts'],
      d['leads'], d['Leads'], d['rows'], d['list'], d['items'],
      d['records'], d['Contact'], d['payload'], d['body'],
      d['contact_list'], d['contactList'], d['lead_list'],
    ].filter((x) => x != null);

    for (const c of candidates) {
      if (Array.isArray(c) && c.length > 0 && isLead(c[0])) {
        const leads = (c as Record<string, unknown>[])
          .map(parseLead)
          .filter((l) => l.buyerName || l.mobile);
        if (leads.length > 0) return leads;
      }

      if (c && typeof c === 'object' && !Array.isArray(c)) {
        const vals = Object.values(c as object);
        if (vals.length >= 3 && isLead(vals[0])) {
          const leads = (vals as Record<string, unknown>[])
            .map(parseLead)
            .filter((l) => l.buyerName || l.mobile);
          if (leads.length > 0) return leads;
        }
      }
    }
    return null;
  }

  function handleData(url: string, data: unknown): void {
    const leads = extractLeads(data);
    if (!leads || leads.length === 0) return;
    console.log('[LeadSync] Captured', leads.length, 'leads from:', url);
    window.postMessage({ type: 'LEADSYNC_API_LEADS', leads, url }, '*');
  }

  function safeParse(text: string): unknown {
    if (!text) return null;
    const t = text.trimStart();
    if (t[0] !== '{' && t[0] !== '[') return null;
    try { return JSON.parse(text); } catch { return null; }
  }

  // ── Patch fetch ────────────────────────────────────────────────────────────
  const origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input as Request).url ?? '';
    return origFetch(input, init).then((resp) => {
      resp.clone().text().then((text) => {
        const data = safeParse(text);
        if (data) handleData(url, data);
      }).catch(() => {});
      return resp;
    });
  };

  // ── Patch XHR ──────────────────────────────────────────────────────────────
  const OrigOpen = XMLHttpRequest.prototype.open;
  const OrigSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method: string, url: string) {
    (this as XMLHttpRequest & { _lsUrl: string })._lsUrl = url;
    return OrigOpen.apply(this, arguments as unknown as [string, string | URL]);
  };

  XMLHttpRequest.prototype.send = function () {
    const xhr = this as XMLHttpRequest & { _lsUrl: string };
    xhr.addEventListener('load', function () {
      if (xhr.status < 200 || xhr.status >= 300) return;
      const data = safeParse(xhr.responseText);
      if (data) handleData(xhr._lsUrl ?? '', data);
    });
    return OrigSend.apply(this, arguments as unknown as [Document | XMLHttpRequestBodyInit | null | undefined]);
  };

  console.log('[LeadSync] Interceptor active on', window.location.href);
}

/**
 * triggerLeadRefresh — called from the content script to make IndiaMART
 * re-issue its lead list API call (so our interceptor captures fresh data).
 */
export function triggerLeadRefresh(): void {
  const allTab = Array.from(document.querySelectorAll<HTMLElement>('a,button,span,li'))
    .find((el) => /^all$/i.test((el.textContent ?? '').trim()));
  if (allTab) { allTab.click(); return; }

  const active = document.querySelector<HTMLElement>('.active a, a.active, li.active a');
  if (active) active.click();
}
