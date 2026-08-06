import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { AppState, WorkspaceSettings } from '@shared/types';
import { api } from './lib';

type Toast = { id: number; title: string; detail?: string; tone?: 'success' | 'error' | 'info' };

interface AppContextValue {
  state: AppState | null;
  loading: boolean;
  error: string | null;
  toasts: Toast[];
  setState: React.Dispatch<React.SetStateAction<AppState | null>>;
  refresh: () => Promise<void>;
  notify: (title: string, detail?: string, tone?: Toast['tone']) => void;
  dismissToast: (id: number) => void;
  updateSettings: (settings: WorkspaceSettings) => Promise<void>;
  resetDemo: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const isScopedReview = location.pathname.startsWith('/review/');
  const [state, setState] = useState<AppState | null>(null);
  const [loading, setLoading] = useState(!isScopedReview);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify = useCallback((title: string, detail?: string, tone: Toast['tone'] = 'success') => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((items) => [...items, { id, title, detail, tone }]);
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 4200);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((items) => items.filter((item) => item.id !== id));
  }, []);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const result = await api<{ state: AppState }>('/api/bootstrap');
      setState(result.state);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not load Pind');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isScopedReview) {
      setLoading(false);
      return;
    }
    if (!state) {
      setLoading(true);
      void refresh();
    }
  }, [isScopedReview, location.pathname, refresh, state]);

  useEffect(() => {
    if (!state) return;
    document.documentElement.style.setProperty('--accent', state.workspace.accent);
    document.documentElement.dataset.surface = state.workspace.surface;
  }, [state]);

  const updateSettings = useCallback(
    async (settings: WorkspaceSettings) => {
      const next = await api<AppState>('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      setState(next);
      notify('Workspace updated', 'Your branding and portal preferences are live.');
    },
    [notify],
  );

  const resetDemo = useCallback(async () => {
    const next = await api<AppState>('/api/demo/reset', { method: 'POST' });
    setState(next);
    notify('Demo restored', 'The original Northstar workspace is back.');
  }, [notify]);

  const value = useMemo(
    () => ({ state, loading, error, toasts, setState, refresh, notify, dismissToast, updateSettings, resetDemo }),
    [state, loading, error, toasts, refresh, notify, dismissToast, updateSettings, resetDemo],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
}
