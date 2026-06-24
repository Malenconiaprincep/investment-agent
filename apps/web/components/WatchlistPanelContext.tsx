'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

type WatchlistPanelContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
  itemCount: number;
  setItemCount: (count: number) => void;
  refreshToken: number;
  refresh: () => void;
};

const WatchlistPanelContext = createContext<WatchlistPanelContextValue | null>(null);

export function WatchlistPanelProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [itemCount, setItemCount] = useState(0);
  const [refreshToken, setRefreshToken] = useState(0);

  const toggle = useCallback(() => setOpen((value) => !value), []);
  const refresh = useCallback(() => setRefreshToken((value) => value + 1), []);

  const value = useMemo(
    () => ({
      open,
      setOpen,
      toggle,
      itemCount,
      setItemCount,
      refreshToken,
      refresh,
    }),
    [open, itemCount, refreshToken, toggle, refresh],
  );

  return (
    <WatchlistPanelContext.Provider value={value}>{children}</WatchlistPanelContext.Provider>
  );
}

export function useWatchlistPanel() {
  const ctx = useContext(WatchlistPanelContext);
  if (!ctx) {
    throw new Error('useWatchlistPanel must be used within WatchlistPanelProvider');
  }
  return ctx;
}
