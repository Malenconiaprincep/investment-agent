import type { AppPermission, AppRole } from '@/lib/permissions';

export type AppPlan = 'free' | 'pro' | 'enterprise';

export const PLAN_PERMISSIONS: Record<AppPlan, AppPermission[]> = {
  free: [],
  pro: ['monitor', 'screen', 'backtest'],
  enterprise: [
    'monitor',
    'screen',
    'backtest',
    'research',
    'committee',
    'signals',
    'etf_pick',
  ],
};

export const PLAN_OPTIONS: Array<{
  value: AppPlan;
  label: string;
  description: string;
}> = [
  {
    value: 'free',
    label: 'Free · 免费版',
    description: '单股分析、ETF、跟踪池、模拟盘',
  },
  {
    value: 'pro',
    label: 'Pro · 专业版',
    description: '免费版 + 消息雷达、智能选股、策略回测',
  },
  {
    value: 'enterprise',
    label: 'Enterprise · 企业版',
    description: '专业版 + 投委会、钻石扫描、ETF 推荐等全部能力',
  },
];

export function permissionsForPlan(
  plan: AppPlan,
  role: AppRole,
): AppPermission[] {
  const permissions = [...PLAN_PERMISSIONS[plan]];
  if (role === 'admin') {
    permissions.push('admin');
  }
  return [...new Set(permissions)];
}

export function planLabel(plan: AppPlan): string {
  return PLAN_OPTIONS.find((item) => item.value === plan)?.label ?? plan;
}

export function planDescription(plan: AppPlan): string {
  return PLAN_OPTIONS.find((item) => item.value === plan)?.description ?? '';
}
