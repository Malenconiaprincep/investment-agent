import { NextResponse } from 'next/server';
import { requireSessionUsername, getMarketUserProfile } from '@/lib/session';
import {
  getTokenConfigStatus,
  updateUserTokenConfig,
  type TokenKey,
} from '@/lib/user-env';

export const runtime = 'nodejs';

export async function GET() {
  try {
    await requireSessionUsername();
    const profile = await getMarketUserProfile();
    if (!profile) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const status = getTokenConfigStatus({
      username: profile.username,
      userLabel: profile.label,
      presetTokens: profile.presetTokens,
    });
    return NextResponse.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : '加载失败';
    const status = message.includes('登录') ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(request: Request) {
  try {
    await requireSessionUsername();
    const profile = await getMarketUserProfile();
    if (!profile) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    const body = (await request.json()) as Partial<Record<TokenKey, string | null>>;
    const status = await updateUserTokenConfig(
      profile.username,
      profile.presetTokens,
      profile.label,
      body,
    );
    return NextResponse.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : '保存失败';
    const status = message.includes('登录') ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
