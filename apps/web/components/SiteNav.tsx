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
    href: '/research',
    label: '研究',
    isActive: (pathname) =>
      pathname === '/research' ||
      pathname.startsWith('/research/') ||
      pathname === '/history' ||
      pathname.startsWith('/history/') ||
      pathname === '/reviews' ||
      pathname.startsWith('/reviews/'),
  },
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
];

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
          <button
            type="button"
            className={`site-nav-link site-nav-link--panel${open ? ' site-nav-link--active' : ''}`}
            onClick={toggle}
            aria-expanded={open}
            aria-controls="watchlist-panel"
          >
            跟踪池
            {itemCount > 0 ? (
              <span className="site-nav-badge">{itemCount}</span>
            ) : null}
          </button>
        </nav>

        <form action="/api/auth/logout" method="post">
          <button className="site-nav-button" type="submit">
            退出
          </button>
        </form>
      </div>
    </header>
  );
}
