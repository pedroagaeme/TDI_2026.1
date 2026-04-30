'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppChrome } from '@/components/app-chrome';
import { useAuth } from '@/components/providers/auth-provider';
import { supabase } from '@/lib/supabase-client';

type AuthMode = 'login' | 'signup';

export function LoginClient() {
  const { userId, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMessage, setAuthMessage] = useState<string | null>(null);

  const nextPath = searchParams.get('next');
  const safeNext =
    nextPath && nextPath.startsWith('/') && !nextPath.startsWith('//') ? nextPath : '/videos';

  useEffect(() => {
    if (authLoading || !userId) {
      return;
    }
    router.replace(safeNext);
  }, [authLoading, userId, router, safeNext]);

  async function handleAuthSubmit() {
    setAuthMessage(null);

    if (!email.trim() || !password) {
      setAuthMessage('Enter an email and password.');
      return;
    }

    try {
      if (authMode === 'signup') {
        const redirectTo =
          typeof window !== 'undefined'
            ? process.env.NEXT_PUBLIC_APP_URL || window.location.origin
            : process.env.NEXT_PUBLIC_APP_URL || '';

        const { error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: redirectTo }
        });
        if (signUpError) {
          throw new Error(signUpError.message);
        }

        setAuthMessage('Account created. If email confirmation is enabled, check your inbox.');
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (signInError) {
        throw new Error(signInError.message);
      }

      router.replace(safeNext);
    } catch (authError) {
      setAuthMessage((authError as Error).message);
    }
  }

  if (authLoading) {
    return (
      <AppChrome>
        <div className="panel">
          <div className="panel-inner stack">
            <h1 className="title" style={{ fontSize: 'clamp(1.5rem, 4vw, 2.25rem)', margin: 0 }}>
              Loading…
            </h1>
            <p className="muted">Checking authentication.</p>
          </div>
        </div>
      </AppChrome>
    );
  }

  if (userId) {
    return (
      <AppChrome>
        <div className="panel">
          <div className="panel-inner stack">
            <p className="muted">Redirecting…</p>
          </div>
        </div>
      </AppChrome>
    );
  }

  return (
    <AppChrome>
      <header className="hero" style={{ marginBottom: 28 }}>
        <div className="eyebrow">
          <span className="eyebrow-dot" />
          Sign in to continue
        </div>
        <h1 className="title">Video prediction quiz</h1>
        <p className="subtitle">
          Log in to upload videos, run analysis, manage saved quizzes, and play the guessing game at each scene
          break.
        </p>
      </header>

      <div className="flow-stack">
        <div className="panel">
          <div className="panel-inner stack">
            <div>
              <h2 className="panel-heading">Account</h2>
              <p className="muted">Create an account or log in with Supabase Auth.</p>
            </div>

            <div className="field">
              <label className="muted">Email</label>
              <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
            </div>

            <div className="field">
              <label className="muted">Password</label>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Your password"
              />
            </div>

            <div className="actions">
              <button type="button" className="button button-primary" onClick={() => void handleAuthSubmit()}>
                {authMode === 'signup' ? 'Create account' : 'Log in'}
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => setAuthMode(authMode === 'signup' ? 'login' : 'signup')}
              >
                Switch to {authMode === 'signup' ? 'login' : 'sign up'}
              </button>
            </div>

            {authMessage ? <div className="notice">{authMessage}</div> : null}
          </div>
        </div>

        <p className="muted" style={{ margin: 0 }}>
          After signing in you will go to <strong style={{ color: 'var(--text)' }}>My videos</strong>.{' '}
          <Link href="/videos" className="flow-back">
            Open app (requires login)
          </Link>
        </p>
      </div>
    </AppChrome>
  );
}
