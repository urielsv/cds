import { useCallback, useEffect, useState } from 'react';

import { api } from '@/lib/api';

export type SessionStatus = 'unknown' | 'signed-out' | 'signed-in';

export interface AdminSession {
  status: SessionStatus;
  signIn: (passphrase: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * Whether this browser holds an owner session. The cookie itself is HttpOnly
 * and invisible to script, so the server is asked. This only decides what UI
 * to show; every write is checked again on the server.
 */
export function useAdminSession(): AdminSession {
  const [status, setStatus] = useState<SessionStatus>('unknown');

  const refresh = useCallback(async () => {
    try {
      const body = await api<{ signedIn: boolean }>('/api/auth/session');
      setStatus(body.signedIn ? 'signed-in' : 'signed-out');
    } catch {
      // No API (plain `vite dev`, or offline): browsing still works.
      setStatus('signed-out');
    }
  }, []);

  useEffect(() => {
    let active = true;
    api<{ signedIn: boolean }>('/api/auth/session')
      .then((body) => {
        if (active) setStatus(body.signedIn ? 'signed-in' : 'signed-out');
      })
      .catch(() => {
        if (active) setStatus('signed-out');
      });
    return () => {
      active = false;
    };
  }, []);

  const signIn = useCallback(async (passphrase: string) => {
    await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ passphrase }) });
    setStatus('signed-in');
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api('/api/auth/logout', { method: 'POST', body: '{}' });
    } finally {
      setStatus('signed-out');
    }
  }, []);

  return { status, signIn, signOut, refresh };
}
