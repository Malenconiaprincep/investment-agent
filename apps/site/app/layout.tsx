import type { Metadata } from 'next';
import { IBM_Plex_Sans, Noto_Serif_SC } from 'next/font/google';
import { Analytics } from '@vercel/analytics/react';
import { SiteHeader } from '@/components/SiteHeader';
import { SiteFooter } from '@/components/SiteFooter';
import { SiteBackground } from '@/components/SiteBackground';
import { siteConfig } from '@/lib/site-config';
import './globals.css';

const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans',
  display: 'swap',
});

const serif = Noto_Serif_SC({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: `${siteConfig.name} · Beta`,
    template: `%s · ${siteConfig.name}`,
  },
  description: siteConfig.description,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className={`${sans.variable} ${serif.variable}`}>
      <body>
        <SiteBackground />
        <div className="site-shell">
          <SiteHeader />
          <main className="site-main">{children}</main>
          <SiteFooter />
        </div>
        <Analytics />
      </body>
    </html>
  );
}
