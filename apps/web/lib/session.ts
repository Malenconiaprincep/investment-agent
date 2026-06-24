import { cookies } from 'next/headers';
import {
  LOCAL_AUTH_COOKIE,
  parseSessionUsername,
} from '@/lib/local-auth';
import type { AppUserId } from '@/lib/users';

export async function getSessionUsername(): Promise<AppUserId | null> {
  const cookieStore = await cookies();
  return parseSessionUsername(cookieStore.get(LOCAL_AUTH_COOKIE)?.value);
}

export async function requireSessionUsername(): Promise<AppUserId> {
  const username = await getSessionUsername();
  if (!username) {
    throw new Error('请先登录');
  }
  return username;
}
