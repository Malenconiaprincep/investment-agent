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
    label: '研究',
    isActive: (pathname) => pathname === '/',
  },
  {
    href: '/screen',
    label: '扫描',
    isActive: (pathname) =>
      pathname === '/screen' ||
      pathname === '/monitor' ||
      pathname.startsWith('/monitor/'),
  },
  {
    href: '/watchlist',
    label: '跟踪',
    isActive: (pathname) =>
      pathname === '/watchlist' ||
      pathname.startsWith('/watchlist/') ||
      pathname === '/signals' ||
      pathname.startsWith('/signals/'),
  },
  {
    href: '/paper',
    label: '验证',
    isActive: (pathname) =>
      pathname === '/paper' ||
      pathname.startsWith('/paper/'),
  },
  {
    href: '/history',
    label: '档案',
    isActive: (pathname) =>
      pathname === '/history' ||
      pathname.startsWith('/history/') ||
      pathname === '/screen/history' ||
      pathname.startsWith('/screen/history/') ||
      pathname === '/reviews' ||
      pathname.startsWith('/reviews/'),
  },
];

export function SiteNav() {
  const pathname = usePathname();

  if (pathname === '/login') {
    return null;
  }

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

        <form action="/api/auth/logout" method="post">
          <button className="site-nav-button" type="submit">
            退出
          </button>
        </form>
      </div>
    </header>
  );
}
