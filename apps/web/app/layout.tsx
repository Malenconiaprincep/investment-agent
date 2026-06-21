import type { Metadata } from 'next';
import { IBM_Plex_Sans, Noto_Serif_SC } from 'next/font/google';
import { SiteNav } from '@/components/SiteNav';
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
  title: 'A股投研助手',
  description: '基于 Mastra Workflow 的结构化 A 股投研报告',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className={`${sans.variable} ${serif.variable}`}>
      <body>
        <SiteNav />
        <div className="app-shell">{children}</div>
      </body>
    </html>
  );
}
