'use client';

import { navLabelForPath } from '@/lib/nav-items';
import { useWorkspaceTabs } from '@/components/WorkspaceTabsContext';
import styles from './workspace-tabs.module.css';

function embedSrc(path: string) {
  return `${path.split('?')[0]}?embed=1`;
}

export function WorkspaceTabBar() {
  const {
    enabled,
    tabs,
    activeTabId,
    activateTab,
    closeTab,
    openNewTab,
    toggleTabMode,
  } = useWorkspaceTabs();

  if (!enabled) return null;

  return (
    <div className={styles.bar}>
      <div className={styles.tabList} role="tablist" aria-label="工作区 Tab">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
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
          title="新建 Tab（雷达）"
          onClick={() => openNewTab('/monitor')}
        >
          +
        </button>
      </div>
      <button type="button" className={styles.exitButton} onClick={toggleTabMode}>
        退出 Tab
      </button>
    </div>
  );
}

export function WorkspaceTabPanels() {
  const { tabs, activeTabId } = useWorkspaceTabs();

  return (
    <div className={styles.panels}>
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
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
