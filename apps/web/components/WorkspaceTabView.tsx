'use client';

import { navLabelForPath, defaultNavPath } from '@/lib/nav-items';
import { useAuthUser } from '@/hooks/useAuthUser';
import { useWorkspaceTabs } from '@/components/WorkspaceTabsContext';
import styles from './workspace-tabs.module.css';

function embedSrc(path: string) {
  const [pathAndQuery, hash] = path.split('#');
  const base = `${pathAndQuery.split('?')[0]}?embed=1`;
  return hash ? `${base}#${hash}` : base;
}

export function WorkspaceTabBar() {
  const { enabled, tabs, activeTabId, activeTab, activateTab, closeTab, openNewTab } =
    useWorkspaceTabs();
  const currentTabId = activeTab?.id ?? activeTabId;
  const { user } = useAuthUser();
  const newTabPath = user
    ? defaultNavPath(user.permissions, user.role)
    : '/research';

  if (!enabled) return null;

  return (
    <div className={`${styles.bar} workspace-tab-bar-host`}>
      <div className={styles.barInner}>
        <div className={styles.tabList} role="tablist" aria-label="工作区 Tab">
          {tabs.map((tab) => {
            const active = tab.id === currentTabId;
            return (
              <div
                key={tab.id}
                className={`${styles.tab}${active ? ` ${styles.tabActive}` : ''}`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={styles.tabButton}
                  onClick={() => activateTab(tab.id)}
                  title={tab.path}
                >
                  {navLabelForPath(tab.path)}
                </button>
                {tabs.length > 1 ? (
                  <button
                    type="button"
                    className={styles.tabClose}
                    aria-label={`关闭 ${navLabelForPath(tab.path)}`}
                    onClick={() => closeTab(tab.id)}
                  >
                    ×
                  </button>
                ) : null}
              </div>
            );
          })}
          <button
            type="button"
            className={styles.tabAdd}
            aria-label="新建 Tab"
            title={`新建 Tab（${navLabelForPath(newTabPath)}）`}
            onClick={() => openNewTab(newTabPath)}
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}

export function WorkspaceTabPanels() {
  const { tabs, activeTabId, activeTab } = useWorkspaceTabs();
  const currentTabId = activeTab?.id ?? activeTabId;

  return (
    <div className={styles.panels}>
      {tabs.map((tab) => {
        const active = tab.id === currentTabId;
        return (
          <div
            key={tab.id}
            className={`${styles.panel}${active ? ` ${styles.panelActive}` : ''}`}
            aria-hidden={!active}
          >
            <iframe
              className={styles.frame}
              src={embedSrc(tab.path)}
              title={navLabelForPath(tab.path)}
              loading="lazy"
            />
          </div>
        );
      })}
    </div>
  );
}
