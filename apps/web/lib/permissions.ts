/** 功能权限（可扩展为商业化套餐能力点） */
export type AppPermission =
  | 'backtest'
  | 'admin'
  | 'screen'
  | 'research'
  | 'committee'
  | 'signals'
  | 'etf_pick';

export type AppRole = 'member' | 'admin';

export function hasPermissionForUser(
  user: { permissions: AppPermission[] },
  permission: AppPermission,
): boolean {
  return user.permissions.includes(permission);
}

export function hasPermission(
  userId: string,
  permission: AppPermission,
  user?: { permissions: AppPermission[] },
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
  permissions: AppPermission[];
}): AppPermission[] {
  return user.permissions;
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
  return null;
}

export function canAccessPathWithPermissions(
  permissions: AppPermission[],
  pathname: string,
): boolean {
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
