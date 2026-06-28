import { describe, expect, it } from 'vitest';
import {
  canAccessPathWithPermissions,
  hasPermissionForUser,
  permissionForPath,
} from './permissions';

describe('permissions', () => {
  it('checks permissions on user profile', () => {
    const admin = { permissions: ['backtest', 'admin'] as const };
    const member = { permissions: [] as const };

    expect(hasPermissionForUser(admin, 'backtest')).toBe(true);
    expect(hasPermissionForUser(admin, 'admin')).toBe(true);
    expect(hasPermissionForUser(member, 'backtest')).toBe(false);
  });

  it('maps admin routes to admin permission', () => {
    expect(permissionForPath('/admin/users')).toBe('admin');
    expect(permissionForPath('/api/admin/users')).toBe('admin');
  });

  it('maps backtest routes to backtest permission', () => {
    expect(permissionForPath('/backtest')).toBe('backtest');
    expect(permissionForPath('/api/backtest')).toBe('backtest');
    expect(permissionForPath('/api/screenings/abc/backtest')).toBe('backtest');
    expect(permissionForPath('/monitor')).toBeNull();
  });

  it('maps screen routes to screen permission', () => {
    expect(permissionForPath('/screen')).toBe('screen');
    expect(permissionForPath('/screen/history')).toBe('screen');
    expect(permissionForPath('/api/screen')).toBe('screen');
    expect(permissionForPath('/api/screenings')).toBe('screen');
    expect(permissionForPath('/api/screenings/abc')).toBe('screen');
  });

  it('checks path access by permissions', () => {
    const pro = ['backtest', 'screen'] as const;
    const free = [] as const;

    expect(canAccessPathWithPermissions([...pro], '/backtest')).toBe(true);
    expect(canAccessPathWithPermissions([...free], '/backtest')).toBe(false);
    expect(canAccessPathWithPermissions([...pro], '/screen')).toBe(true);
    expect(canAccessPathWithPermissions([...free], '/screen')).toBe(false);
    expect(canAccessPathWithPermissions([...free], '/monitor')).toBe(true);
  });
});
