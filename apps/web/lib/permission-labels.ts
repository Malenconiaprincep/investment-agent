import type { AppPermission } from './permissions';

export const PERMISSION_OPTIONS: Array<{
  value: AppPermission;
  label: string;
  description: string;
}> = [
  { value: 'monitor', label: '消息雷达', description: '实时消息雷达与信号扫描' },
  { value: 'backtest', label: '策略回测', description: '回测页与选股事后表现' },
  { value: 'screen', label: '智能选股', description: 'AI 板块选股流程' },
  { value: 'research', label: '单股分析', description: '五步 Research 工作流' },
  { value: 'committee', label: '投委会', description: '选股投委会评审' },
  { value: 'signals', label: '钻石扫描', description: '跟踪池信号扫描' },
  { value: 'etf_pick', label: 'ETF 推荐', description: 'ETF 尾盘推荐生成' },
  { value: 'admin', label: '后台管理', description: '用户权限与密码管理' },
];

export { PLAN_OPTIONS } from '@/lib/plan-permissions';

export function permissionLabel(value: AppPermission): string {
  return PERMISSION_OPTIONS.find((item) => item.value === value)?.label ?? value;
}
