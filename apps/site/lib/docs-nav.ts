export const docsNav: Array<{
  href: string;
  label: string;
  exact?: boolean;
}> = [
  { href: '/docs', label: '教程索引', exact: true },
  { href: '/docs/quickstart', label: '安装与配置' },
  { href: '/docs/desktop', label: '桌面版' },
  { href: '/docs/features', label: '功能说明' },
  { href: '/docs/disclaimer', label: '免责声明' },
] as const;

export type DocsSlug = 'quickstart' | 'desktop' | 'features' | 'disclaimer';
