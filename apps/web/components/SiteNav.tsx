'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV = [
  { href: '/', label: '工作台' },
  { href: '/screen', label: '自动选股' },
  { href: '/screen/history', label: '选股历史' },
  { href: '/history', label: '研报历史' },
] as const;

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
            const active =
              item.href === '/'
                ? pathname === '/'
                : pathname === item.href ||
                  pathname.startsWith(`${item.href}/`);
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
