import { permissionsForPlan, type AppPlan } from './plan-permissions';

/** 功能权限（可扩展为商业化套餐能力点） */
export type AppPermission =
  | 'backtest'
  | 'admin'
  | 'screen'
  | 'research'
  | 'committee'
  | 'signals'
  | 'etf_pick'
  | 'monitor';

export type AppRole = 'member' | 'admin';

export type { AppPlan };

export function hasPermissionForUser(
  user: { role: AppRole; plan: AppPlan },
  permission: AppPermission,
): boolean {
  if (user.role === 'admin') return true;
  return permissionsForPlan(user.plan, user.role).includes(permission);
}

export function hasPermission(
  userId: string,
  permission: AppPermission,
  user?: { role: AppRole; plan: AppPlan },
): boolean {
  if (user) {
    return hasPermissionForUser(user, permission);
  }
  return false;
}

export function getUserRole(user: { role: AppRole }): AppRole {
  return user.role;
}

export function getUserPermissions(user: {
  role: AppRole;
  plan: AppPlan;
}): AppPermission[] {
  return permissionsForPlan(user.plan, user.role);
}

/** 路由 → 所需权限；未列出则登录即可访问 */
export function permissionForPath(pathname: string): AppPermission | null {
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return 'admin';
  }
  if (pathname === '/api/admin' || pathname.startsWith('/api/admin/')) {
    return 'admin';
  }
  if (pathname === '/backtest' || pathname.startsWith('/backtest/')) {
    return 'backtest';
  }
  if (pathname === '/api/backtest' || pathname.startsWith('/api/backtest/')) {
    return 'backtest';
  }
  if (/^\/api\/screenings\/[^/]+\/backtest$/.test(pathname)) {
    return 'backtest';
  }
  if (pathname === '/screen' || pathname.startsWith('/screen/')) {
    return 'screen';
  }
  if (pathname === '/api/screen' || pathname.startsWith('/api/screen/')) {
    return 'screen';
  }
  if (pathname === '/api/screenings' || pathname.startsWith('/api/screenings/')) {
    return 'screen';
  }
  if (pathname === '/monitor' || pathname.startsWith('/monitor/')) {
    return 'monitor';
  }
  if (pathname === '/api/monitor' || pathname.startsWith('/api/monitor/')) {
    return 'monitor';
  }
  return null;
}

export function canAccessPathWithPermissions(
  permissions: AppPermission[],
  pathname: string,
  role?: AppRole,
): boolean {
  if (role === 'admin') return true;
  const required = permissionForPath(pathname);
  if (!required) return true;
  return permissions.includes(required);
}

export function canAccessPath(
  permissions: AppPermission[],
  pathname: string,
): boolean {
  return canAccessPathWithPermissions(permissions, pathname);
}
