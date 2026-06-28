import { DocsLayout } from '@/components/DocsLayout';

export default function DocsRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DocsLayout>{children}</DocsLayout>;
}
