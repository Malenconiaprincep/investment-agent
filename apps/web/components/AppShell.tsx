'use client';

import type { ReactNode } from 'react';
import { Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { WatchlistPanel } from '@/components/WatchlistPanel';
import { MonitorBackgroundNotifier } from '@/components/MonitorBackgroundNotifier';
import { WorkspaceTabPanels } from '@/components/WorkspaceTabView';
import { useWorkspaceTabs } from '@/components/WorkspaceTabsContext';
import { isAuthPath } from '@/lib/auth-paths';

function EmbedAwareChrome({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const isEmbed = searchParams.get('embed') === '1';
  const pathname = usePathname();
  const authPage = isAuthPath(pathname);

  if (isEmbed || authPage) {
    return <div className="app-shell-main">{children}</div>;
  }

  return (
    <>
      <TabMain>{children}</TabMain>
      <WatchlistPanel />
      <MonitorBackgroundNotifier />
    </>
  );
}

function TabMain({ children }: { children: ReactNode }) {
  const { enabled } = useWorkspaceTabs();

  if (enabled) {
    return <WorkspaceTabPanels />;
  }

  return <div className="app-shell-main">{children}</div>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const authPage = isAuthPath(pathname);

  return (
    <div className={`app-shell${authPage ? ' app-shell--auth' : ''}`}>
      <Suspense fallback={<div className="app-shell-main">{children}</div>}>
        <EmbedAwareChrome>{children}</EmbedAwareChrome>
      </Suspense>
    </div>
  );
}
