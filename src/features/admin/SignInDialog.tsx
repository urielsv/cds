import { type SubmitEvent, useState } from 'react';

import { ApiError } from '@/lib/api';

import { AdminSheet } from './AdminSheet';
import { type AdminSession } from './useAdminSession';

interface SignInDialogProps {
  session: AdminSession;
  onClose: () => void;
  onSignedIn: () => void;
}

export function SignInDialog({ session, onClose, onSignedIn }: SignInDialogProps) {
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (passphrase.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await session.signIn(passphrase);
      setPassphrase('');
      onSignedIn();
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.code === 'rate_limited'
          ? 'Too many attempts. Wait a few minutes and try again.'
          : caught instanceof Error
            ? caught.message
            : 'Could not sign in.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminSheet title="Owner sign in" onClose={onClose}>
      <form className="admin-form" onSubmit={(event) => void submit(event)}>
        <p className="admin-form__hint">
          Adding albums is limited to the collection&rsquo;s owner.
        </p>
        <label className="field">
          <span className="field__label">Passphrase</span>
          <input
            className="field__input"
            type="password"
            autoComplete="current-password"
            value={passphrase}
            onChange={(event) => {
              setPassphrase(event.target.value);
            }}
            aria-invalid={error !== null}
            aria-describedby={error === null ? undefined : 'sign-in-error'}
          />
        </label>
        {error !== null && (
          <p id="sign-in-error" className="admin-form__error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="pill-button pill-button--primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AdminSheet>
  );
}
