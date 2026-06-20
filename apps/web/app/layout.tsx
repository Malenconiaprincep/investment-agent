import type { Metadata } from 'next';
import './globals.css';

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
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
