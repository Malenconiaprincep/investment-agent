import { NextResponse } from 'next/server';
import { listMarketUsersPaginated } from '@/lib/market-users';
import { requirePermission } from '@/lib/session';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    await requirePermission('admin');
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number(searchParams.get('pageSize') ?? '10') || 10),
    );

    const result = await listMarketUsersPaginated({ page, pageSize });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : '加载失败';
    const status = message.includes('登录')
      ? 401
      : message.includes('无权')
        ? 403
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
