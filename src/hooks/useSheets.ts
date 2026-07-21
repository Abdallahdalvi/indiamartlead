/**
 * useSheets — React hook for Google Sheets configuration.
 *
 * Manages the list of the user's spreadsheets, the worksheets for the
 * currently selected spreadsheet, and the persisted AppConfig.
 */

import { useState, useCallback } from 'react';
import type { AppConfig, Spreadsheet, Worksheet, Message, MessageResponse } from '@/types';

function send<T = unknown>(msg: Message): Promise<MessageResponse<T>> {
  return chrome.runtime.sendMessage(msg) as Promise<MessageResponse<T>>;
}

interface UseSheetsReturn {
  spreadsheets:      Spreadsheet[];
  worksheets:        Worksheet[];
  config:            AppConfig | null;
  loading:           boolean;
  error:             string | null;
  fetchConfig:       () => Promise<void>;
  fetchSpreadsheets: () => Promise<void>;
  fetchWorksheets:   (spreadsheetId: string) => Promise<void>;
  updateConfig:      (updates: Partial<AppConfig>) => Promise<MessageResponse>;
}

export function useSheets(): UseSheetsReturn {
  const [spreadsheets, setSpreadsheets] = useState<Spreadsheet[]>([]);
  const [worksheets,   setWorksheets]   = useState<Worksheet[]>([]);
  const [config,       setConfig]       = useState<AppConfig | null>(null);
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await send<AppConfig>({ type: 'GET_CONFIG' });
      if (res.success && res.data) setConfig(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load config.');
    }
  }, []);

  const fetchSpreadsheets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await send<Spreadsheet[]>({ type: 'GET_SPREADSHEETS' });
      if (res.success && res.data) {
        setSpreadsheets(res.data);
      } else {
        setError(res.error ?? 'Failed to load spreadsheets.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load spreadsheets.');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchWorksheets = useCallback(async (spreadsheetId: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await send<Worksheet[]>({
        type:    'GET_WORKSHEETS',
        payload: { spreadsheetId },
      });
      if (res.success && res.data) {
        setWorksheets(res.data);
      } else {
        setError(res.error ?? 'Failed to load worksheets.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load worksheets.');
    } finally {
      setLoading(false);
    }
  }, []);

  const updateConfig = useCallback(async (updates: Partial<AppConfig>): Promise<MessageResponse> => {
    const res = await send({ type: 'SET_CONFIG', payload: updates });
    if (res.success) {
      setConfig((prev) => (prev ? { ...prev, ...updates } : (updates as AppConfig)));
    }
    return res;
  }, []);

  return {
    spreadsheets, worksheets, config, loading, error,
    fetchConfig, fetchSpreadsheets, fetchWorksheets, updateConfig,
  };
}
