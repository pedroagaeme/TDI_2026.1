'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AppChrome } from '@/components/app-chrome';
import { useAuth } from '@/components/providers/auth-provider';

export default function HomePage() {
  const { userId, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) {
      return;
    }
    router.replace(userId ? '/videos' : '/login');
  }, [loading, userId, router]);

  return (
    <AppChrome>
      <div className="panel">
        <div className="panel-inner stack">
          <h1 className="title" style={{ fontSize: 'clamp(1.5rem, 4vw, 2.25rem)', margin: 0 }}>
            {loading ? 'Loading…' : 'Continuing…'}
          </h1>
          <p className="muted">Taking you to the right step.</p>
        </div>
      </div>
    </AppChrome>
  );
}
