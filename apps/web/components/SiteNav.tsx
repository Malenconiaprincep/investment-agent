'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { AuthHeader } from '@/components/AuthHeader';
import { useWatchlistPanel } from '@/components/WatchlistPanelContext';
import { WorkspaceTabBar } from '@/components/WorkspaceTabView';
import { useMountedWorkspaceTabs } from '@/components/WorkspaceTabsContext';
import { UserMenu } from '@/components/UserMenu';
import { useAuthUser } from '@/hooks/useAuthUser';
import { isAuthPath } from '@/lib/auth-paths';
import { defaultNavPath, filterNavItems } from '@/lib/nav-items';

function WatchlistIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function SiteNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { toggle, open, itemCount } = useWatchlistPanel();
  const { user } = useAuthUser();
  const {
    enabled: tabMode,
    toggleTabMode,
    openOrSwitchTab,
    openNewTab,
  } = useMountedWorkspaceTabs();

  if (searchParams.get('embed') === '1') {
    return null;
  }

  if (isAuthPath(pathname)) {
    return <AuthHeader />;
  }

  const visibleNav = filterNavItems(user?.permissions ?? [], user?.role);
  const homeHref = user
    ? defaultNavPath(user.permissions, user.role)
    : '/research';

  function handleTabLinkClick(
    event: React.MouseEvent,
    href: string,
  ) {
    if (!tabMode) return;
    event.preventDefault();
    if (event.metaKey || event.ctrlKey) {
      openNewTab(href);
      return;
    }
    openOrSwitchTab(href);
  }

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link
          href={homeHref}
          className="site-brand"
          onClick={(event) => handleTabLinkClick(event, homeHref)}
        >
          <span className="site-brand-mark" aria-hidden>
            IA
          </span>
          <span className="site-brand-text">投研助手</span>
        </Link>

        <nav className="site-nav" aria-label="主导航">
          {visibleNav.map((item) => {
            const active = !tabMode && item.isActive(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={
                  tabMode
                    ? 'site-nav-link site-nav-link--panel site-nav-link--tabAction'
                    : `site-nav-link${active ? ' site-nav-link--active' : ''}`
                }
                aria-current={active ? 'page' : undefined}
                onClick={(event) => handleTabLinkClick(event, item.href)}
                title={tabMode ? '打开或切换 Tab；⌘/Ctrl + 点击新开' : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="site-header-actions">
          <button
            type="button"
            className={`site-nav-button${tabMode ? ' site-nav-button--active' : ''}`}
            onClick={toggleTabMode}
            aria-pressed={tabMode}
            title="多 Tab 切换，保留各页面状态"
          >
            {tabMode ? '单页' : 'Tab'}
          </button>

          <button
            type="button"
            className={`site-nav-icon-button${open ? ' site-nav-icon-button--active' : ''}`}
            onClick={toggle}
            aria-label={
              itemCount > 0 ? `跟踪池，${itemCount} 只` : '跟踪池'
            }
            title="跟踪池"
            aria-expanded={open}
            aria-controls="watchlist-panel"
          >
            <WatchlistIcon />
            {itemCount > 0 ? (
              <span className="site-nav-icon-badge">{itemCount}</span>
            ) : null}
          </button>

          <UserMenu user={user} />
        </div>
      </div>
      {tabMode ? <WorkspaceTabBar /> : null}
    </header>
  );
}
