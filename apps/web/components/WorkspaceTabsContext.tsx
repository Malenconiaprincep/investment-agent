'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';

export type WorkspaceTab = {
  id: string;
  path: string;
};

type StoredTabs = {
  enabled: boolean;
  tabs: WorkspaceTab[];
  activeTabId: string;
};

type LegacySplitStored = {
  enabled: boolean;
  leftPath: string;
  rightPath: string;
  activePane: 'left' | 'right';
};

type WorkspaceTabsContextValue = {
  enabled: boolean;
  tabs: WorkspaceTab[];
  activeTabId: string;
  activeTab: WorkspaceTab | null;
  toggleTabMode: () => void;
  openOrSwitchTab: (path: string) => void;
  openNewTab: (path: string) => void;
  activateTab: (tabId: string) => void;
  closeTab: (tabId: string) => void;
};

const STORAGE_KEY = 'investment-agent-workspace-tabs';
const LEGACY_STORAGE_KEY = 'investment-agent-workspace-split';

const WorkspaceTabsContext = createContext<WorkspaceTabsContextValue | null>(
  null,
);

function createTabId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function normalizeTabPath(path: string): string {
  return path.split('?')[0] || '/monitor';
}

function createTab(path: string): WorkspaceTab {
  return { id: createTabId(), path: normalizeTabPath(path) };
}

function readStored(): StoredTabs | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw =
      window.localStorage.getItem(STORAGE_KEY) ??
      window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredTabs | LegacySplitStored;
    if ('tabs' in parsed && Array.isArray(parsed.tabs)) {
      return parsed;
    }
    if ('leftPath' in parsed && parsed.enabled) {
      const left = createTab(parsed.leftPath);
      const right = createTab(parsed.rightPath);
      return {
        enabled: true,
        tabs: [left, right],
        activeTabId: parsed.activePane === 'right' ? right.id : left.id,
      };
    }
    if ('leftPath' in parsed) {
      return {
        enabled: false,
        tabs: [createTab(parsed.leftPath)],
        activeTabId: '',
      };
    }
    return null;
  } catch {
    return null;
  }
}

function writeStored(value: StoredTabs) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // ignore quota errors
  }
}

export function WorkspaceTabsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [enabled, setEnabled] = useState(false);
  const [tabs, setTabs] = useState<WorkspaceTab[]>([createTab('/monitor')]);
  const [activeTabId, setActiveTabId] = useState('');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = readStored();
    if (stored) {
      setEnabled(stored.enabled);
      if (stored.tabs.length > 0) {
        setTabs(stored.tabs);
        setActiveTabId(
          stored.activeTabId || stored.tabs[0]?.id || '',
        );
      }
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || enabled) return;
    setTabs([createTab(pathname)]);
    setActiveTabId('');
  }, [pathname, enabled, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    writeStored({ enabled, tabs, activeTabId });
  }, [enabled, tabs, activeTabId, hydrated]);

  useEffect(() => {
    document.body.classList.toggle('tab-mode', enabled);
    return () => {
      document.body.classList.remove('tab-mode');
    };
  }, [enabled]);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null,
    [tabs, activeTabId],
  );

  const toggleTabMode = useCallback(() => {
    setEnabled((prev) => {
      if (prev) {
        const target = activeTab?.path ?? pathname;
        router.push(target);
        return false;
      }
      const initial = createTab(pathname);
      setTabs([initial]);
      setActiveTabId(initial.id);
      return true;
    });
  }, [activeTab?.path, pathname, router]);

  const openOrSwitchTab = useCallback((path: string) => {
    const normalized = normalizeTabPath(path);
    setTabs((current) => {
      const existing = current.find((tab) => tab.path === normalized);
      if (existing) {
        setActiveTabId(existing.id);
        return current;
      }
      const next = createTab(normalized);
      setActiveTabId(next.id);
      return [...current, next];
    });
  }, []);

  const openNewTab = useCallback((path: string) => {
    const next = createTab(path);
    setTabs((current) => [...current, next]);
    setActiveTabId(next.id);
  }, []);

  const activateTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
  }, []);

  const closeTab = useCallback(
    (tabId: string) => {
      setTabs((current) => {
        if (current.length <= 1) return current;
        const index = current.findIndex((tab) => tab.id === tabId);
        if (index < 0) return current;
        const nextTabs = current.filter((tab) => tab.id !== tabId);
        if (activeTabId === tabId) {
          const fallback = nextTabs[Math.max(0, index - 1)] ?? nextTabs[0];
          setActiveTabId(fallback?.id ?? '');
        }
        return nextTabs;
      });
    },
    [activeTabId],
  );

  const value = useMemo(
    () => ({
      enabled,
      tabs,
      activeTabId,
      activeTab,
      toggleTabMode,
      openOrSwitchTab,
      openNewTab,
      activateTab,
      closeTab,
    }),
    [
      enabled,
      tabs,
      activeTabId,
      activeTab,
      toggleTabMode,
      openOrSwitchTab,
      openNewTab,
      activateTab,
      closeTab,
    ],
  );

  return (
    <WorkspaceTabsContext.Provider value={value}>
      {children}
    </WorkspaceTabsContext.Provider>
  );
}

export function useWorkspaceTabs() {
  const ctx = useContext(WorkspaceTabsContext);
  if (!ctx) {
    throw new Error('useWorkspaceTabs must be used within WorkspaceTabsProvider');
  }
  return ctx;
}
