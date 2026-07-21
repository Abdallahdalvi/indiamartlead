/**
 * useAuth — React hook for Google OAuth 2.0 state.
 *
 * Fetches the current auth state from the background on mount,
 * and exposes signIn / signOut actions.
 */

import { useState, useEffect, useCallback } from 'react';
import type { AuthState, Message, MessageResponse } from '@/types';

function send<T = unknown>(msg: Message): Promise<MessageResponse<T>> {
  return chrome.runtime.sendMessage(msg) as Promise<MessageResponse<T>>;
}

interface UseAuthReturn {
  authState: AuthState;
  loading:   boolean;
  error:     string | null;
  signIn:    () => Promise<void>;
  signOut:   () => Promise<void>;
  refresh:   () => Promise<void>;
}

export function useAuth(): UseAuthReturn {
  const [authState, setAuthState] = useState<AuthState>({ isAuthenticated: false });
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await send<AuthState>({ type: 'GET_AUTH_STATE' });
      if (res.success && res.data) setAuthState(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get auth state.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // React to auth changes persisted in storage (e.g. auto-sign-in from another tab)
  useEffect(() => {
    const handler = (changes: Record<string, chrome.storage.StorageChange>) => {
      const next = changes['leadsync_auth']?.newValue as AuthState | undefined;
      if (next) setAuthState(next);
    };
    chrome.storage.local.onChanged.addListener(handler);
    return () => chrome.storage.local.onChanged.removeListener(handler);
  }, []);

  const signIn = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await send<AuthState>({ type: 'SIGN_IN' });
      if (res.success && res.data) {
        setAuthState(res.data);
      } else {
        setError(res.error ?? 'Sign-in failed.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await send({ type: 'SIGN_OUT' });
      setAuthState({ isAuthenticated: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-out failed.');
    } finally {
      setLoading(false);
    }
  }, []);

  return { authState, loading, error, signIn, signOut, refresh };
}
