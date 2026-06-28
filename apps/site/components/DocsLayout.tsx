'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { docsNav } from '@/lib/docs-nav';
import { ContactXButton } from '@/components/ContactXButton';
import { DocsTracker } from '@/components/DocsTracker';

export function DocsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const slug = pathname.replace(/^\/docs\/?/, '') || 'index';

  return (
    <div className="page-container">
      <DocsTracker slug={slug} />
      <div className="docs-layout">
        <aside className="docs-sidebar" aria-label="教程目录">
          {docsNav.map((item) => {
            const active = item.exact
              ? pathname === item.href
              : pathname.startsWith(item.href) && item.href !== '/docs';
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`docs-nav-link${active ? ' docs-nav-link--active' : ''}`}
              >
                {item.label}
              </Link>
            );
          })}
        </aside>
        <div>
          <article className="prose">{children}</article>
          <div className="contact-cta">
            教程有疑问？请在{' '}
            <ContactXButton source="docs_footer" size="sm" /> 上联系我们。
          </div>
        </div>
      </div>
    </div>
  );
}
