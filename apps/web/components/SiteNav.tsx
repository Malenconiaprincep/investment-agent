'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type NavItem = {
  href: string;
  label: string;
  isActive: (pathname: string) => boolean;
};

const NAV: NavItem[] = [
  {
    href: '/',
    label: '首页',
    isActive: (pathname) => pathname === '/',
  },
  {
    href: '/screen',
    label: '智能选股',
    isActive: (pathname) =>
      pathname === '/screen' || pathname.startsWith('/screen/'),
  },
  {
    href: '/monitor',
    label: '实时监控',
    isActive: (pathname) =>
      pathname === '/monitor' || pathname.startsWith('/monitor/'),
  },
  {
    href: '/watchlist',
    label: '我的自选',
    isActive: (pathname) =>
      pathname === '/watchlist' ||
      pathname.startsWith('/watchlist/') ||
      pathname === '/signals' ||
      pathname.startsWith('/signals/') ||
      pathname === '/paper' ||
      pathname.startsWith('/paper/') ||
      pathname === '/reviews' ||
      pathname.startsWith('/reviews/'),
  },
  {
    href: '/history',
    label: '我的研报',
    isActive: (pathname) =>
      pathname === '/history' || pathname.startsWith('/history/'),
  },
];

export function SiteNav() {
  const pathname = usePathname();

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/" className="site-brand">
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
      </div>
    </header>
  );
}
