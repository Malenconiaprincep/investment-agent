import { describe, expect, it } from 'vitest';
import { permissionsForPlan } from './plan-permissions';

describe('plan-permissions', () => {
  it('maps free plan to base access only', () => {
    expect(permissionsForPlan('free', 'member')).toEqual([]);
  });

  it('maps pro plan to premium research tools', () => {
    expect(permissionsForPlan('pro', 'member')).toEqual([
      'monitor',
      'screen',
      'backtest',
    ]);
  });

  it('maps enterprise plan to all feature permissions', () => {
    expect(permissionsForPlan('enterprise', 'member')).toEqual([
      'monitor',
      'screen',
      'backtest',
      'research',
      'committee',
      'signals',
      'etf_pick',
    ]);
  });

  it('adds admin permission for admin role', () => {
    expect(permissionsForPlan('free', 'admin')).toEqual(['admin']);
    expect(permissionsForPlan('pro', 'admin')).toContain('admin');
    expect(permissionsForPlan('pro', 'admin')).toContain('monitor');
  });
});
