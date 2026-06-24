'use client';

import type { ReactNode } from 'react';
import { useWatchlistPanel } from '@/components/WatchlistPanelContext';

type OpenWatchlistPanelButtonProps = {
  className?: string;
  children: ReactNode;
};

export function OpenWatchlistPanelButton({
  className,
  children,
}: OpenWatchlistPanelButtonProps) {
  const { setOpen } = useWatchlistPanel();

  return (
    <button type="button" className={className} onClick={() => setOpen(true)}>
      {children}
    </button>
  );
}
