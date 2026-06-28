import type { AppPermission } from '@/lib/permissions';

export type NavItem = {
  href: string;
  label: string;
  permission?: AppPermission;
  isActive: (pathname: string) => boolean;
};

export const NAV_ITEMS: NavItem[] = [
  {
    href: '/monitor',
    label: '雷达',
    isActive: (pathname) =>
      pathname === '/monitor' || pathname.startsWith('/monitor/'),
  },
  {
    href: '/screen',
    label: '智能选股',
    permission: 'screen',
    isActive: (pathname) =>
      pathname === '/screen' || pathname.startsWith('/screen/'),
  },
  {
    href: '/paper',
    label: '模拟盘',
    isActive: (pathname) =>
      pathname === '/paper' || pathname.startsWith('/paper/'),
  },
  {
    href: '/watchlist',
    label: '跟踪池',
    isActive: (pathname) =>
      pathname === '/watchlist' || pathname.startsWith('/watchlist/'),
  },
  {
    href: '/etf',
    label: 'ETF',
    isActive: (pathname) => pathname === '/etf' || pathname.startsWith('/etf/'),
  },
  {
    href: '/backtest',
    label: '回测',
    permission: 'backtest',
    isActive: (pathname) =>
      pathname === '/backtest' || pathname.startsWith('/backtest/'),
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
];

export function navLabelForPath(pathname: string): string {
  const match = NAV_ITEMS.find((item) => item.isActive(pathname));
  return match?.label ?? '页面';
}
