/**
 * Google OAuth 2.0 authentication service.
 *
 * Uses chrome.identity.getAuthToken (MV3-compatible).
 * The OAuth scopes are declared in manifest.json → "oauth2.scopes".
 *
 * Token lifecycle:
 *   - getToken()    → silent (non-interactive) token fetch
 *   - signIn()      → interactive flow if no cached token
 *   - ensureToken() → getToken() with interactive fallback
 *   - signOut()     → revoke + clear cached token + clear storage
 */

import { GOOGLE_APIS } from '@/constants';
import { setAuthState, clearAuthState, getAuthState } from '@/utils/storage';
import type { AuthState } from '@/types';

// ─── Token Helpers ────────────────────────────────────────────────────────────

/** Fetch a cached token silently. Returns null if not signed in. */
export async function getToken(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.identity.getAuthToken({ interactive: false }, (token) => {
      if (chrome.runtime.lastError || !token) {
        resolve(null);
        return;
      }
      resolve(token);
    });
  });
}

/** Get a token, triggering an interactive sign-in dialog if needed. */
export async function getTokenInteractive(): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(
          chrome.runtime.lastError?.message ?? 'Authentication cancelled or failed.',
        ));
        return;
      }
      resolve(token);
    });
  });
}

/** Remove a token from Chrome's identity cache (forces re-auth on next use). */
async function removeCachedToken(token: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.identity.removeCachedAuthToken({ token }, resolve);
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Sign in interactively, fetch user profile, and persist auth state.
 */
export async function signIn(): Promise<AuthState> {
  const token = await getTokenInteractive();

  let authState: AuthState = { isAuthenticated: true };

  try {
    const res = await fetch(GOOGLE_APIS.USER_INFO, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const info = await res.json() as { email: string; name: string; picture: string };
      authState = {
        isAuthenticated: true,
        email:           info.email,
        displayName:     info.name,
        picture:         info.picture,
      };
    }
  } catch {
    // Profile fetch is best-effort; token is still valid
  }

  await setAuthState(authState);
  return authState;
}

/**
 * Return a valid token. If no silent token is available, triggers
 * interactive sign-in automatically.
 */
export async function ensureToken(): Promise<string> {
  const silent = await getToken();
  if (silent) return silent;

  // Need interactive auth
  const token = await getTokenInteractive();
  // Refresh auth state in storage
  try { await signIn(); } catch { /* best-effort profile refresh */ }
  return token;
}

/**
 * Sign out: revoke token at Google, remove from Chrome cache, clear storage.
 */
export async function signOut(): Promise<void> {
  const token = await getToken();

  if (token) {
    await removeCachedToken(token);
    // Best-effort revocation — don't throw if it fails
    try {
      await fetch(`${GOOGLE_APIS.TOKEN_REVOKE}?token=${encodeURIComponent(token)}`);
    } catch {
      // no-op
    }
  }

  await clearAuthState();
}

// Re-export for background/index.ts convenience
export { getAuthState };
