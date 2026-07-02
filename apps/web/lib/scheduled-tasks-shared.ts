import type { AppPlan, AppRole } from '@/lib/permissions';

export function canUseScheduledTasks(input?: {
  role?: AppRole;
  plan?: AppPlan;
}): boolean {
  if (!input) return false;
  return (
    input.role === 'admin' ||
    input.plan === 'pro' ||
    input.plan === 'enterprise'
  );
}
