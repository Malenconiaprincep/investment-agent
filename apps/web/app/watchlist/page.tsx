'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWatchlistPanel } from '@/components/WatchlistPanelContext';

export default function WatchlistRedirectPage() {
  const router = useRouter();
  const { setOpen } = useWatchlistPanel();

  useEffect(() => {
    setOpen(true);
    router.replace('/monitor');
  }, [router, setOpen]);

  return null;
}
