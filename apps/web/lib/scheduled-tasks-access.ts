import { getMarketUserProfile, requireSessionUsername } from '@/lib/session';
import { canUseScheduledTasks } from '@/lib/scheduled-tasks-shared';

export { canUseScheduledTasks } from '@/lib/scheduled-tasks-shared';

export async function requireProScheduledTasks(): Promise<void> {
  await requireSessionUsername();
  const profile = await getMarketUserProfile();
  if (!profile) {
    throw new Error('请先登录');
  }
  if (!canUseScheduledTasks(profile)) {
    throw new Error('定时任务功能仅 Pro 及以上账号可用');
  }
}
