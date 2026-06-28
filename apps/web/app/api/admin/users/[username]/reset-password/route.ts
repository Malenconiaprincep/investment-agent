import { NextResponse } from 'next/server';
import { z } from 'zod';
import { resetMarketUserPassword } from '@/lib/market-users';
import { requirePermission } from '@/lib/session';

export const runtime = 'nodejs';

const bodySchema = z.object({
  password: z.string().min(8, '新密码至少 8 位'),
});

type RouteContext = {
  params: Promise<{ username: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    await requirePermission('admin');
    const { username } = await context.params;
    const json: unknown = await request.json();
    const parsed = bodySchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? '参数无效' },
        { status: 400 },
      );
    }

    await resetMarketUserPassword(username, parsed.data.password);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : '重置失败';
    const status = message.includes('登录')
      ? 401
      : message.includes('无权')
        ? 403
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
