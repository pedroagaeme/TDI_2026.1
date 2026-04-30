import { Suspense } from 'react';
import { AppChrome } from '@/components/app-chrome';
import { LoginClient } from './login-client';

function LoginFallback() {
  return (
    <AppChrome>
      <div className="panel">
        <div className="panel-inner stack">
          <h1 className="title" style={{ fontSize: 'clamp(1.5rem, 4vw, 2.25rem)', margin: 0 }}>
            Loading…
          </h1>
          <p className="muted">Preparing sign-in.</p>
        </div>
      </div>
    </AppChrome>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginFallback />}>
      <LoginClient />
    </Suspense>
  );
}
