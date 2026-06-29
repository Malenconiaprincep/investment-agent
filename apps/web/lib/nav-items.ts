import type { AppPermission, AppRole } from '@/lib/permissions';

export type NavItem = {
  href: string;
  label: string;
  permission?: AppPermission;
  isActive: (pathname: string) => boolean;
};

export const NAV_ITEMS: NavItem[] = [
  {
    href: '/watchlist',
    label: '跟踪池',
    isActive: (pathname) =>
      pathname === '/watchlist' || pathname.startsWith('/watchlist/'),
  },
  {
    href: '/research',
    label: '单股分析',
    isActive: (pathname) =>
      pathname === '/research' ||
      pathname.startsWith('/research/') ||
      pathname === '/history' ||
      pathname.startsWith('/history/') ||
      pathname === '/reviews' ||
      pathname.startsWith('/reviews/'),
  },
  {
    href: '/etf',
    label: 'ETF',
    isActive: (pathname) => pathname === '/etf' || pathname.startsWith('/etf/'),
  },
  {
    href: '/paper',
    label: '模拟盘',
    isActive: (pathname) =>
      pathname === '/paper' || pathname.startsWith('/paper/'),
  },
  {
    href: '/screen',
    label: '智能选股',
    permission: 'screen',
    isActive: (pathname) =>
      pathname === '/screen' || pathname.startsWith('/screen/'),
  },
  {
    href: '/backtest',
    label: '回测',
    permission: 'backtest',
    isActive: (pathname) =>
      pathname === '/backtest' || pathname.startsWith('/backtest/'),
  },
];

export function filterNavItems(
  permissions: AppPermission[],
  role?: AppRole,
): NavItem[] {
  if (role === 'admin') return NAV_ITEMS;
  return NAV_ITEMS.filter(
    (item) => !item.permission || permissions.includes(item.permission),
  );
}

export function primaryNavPath(): string {
  return NAV_ITEMS[0]?.href ?? '/research';
}

export function defaultNavPath(
  permissions: AppPermission[],
  role?: AppRole,
): string {
  return filterNavItems(permissions, role)[0]?.href ?? primaryNavPath();
}

export function resolveDefaultTabPath(pathname: string): string {
  const normalized = pathname.split('?')[0] || '/';
  if (normalized === '/') {
    return primaryNavPath();
  }
  return normalized;
}

export function normalizeTabPath(path: string): string {
  const withoutHash = path.split('#')[0] ?? path;
  return resolveDefaultTabPath(withoutHash.split('?')[0] || '/');
}

export function navLabelForPath(pathname: string): string {
  const normalized = pathname.split('?')[0]?.split('#')[0] ?? pathname;
  if (normalized === '/settings' || normalized.startsWith('/settings/')) {
    return '设置';
  }
  if (normalized === '/admin/users' || normalized.startsWith('/admin/')) {
    return '用户管理';
  }
  const match = NAV_ITEMS.find((item) => item.isActive(normalized));
  return match?.label ?? '页面';
}
