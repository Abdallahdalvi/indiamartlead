/**
 * SPA navigation observer for IndiaMART.
 *
 * IndiaMART uses client-side routing (React/SPA), so navigating between
 * leads doesn't cause a full page reload. This module patches
 * history.pushState / history.replaceState and listens to popstate to
 * detect URL changes and notify the caller.
 *
 * Also exports isLeadPage() so callers can decide whether extraction
 * is appropriate for a given URL.
 */

export type NavigationCallback = (newUrl: string) => void;

// ─── isLeadPage ───────────────────────────────────────────────────────────────

const LEAD_URL_PATTERNS = [
  'messagebox', 'buy-lead', 'buyer-central', 'leadmanager',
  'lead', 'enquir', 'requirement', 'seller.indiamart', 'my.indiamart',
];

/**
 * Returns true if the URL looks like an IndiaMART lead page.
 */
export function isLeadPage(url = window.location.href): boolean {
  const lower = url.toLowerCase();
  return LEAD_URL_PATTERNS.some((p) => lower.includes(p));
}

// ─── observeNavigation ────────────────────────────────────────────────────────

let _lastUrl = window.location.href;

/**
 * Start watching for URL changes caused by SPA navigation.
 *
 * Returns a cleanup function that restores the original history methods
 * and disconnects the MutationObserver.
 */
export function observeNavigation(callback: NavigationCallback): () => void {
  // ── Patch history API ─────────────────────────────────────────────────────
  const origPush    = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);

  history.pushState = function (state, title, url) {
    origPush(state, title, url);
    checkAndNotify(callback);
  };

  history.replaceState = function (state, title, url) {
    origReplace(state, title, url);
    checkAndNotify(callback);
  };

  // ── popstate (back/forward) ───────────────────────────────────────────────
  const onPopState = () => checkAndNotify(callback);
  window.addEventListener('popstate', onPopState);

  // ── DOM observer as belt-and-suspenders for heavy SPAs ───────────────────
  // Only watch direct children of <body> to minimise overhead.
  const observer = new MutationObserver(() => checkAndNotify(callback));
  observer.observe(document.body, { childList: true, subtree: false });

  // ── Cleanup ───────────────────────────────────────────────────────────────
  return () => {
    history.pushState    = origPush;
    history.replaceState = origReplace;
    window.removeEventListener('popstate', onPopState);
    observer.disconnect();
  };
}

function checkAndNotify(callback: NavigationCallback): void {
  const currentUrl = window.location.href;
  if (currentUrl !== _lastUrl) {
    _lastUrl = currentUrl;
    callback(currentUrl);
  }
}
