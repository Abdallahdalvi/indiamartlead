(function () {
  "use strict";

  // ─── REGEX CONSTANTS ───────────────────────────────────────────────────────
  const PHONE_RE   = /(?:0|\+91|91)?([6-9]\d{9})\b/;
  const PHONE_RE_G = /(?:0|\+91|91)?([6-9]\d{9})\b/g;
  const DATE_RE    = /\b(?:Yesterday|Today|\d{1,2}\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?:\s*'?\d{2,4})?|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{1,2}:\d{2}\s*(?:AM|PM))\b/i;
  const TIME_ONLY_RE = /^\d{1,2}:\d{2}(?:\s*[AP]M)?$/i;
  const SOURCE_RE  = /\b(Buylead|Buy Leads|Catalog Link|Catalogue Link|Call)\b/i;
  const UI_NOISE_RE = /^(Tomorrow|Add note|\+|Actions|Manage columns|Folders|Page \d+|Rating submitted|GST|Verified|Premium|\+ Label|Labels?|Unread|Fresh|Contacted|Follow Up|Deal Done|Reminders?|Messages?|Notes?|Sender|Requirement|Location)$/i;
  const GREETING_RE = /^(hi\b|hello\b|dear\b|greetings\b|i am interested|please send|quote|require|what is)/i;

  // ─── UTILITIES ─────────────────────────────────────────────────────────────
  function extractPhone(text) {
    PHONE_RE.lastIndex = 0;
    const m = PHONE_RE.exec(text || "");
    return m ? m[1] : null;
  }

  function clean(text, maxLen = 500) {
    if (!text) return null;
    const s = text.trim().replace(/\s+/g, " ");
    return s.length > maxLen ? s.substring(0, maxLen) : s || null;
  }

  function isVisible(el) {
    if (!el) return false;
    if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") return false;
    if ((el.className || "").toString().includes("disabled") || (el.className || "").toString().includes("ag-disabled")) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 &&
           window.getComputedStyle(el).display !== "none" &&
           window.getComputedStyle(el).visibility !== "hidden";
  }

  const NAV_SELECTORS = [
    "header", "nav",
    '[class*="topbar"]', '[class*="TopBar"]',
    '[class*="navbar"]', '[class*="Navbar"]',
    '[class*="sidebar"]', '[class*="Sidebar"]',
    '[class*="accountSwitcher"]', '[class*="profileMenu"]', '[class*="userMenu"]',
    '[class*="ag-header"]'
  ];

  function isNavElement(el) {
    for (const sel of NAV_SELECTORS) {
      try { if (el.closest(sel)) return true; } catch {}
    }
    return false;
  }

  // ─── DYNAMIC AG-GRID MAPPING ───────────────────────────────────────────────
  
  // Maps human-readable intent to actual ag-grid col-id attributes
  let headerColIdMap = null;

  function buildHeaderColIdMap() {
    const headerCells = document.querySelectorAll('.ag-header-cell');
    if (!headerCells || headerCells.length === 0) return null;
    
    const map = {};
    headerCells.forEach(hc => {
      const colId = hc.getAttribute('col-id');
      if (!colId) return;
      
      // Look at the visible text OR the col-id string itself as a hint
      const text = (hc.textContent || "").toLowerCase().trim();
      const idText = colId.toLowerCase();
      
      if (text.includes("sender") || text.includes("buyer") || idText.includes("sender")) map.sender = colId;
      else if (text.includes("requirement") || text.includes("product") || idText.includes("require")) map.requirement = colId;
      else if (text.includes("location") || text.includes("city") || idText.includes("loc")) map.location = colId;
      else if (text.includes("message") || idText.includes("msg") || idText.includes("message")) map.messages = colId;
      else if (text.includes("reminder") || text.includes("date") || idText.includes("time")) map.date = colId;
    });
    
    if (Object.keys(map).length > 0) {
      console.log("[LeadSync] Detected Grid Map:", map);
      return map;
    }
    return null;
  }

  // ─── ROW DETECTION ─────────────────────────────────────────────────────────

  function findAgGridRows() {
    return Array.from(
      document.querySelectorAll('[class*="ag-row"]:not([class*="ag-header-row"]), [role="row"]:not([aria-rowindex="1"])')
    ).filter(row => !isNavElement(row) && extractPhone(row.textContent || "") !== null);
  }

  function findHeuristicRows() {
    const ROW_SELECTORS = [
      '[id^="contact-"]', '[role="row"]', '[role="listitem"]',
      '[class*="contactRow"]', '[class*="leadRow"]', '[class*="listItem"]',
      '[class*="msgBox"]', '[class*="chatItem"]', '[class*="rowContainer"]', '[class*="tableRow"]',
    ];
    let best = [];
    for (const sel of ROW_SELECTORS) {
      let els;
      try { els = Array.from(document.querySelectorAll(sel)); } catch { continue; }
      if (els.length < 2) continue;
      const filtered = els.filter(el => {
        if (isNavElement(el)) return false;
        const phones = [...(el.textContent || "").matchAll(new RegExp(PHONE_RE_G))].map(m => m[1]);
        return new Set(phones).size === 1;
      });
      if (filtered.length > best.length) best = filtered;
    }
    return best;
  }

  function findLeadRows() {
    let rows = findAgGridRows();
    if (rows.length < 2) rows = [...rows, ...findHeuristicRows()];

    const phoneMap = new Map();
    for (const row of rows) {
      const phone = extractPhone(row.textContent || "");
      if (!phone) continue;
      const existing = phoneMap.get(phone);
      if (!existing || (row.textContent?.length ?? 0) < (existing.textContent?.length ?? Infinity)) {
        phoneMap.set(phone, row);
      }
    }
    return Array.from(phoneMap.values());
  }

  // ─── FIELD EXTRACTION ──────────────────────────────────────────────────────

  function getCellText(row, colId) {
    if (!colId) return null;
    const cell = row.querySelector(`[col-id="${colId}"]`);
    if (!cell) return null;
    return cell.innerText?.trim() || cell.textContent?.trim() || null;
  }

  function buildLeadFromTexts(phone, senderText, requirementText, messagesText, locationText, dateText, row) {
    let buyerName = null;
    if (senderText) {
      buyerName = clean(
        senderText.replace(/(?:0|\+91|91)?[6-9]\d{9}/g, "")
                  .replace(/\bGST\b|\bVerified\b|●|★|✔/gi, "")
                  .replace(/\n/g, " ")
                  .trim()
      );
      // Remove location if it leaked into the name text
      const locEl = row.querySelector('.sender-location');
      if (locEl && locEl.innerText) {
         buyerName = buyerName.replace(locEl.innerText.trim(), "").trim();
      }
    }

    let product = null, quantity = null;
    if (requirementText) {
      const lines = requirementText
        .split(/\n/)
        .map(l => l.trim())
        .filter(l => l && !UI_NOISE_RE.test(l) && !PHONE_RE.test(l));
      product  = clean(lines[0], 300) || null;
      quantity = clean(lines[1], 100) || null;
      if (quantity && !/\d/.test(quantity)) {
        if (!product) product = quantity;
        quantity = null;
      }
    }

    let source = null;
    let leadDate = null;
    
    // The DATE/TIME column often contains the Source as well (e.g., "Buylead\n10:40 AM")
    if (dateText) {
      const lines = dateText.split(/\n/).map(l => l.trim()).filter(Boolean);
      for (const line of lines) {
        if (SOURCE_RE.test(line)) {
           source = line;
        } else if (DATE_RE.test(line)) {
           leadDate = line;
        }
      }
    }

    // Fallback source from messages
    if (!source && messagesText) {
      if (/catalog\s*link/i.test(messagesText))        source = "Catalog Link";
      else if (/buylead|buy\s*lead/i.test(messagesText)) source = "Buylead";
      else if (/buyer\s*searched/i.test(messagesText))   source = "Buylead";
      else if (/call\s+attempt/i.test(messagesText))     source = "Call";
      else if (/email\s*marketing/i.test(messagesText))  source = "Direct";
      else if (messagesText.length > 3)                  source = "Direct";
    }

    // Fallback location from anywhere in the row (typically inside sender cell)
    let city = null;
    const locNode = row.querySelector('.sender-location');
    if (locNode && locNode.innerText) {
      city = clean(locNode.innerText, 100);
    } else if (locationText) {
      const loc = locationText.split(/[,\-\/]/)[0]?.trim();
      if (loc && loc.length <= 60 && !UI_NOISE_RE.test(loc)) city = clean(loc, 100);
    }

    const linkEl = row.querySelector('a[href*="messagecentre"], a[href*="lead"], a[href*="contact"]');
    return {
      buyerName: buyerName || "IndiaMART Lead",
      company:   buyerName,
      mobile:    phone,
      email:     null,
      product:   product,
      quantity:  quantity,
      requirement: product || null,
      city:      city,
      state:     null,
      budget:    null,
      source:    source,
      leadDate:  leadDate,
      labels:    null,
      sourceUrl: linkEl?.href ?? window.location.href,
    };
  }

  function parseRow(row, phone) {
    if (isNavElement(row)) return null;

    // Strategy 1: Dynamic ag-grid headers (MOST RELIABLE)
    if (!headerColIdMap) {
      headerColIdMap = buildHeaderColIdMap();
    }
    
    if (headerColIdMap) {
      const senderText = getCellText(row, headerColIdMap.sender);
      const reqText    = getCellText(row, headerColIdMap.requirement);
      const locText    = getCellText(row, headerColIdMap.location);
      const msgText    = getCellText(row, headerColIdMap.messages);
      const dateText   = getCellText(row, headerColIdMap.date);
      
      // If we mapped at least one field successfully, use this!
      if (senderText || reqText || msgText || dateText) {
        return buildLeadFromTexts(phone, senderText, reqText, msgText, locText, dateText, row);
      }
    }

    // Strategy 2: Fallback text walker for unknown layouts
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT, null);
    const texts = [];
    let node;
    while ((node = walker.nextNode())) {
      const t = (node.nodeValue || "").replace(/\s+/g, " ").trim();
      if (t) texts.push(t);
    }

    let phoneIdx = -1;
    for (let i = 0; i < texts.length; i++) {
      if (extractPhone(texts[i]) === phone) { phoneIdx = i; break; }
    }
    if (phoneIdx === -1) return null;

    let buyerName = "IndiaMART Lead";
    for (let i = phoneIdx - 1; i >= 0; i--) {
      const t = texts[i];
      if (!UI_NOISE_RE.test(t) && !/GST|Verified|Premium|\+ Label/i.test(t) && t.length > 2) {
        buyerName = clean(t, 200) || buyerName;
        break;
      }
    }

    let source = null, leadDate = null;
    const remaining = [];
    let skipNextTime = false;

    for (let i = phoneIdx + 1; i < texts.length; i++) {
      const t = texts[i];
      if (/^Tomorrow$/i.test(t)) { skipNextTime = true; continue; }
      if (skipNextTime) {
        skipNextTime = false;
        if (TIME_ONLY_RE.test(t)) continue;
      }
      if (UI_NOISE_RE.test(t) || /^\+$/.test(t)) continue;
      if (/^Tomorrow\s+\d{1,2}:\d{2}/i.test(t)) continue;
      if (/^(Add note|\+\s*Label|Manage columns|Folders|Next|Previous|Fresh|Contacted|Deal Done|Unread|Rating submitted)$/i.test(t)) continue;

      if (!source) {
        const sm = t.match(SOURCE_RE);
        if (sm) { source = sm[0]; continue; }
        if (/catalog\s*link/i.test(t)) { source = "Catalog Link"; continue; }
        if (/buylead|buy\s*lead/i.test(t)) { source = "Buylead"; continue; }
        if (/email\s*marketing/i.test(t)) { source = "Direct"; continue; }
        if (/call\s*(attempted|outgoing)/i.test(t)) { source = "Call"; continue; }
        if (/connected.*indiamart/i.test(t)) { source = "Direct"; continue; }
      }

      if (!leadDate) {
        const dm = t.match(DATE_RE);
        if (dm) {
          if (!TIME_ONLY_RE.test(dm[0])) { leadDate = dm[0]; continue; }
        }
      }
      remaining.push(t);
    }

    let product = null;
    if (remaining.length > 0 && !GREETING_RE.test(remaining[0])) {
      product = clean(remaining.shift(), 300);
    }

    let city = null;
    for (let i = 0; i < remaining.length; i++) {
      const t = remaining[i];
      if (t.length > 1 && t.length <= 50 && /^[A-Za-z\u0900-\u097F][A-Za-z\u0900-\u097F .',-]*$/.test(t) && !GREETING_RE.test(t) && !/catalog|link|label|buyer|searched|tomorrow|add note/i.test(t)) {
        city = clean(remaining.splice(i, 1)[0], 100);
        break;
      }
    }

    if (!source && remaining.length > 0) source = "Direct";
    const linkEl = row.querySelector('a[href*="messagecentre"], a[href*="lead"]');
    return {
      buyerName, company: null, mobile: phone, email: null, product, quantity: null, requirement: product || null, city, state: null, budget: null, source, leadDate, labels: null, sourceUrl: linkEl?.href ?? window.location.href,
    };
  }

  function extractPageLeads() {
    try {
      const dumpHtml = document.querySelector('.ag-root-wrapper')?.outerHTML || document.body.innerHTML;
      fetch("http://localhost:8080/dump", {
        method: "POST",
        headers: { "Content-Type": "text/html" },
        body: dumpHtml
      }).catch(() => {});
    } catch(e) {}
    
    headerColIdMap = null; // Rebuild map on every page request
    const rows = findLeadRows();
    const leads = [];
    for (const row of rows) {
      const phone = extractPhone(row.textContent || "");
      if (phone) {
        const lead = parseRow(row, phone);
        if (lead) leads.push(lead);
      }
    }
    return leads;
  }

  // ─── PAGINATION ────────────────────────────────────────────────────────────

  function findNextPageButton() {
    // 1. Check ag-grid native next button
    const agNext = document.querySelector('.ag-paging-button[ref="btNext"], .ag-paging-page-next');
    if (agNext && !agNext.disabled && !agNext.classList.contains('ag-disabled')) {
      return agNext;
    }

    // 2. Look for literal ">" or "Next"
    const els = Array.from(document.querySelectorAll('button, a, span, div[role="button"], li[role="button"], i'));
    for (const el of els) {
      if (!isVisible(el)) continue;
      const t = (el.textContent || "").trim();
      const aria = (el.getAttribute("aria-label") || "").toLowerCase();
      const cls = (el.className || "").toString().toLowerCase();
      
      if (t === ">" || t === "›" || t === "»" || t === "Next" || t === "next >" ||
          aria.includes("next page") || (aria === "next") || cls.includes("next-page") || cls.includes("arrowright")) {
        if (!el.hasAttribute("disabled") && !cls.includes("disabled")) {
          return el;
        }
      }
    }
    
    return null;
  }

  async function scrollForMore() {
    const rows = findLeadRows();
    let el = rows[0];
    let container = document.documentElement;
    while (el && el !== document.body) {
      const ov = window.getComputedStyle(el).overflowY;
      if ((ov === "auto" || ov === "scroll") && el.scrollHeight > el.clientHeight + 10) {
        container = el;
        break;
      }
      el = el.parentElement;
    }

    const prevCount = findLeadRows().length;
    for (let i = 1; i <= 4; i++) {
      const pos = container.scrollTop + (container.scrollHeight - container.clientHeight - container.scrollTop) * i / 4;
      container.scrollTo({ top: pos, behavior: "auto" });
      container.dispatchEvent(new Event("scroll", { bubbles: true }));
      await new Promise(r => setTimeout(r, 250));
    }
    container.scrollTo({ top: container.scrollHeight, behavior: "auto" });
    container.dispatchEvent(new Event("scroll", { bubbles: true }));
    await new Promise(r => setTimeout(r, 900));

    return findLeadRows().length > prevCount;
  }

  // ─── MESSAGE LISTENER ──────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const type = msg?.type;
    if (type === "EXTRACT_PAGE_LEADS" || type === "EXTRACT_LEAD") {
      try { sendResponse({ success: true, data: extractPageLeads() }); } 
      catch (err) { sendResponse({ success: false, error: String(err) }); }
      return true;
    }
    if (type === "CLICK_NEXT_PAGE") {
      const btn = findNextPageButton();
      if (btn) {
        btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
        btn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
        btn.click();
        sendResponse({ success: true, data: { hasNext: true } });
      } else {
        scrollForMore().then(r => sendResponse({ success: true, data: { hasNext: r } })).catch(e => sendResponse({ success: false, error: String(e) }));
      }
      return true;
    }
    return false;
  });

  console.log("[LeadSync] Content script V3 injected. Dynamic headers enabled.");
})();
