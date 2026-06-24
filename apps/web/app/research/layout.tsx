import { Suspense } from 'react';

export default function ResearchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <Suspense fallback={<main className="page list-loading">加载研究页…</main>}>{children}</Suspense>;
}
