'use client';

import type { ReactNode } from 'react';
import { WatchlistPanel } from '@/components/WatchlistPanel';
import { MonitorBackgroundNotifier } from '@/components/MonitorBackgroundNotifier';

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="app-shell">
        <div className="app-shell-main">{children}</div>
        <WatchlistPanel />
      </div>
      <MonitorBackgroundNotifier />
    </>
  );
}
