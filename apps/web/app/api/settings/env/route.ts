import { NextResponse } from 'next/server';
import { requireSessionUsername } from '@/lib/session';
import {
  getTokenConfigStatus,
  updateUserTokenConfig,
  type TokenKey,
} from '@/lib/user-env';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const username = await requireSessionUsername();
    const status = getTokenConfigStatus(username);
    return NextResponse.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : '加载失败';
    const status = message.includes('登录') ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(request: Request) {
  try {
    const username = await requireSessionUsername();
    const body = (await request.json()) as Partial<Record<TokenKey, string | null>>;
    const status = await updateUserTokenConfig(username, body);
    return NextResponse.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : '保存失败';
    const status = message.includes('登录') ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
