'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BetaBadge } from '@/components/BetaBadge';
import { ContactXButton } from '@/components/ContactXButton';
import { siteConfig } from '@/lib/site-config';

const navItems = [
  { href: '/', label: '首页' },
  { href: '/download', label: '下载' },
  { href: '/docs', label: '教程' },
  { href: '/feedback', label: '反馈' },
];

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/" className="site-brand">
          <span className="site-brand-mark">IA</span>
          <span className="site-brand-text">{siteConfig.name}</span>
        </Link>

        <nav className="site-nav" aria-label="主导航">
          {navItems.map((item) => {
            const active =
              item.href === '/'
                ? pathname === '/'
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`site-nav-link${active ? ' site-nav-link--active' : ''}`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="site-header-actions">
          <BetaBadge />
          <ContactXButton source="nav" size="sm">
            反馈
          </ContactXButton>
          <Link href="/download" className="btn btn--primary btn--sm">
            下载
          </Link>
        </div>
      </div>
    </header>
  );
}
