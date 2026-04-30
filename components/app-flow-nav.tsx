'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/components/providers/auth-provider';

const links = [
  { href: '/videos', label: 'My videos' },
  { href: '/upload', label: 'Upload' }
] as const;

export function AppFlowNav() {
  const pathname = usePathname();
  const { userEmail, signOut } = useAuth();

  return (
    <nav className="app-flow-nav" aria-label="Main">
      <div className="app-flow-nav-inner">
        <Link href="/videos" className="app-flow-brand">
          Video quiz
        </Link>
        <div className="app-flow-links">
          {links.map(({ href, label }) => {
            const active =
              pathname === href ||
              pathname.startsWith(`${href}/`) ||
              (href === '/videos' && pathname.startsWith('/play/'));
            return (
              <Link key={href} href={href} className={active ? 'app-flow-link is-active' : 'app-flow-link'}>
                {label}
              </Link>
            );
          })}
        </div>
        <div className="app-flow-user">
          <span className="muted app-flow-email">{userEmail}</span>
          <button type="button" className="button button-secondary app-flow-signout" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </div>
    </nav>
  );
}
