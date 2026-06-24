'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useWatchlistPanel } from '@/components/WatchlistPanelContext';

type NavItem = {
  href: string;
  label: string;
  isActive: (pathname: string) => boolean;
};

const NAV: NavItem[] = [
  {
    href: '/monitor',
    label: '雷达',
    isActive: (pathname) =>
      pathname === '/monitor' ||
      pathname.startsWith('/monitor/') ||
      pathname === '/screen' ||
      pathname.startsWith('/screen/'),
  },
  {
    href: '/paper',
    label: '模拟盘',
    isActive: (pathname) =>
      pathname === '/paper' || pathname.startsWith('/paper/'),
  },
  {
    href: '/etf',
    label: 'ETF',
    isActive: (pathname) => pathname === '/etf' || pathname.startsWith('/etf/'),
  },
  {
    href: '/research',
    label: '单股分析',
    isActive: (pathname) =>
      pathname === '/research' ||
      pathname.startsWith('/research/') ||
      pathname === '/history' ||
      pathname.startsWith('/history/') ||
      pathname === '/reviews' ||
      pathname.startsWith('/reviews/'),
  },
];

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
  const { toggle, open, itemCount } = useWatchlistPanel();

  if (pathname === '/login') {
    return null;
  }

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/monitor" className="site-brand">
          <span className="site-brand-mark" aria-hidden>
            IA
          </span>
          <span className="site-brand-text">投研助手</span>
        </Link>

        <nav className="site-nav" aria-label="主导航">
          {NAV.map((item) => {
            const active = item.isActive(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`site-nav-link${active ? ' site-nav-link--active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="site-header-actions">
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

          <form action="/api/auth/logout" method="post">
            <button className="site-nav-button" type="submit">
              退出
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
