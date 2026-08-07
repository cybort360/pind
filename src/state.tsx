import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { AppState, WorkspaceSettings } from '@shared/types';
import { api } from './lib';

type Toast = { id: number; title: string; detail?: string; tone?: 'success' | 'error' | 'info' };

export interface SetupInput {
  name: string;
  shortName: string;
  logoText: string;
  accent: string;
  surface: 'warm' | 'cool' | 'paper';
  portalHeadline: string;
  approvalDisclaimer: string;
  emailFromName: string;
  ownerName: string;
  email: string;
  ownerPassword: string;
  loadDemoData: boolean;
}

interface AuthStatus {
  configured: boolean;
  authenticated: boolean;
  demo: boolean;
}

export interface AppConfig {
  app: { name: string; tagline: string; description: string };
  projectCategories: { id: string; label: string }[];
  deliverableKinds: { id: string; label: string }[];
  approvalWording: {
    approvedTitle: string; approvedDetail: string;
    changesTitle: string; changesDetail: string;
  };
  features: {
    requireClientName: boolean; allowDownloads: boolean; showRevisionHistory: boolean;
    cloudinary: boolean; resend: boolean; slack: boolean;
  };
}

interface AppContextValue {
  state: AppState | null;
  loading: boolean;
  error: string | null;
  auth: AuthStatus;
  config: AppConfig | null;
  toasts: Toast[];
  setState: React.Dispatch<React.SetStateAction<AppState | null>>;
  refresh: () => Promise<void>;
  refreshAuth: () => Promise<AuthStatus>;
  setupWorkspace: (input: SetupInput) => Promise<AppState>;
  login: (email: string, password: string) => Promise<AppState>;
  logout: () => Promise<void>;
  enterDemo: () => Promise<AppState>;
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
  const [auth, setAuth] = useState<AuthStatus>({ configured: false, authenticated: false, demo: false });
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify = useCallback((title: string, detail?: string, tone: Toast['tone'] = 'success') => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((items) => [...items, { id, title, detail, tone }]);
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 4200);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((items) => items.filter((item) => item.id !== id));
  }, []);

  const refreshAuth = useCallback(async (): Promise<AuthStatus> => {
    const result = await api<AuthStatus>('/api/auth/status');
    setAuth(result);
    return result;
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

  const adoptState = useCallback((next: AppState) => {
    setState(next);
    setAuth((current) => ({ ...current, authenticated: true }));
  }, []);

  const setupWorkspace = useCallback(async (input: SetupInput) => {
    const next = await api<AppState>('/api/auth/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    adoptState(next);
    setLoading(false);
    return next;
  }, [adoptState]);

  const login = useCallback(async (email: string, password: string) => {
    const next = await api<AppState>('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    adoptState(next);
    setLoading(false);
    return next;
  }, [adoptState]);

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    setState(null);
    setAuth((current) => ({ ...current, authenticated: false, demo: false }));
  }, []);

  const enterDemo = useCallback(async () => {
    const next = await api<AppState>('/api/auth/demo', { method: 'POST' });
    adoptState(next);
    setLoading(false);
    return next;
  }, [adoptState]);

  useEffect(() => {
    if (isScopedReview) {
      setLoading(false);
      return;
    }
    let active = true;
    void (async () => {
      setLoading(true);
      const status = await refreshAuth().catch(() => ({ configured: false, authenticated: false, demo: false }));
      if (!active) return;
      if (status.authenticated) {
        await refresh();
      } else {
        setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [isScopedReview, location.pathname, refresh, refreshAuth]);

  useEffect(() => {
    if (!state) return;
    document.documentElement.style.setProperty('--accent', state.workspace.accent);
    document.documentElement.dataset.surface = state.workspace.surface;
  }, [state]);

  useEffect(() => {
    api<AppConfig>('/api/config').then(setConfig).catch(() => undefined);
  }, []);

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
    notify('Sample data restored', 'The original demo workspace is back.');
  }, [notify]);

  const value = useMemo(
    () => ({
      state, loading, error, auth, config, toasts, setState, refresh, refreshAuth,
      setupWorkspace, login, logout, enterDemo, notify, dismissToast,
      updateSettings, resetDemo,
    }),
    [state, loading, error, auth, config, toasts, refresh, refreshAuth, setupWorkspace,
     login, logout, enterDemo, notify, dismissToast, updateSettings, resetDemo],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
}
