import type { Metadata } from 'next';
import { IBM_Plex_Sans, Noto_Serif_SC } from 'next/font/google';
import { AppShell } from '@/components/AppShell';
import { SiteNav } from '@/components/SiteNav';
import { WatchlistPanelProvider } from '@/components/WatchlistPanelContext';
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
  title: '投研助手',
  description: 'A 股智能研报与热点选股，帮助个人投资者快速完成研究。',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className={`${sans.variable} ${serif.variable}`}>
      <body>
        <WatchlistPanelProvider>
          <SiteNav />
          <AppShell>{children}</AppShell>
        </WatchlistPanelProvider>
      </body>
    </html>
  );
}
