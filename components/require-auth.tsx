'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AppChrome } from '@/components/app-chrome';
import { AppFlowNav } from '@/components/app-flow-nav';
import { useAuth } from '@/components/providers/auth-provider';

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { userId, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading || userId) {
      return;
    }
    const next = pathname && pathname !== '/' ? `?next=${encodeURIComponent(pathname)}` : '';
    router.replace(`/login${next}`);
  }, [loading, userId, router, pathname]);

  if (loading) {
    return (
      <AppChrome>
        <div className="panel">
          <div className="panel-inner stack">
            <h1 className="title" style={{ fontSize: 'clamp(1.5rem, 4vw, 2.25rem)', margin: 0 }}>
              Loading session…
            </h1>
            <p className="muted">Checking authentication.</p>
          </div>
        </div>
      </AppChrome>
    );
  }

  if (!userId) {
    return (
      <AppChrome>
        <div className="panel">
          <div className="panel-inner stack">
            <p className="muted">Redirecting to sign in…</p>
          </div>
        </div>
      </AppChrome>
    );
  }

  return (
    <AppChrome>
      <AppFlowNav />
      {children}
    </AppChrome>
  );
}
