'use client';

import Link from 'next/link';
import { siteConfig } from '@/lib/site-config';
import { track } from '@/lib/analytics';

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <span>
          {siteConfig.name} · {siteConfig.version} · 学习研究用途，非投资建议
        </span>
        <div className="site-footer-links">
          <Link href="/docs/disclaimer">免责声明</Link>
          <Link href="/download">下载</Link>
          <a
            href={siteConfig.contactXUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => track('contact_x_click', { source: 'footer' })}
          >
            X
          </a>
        </div>
      </div>
    </footer>
  );
}
