import { cookies } from 'next/headers';
import {
  LOCAL_AUTH_COOKIE,
  parseAuthSession,
  type AuthSession,
} from '@/lib/local-auth';
import type { AppPermission } from '@/lib/permissions';
import { hasPermissionForUser } from '@/lib/permissions';
import {
  findMarketUserByUsername,
  type MarketUser,
} from '@/lib/market-users';

export async function getAuthSession(): Promise<AuthSession | null> {
  const cookieStore = await cookies();
  return parseAuthSession(cookieStore.get(LOCAL_AUTH_COOKIE)?.value);
}

export async function getSessionUsername(): Promise<string | null> {
  return (await getAuthSession())?.username ?? null;
}

export async function requireSessionUsername(): Promise<string> {
  const username = await getSessionUsername();
  if (!username) {
    throw new Error('请先登录');
  }
  return username;
}

export async function getMarketUserProfile(): Promise<MarketUser | null> {
  const username = await getSessionUsername();
  if (!username) return null;

  const user = await findMarketUserByUsername(username);
  if (!user?.isActive) return null;

  const { passwordHash: _, ...profile } = user;
  return profile;
}

export async function requirePermission(
  permission: AppPermission,
): Promise<string> {
  const username = await requireSessionUsername();
  const user = await findMarketUserByUsername(username);

  if (!user?.isActive) {
    throw new Error('请先登录');
  }

  if (!hasPermissionForUser(user, permission)) {
    throw new Error('无权访问此功能');
  }

  return username;
}
