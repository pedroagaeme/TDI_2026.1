'use client';

export function AppChrome({ children }: { children: React.ReactNode }) {
  return (
    <main className="app-shell">
      <div className="ambient-grid" />
      <div className="page">{children}</div>
    </main>
  );
}
