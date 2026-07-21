/**
 * Exponential-backoff retry wrapper and authenticated HTTP helper
 * for all Google API calls.
 */

import { RATE_LIMIT } from '@/constants';

// ─── Sleep Helper ─────────────────────────────────────────────────────────────

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// ─── Error Classification ─────────────────────────────────────────────────────

/**
 * Returns true for errors that should trigger a retry:
 *   - HTTP 429 (rate limited)
 *   - HTTP 5xx (server errors)
 *   - Network failures
 */
function isRetryable(error: Error): boolean {
  const msg = error.message;
  if (msg.includes('NetworkError') || msg.includes('Failed to fetch') || msg.includes('network')) {
    return true;
  }
  const match = msg.match(/HTTP (\d{3})/);
  if (match) {
    const code = parseInt(match[1], 10);
    return code === 429 || (code >= 500 && code < 600);
  }
  return false;
}

/**
 * Parse a Retry-After value (seconds) embedded in the error message.
 * Google API errors include it as: "Retry-After: <seconds>"
 */
function parseRetryAfter(error: Error): number | null {
  const match = error.message.match(/Retry-After:\s*(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Compute jittered exponential-backoff delay for attempt N (0-indexed).
 */
function backoffDelay(attempt: number, error: Error): number {
  const retryAfter = parseRetryAfter(error);
  if (retryAfter !== null) return retryAfter * 1_000;

  const base   = RATE_LIMIT.BASE_DELAY_MS * 2 ** attempt;
  const jitter = Math.random() * 500;
  return Math.min(base + jitter, RATE_LIMIT.MAX_DELAY_MS);
}

// ─── Retry Wrapper ────────────────────────────────────────────────────────────

/**
 * Execute `fn`, retrying up to RATE_LIMIT.MAX_RETRIES times on retryable errors.
 * Non-retryable errors are thrown immediately.
 *
 * @param fn      - Async function to execute
 * @param context - Human-readable label for log messages
 */
export async function withRetry<T>(fn: () => Promise<T>, context = 'API'): Promise<T> {
  let lastError: Error = new Error('Unknown error');

  for (let attempt = 0; attempt <= RATE_LIMIT.MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (!isRetryable(lastError) || attempt === RATE_LIMIT.MAX_RETRIES) {
        throw lastError;
      }

      const delay = backoffDelay(attempt, lastError);
      console.warn(
        `[LeadSync] ${context}: attempt ${attempt + 1}/${RATE_LIMIT.MAX_RETRIES} failed — ` +
        `retrying in ${Math.round(delay)}ms. Error: ${lastError.message}`,
      );
      await sleep(delay);
    }
  }

  throw lastError;
}

// ─── Authenticated Fetch ──────────────────────────────────────────────────────

/**
 * Make an authenticated HTTP request to a Google API endpoint.
 * Throws a descriptive error (including HTTP status) on failure so
 * withRetry() can correctly classify 429/5xx as retryable.
 */
export async function apiRequest<T>(
  url:     string,
  token:   string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const retryAfter = response.headers.get('Retry-After');
    let body = '';
    try { body = await response.text(); } catch { /* ignore */ }

    const retryMsg = retryAfter ? ` Retry-After: ${retryAfter}.` : '';
    throw new Error(
      `HTTP ${response.status}: ${response.statusText}.${retryMsg} Body: ${body.slice(0, 300)}`,
    );
  }

  return response.json() as Promise<T>;
}
