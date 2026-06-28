import { NextResponse } from 'next/server';
import { getUserPermissions, getUserRole } from '@/lib/permissions';
import { getMarketUserProfile } from '@/lib/session';

export async function GET() {
  const user = await getMarketUserProfile();
  if (!user) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  return NextResponse.json({
    username: user.username,
    label: user.label,
    role: getUserRole(user),
    permissions: getUserPermissions(user),
    plan: user.plan,
  });
}
