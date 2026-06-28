'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { WatchlistPanel } from '@/components/WatchlistPanel';
import { MonitorBackgroundNotifier } from '@/components/MonitorBackgroundNotifier';
import { isAuthPath } from '@/lib/auth-paths';

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const authPage = isAuthPath(pathname);

  return (
    <>
      <div className={`app-shell${authPage ? ' app-shell--auth' : ''}`}>
        <div className="app-shell-main">{children}</div>
        {!authPage ? <WatchlistPanel /> : null}
      </div>
      {!authPage ? <MonitorBackgroundNotifier /> : null}
    </>
  );
}
