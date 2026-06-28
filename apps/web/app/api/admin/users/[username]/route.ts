import { NextResponse } from 'next/server';
import { z } from 'zod';
import { updateMarketUser } from '@/lib/market-users';
import { requirePermission } from '@/lib/session';

export const runtime = 'nodejs';

const patchSchema = z.object({
  label: z.string().trim().min(1).max(64).optional(),
  role: z.enum(['member', 'admin']).optional(),
  plan: z.enum(['free', 'pro', 'enterprise']).optional(),
  permissions: z
    .array(
      z.enum([
        'backtest',
        'admin',
        'screen',
        'research',
        'committee',
        'signals',
        'etf_pick',
        'monitor',
      ]),
    )
    .optional(),
  isActive: z.boolean().optional(),
});

type RouteContext = {
  params: Promise<{ username: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await requirePermission('admin');
    const { username } = await context.params;
    const json: unknown = await request.json();
    const parsed = patchSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? '参数无效' },
        { status: 400 },
      );
    }

    if (actor === username) {
      if (parsed.data.isActive === false) {
        return NextResponse.json(
          { error: '不能停用自己的账号' },
          { status: 400 },
        );
      }
      if (
        parsed.data.permissions &&
        !parsed.data.permissions.includes('admin')
      ) {
        return NextResponse.json(
          { error: '不能移除自己的后台管理权限' },
          { status: 400 },
        );
      }
      if (parsed.data.role === 'member') {
        return NextResponse.json(
          { error: '不能将自己的角色降为 member' },
          { status: 400 },
        );
      }
    }

    const user = await updateMarketUser(username, parsed.data);
    return NextResponse.json({ user });
  } catch (error) {
    const message = error instanceof Error ? error.message : '保存失败';
    const status = message.includes('登录')
      ? 401
      : message.includes('无权')
        ? 403
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
