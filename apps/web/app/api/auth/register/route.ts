import { NextResponse } from 'next/server';
import { createLocalSessionCookie } from '@/lib/local-auth';
import { createMarketUser } from '@/lib/market-users';
import { activateUserEnv } from '@/lib/user-env';
import { defaultNavPath } from '@/lib/nav-items';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const form = await request.formData();
  const username = String(form.get('username') ?? '').trim();
  const password = String(form.get('password') ?? '');
  const confirmPassword = String(form.get('confirmPassword') ?? '');

  if (password !== confirmPassword) {
    return NextResponse.redirect(
      new URL('/register?error=2&msg=两次输入的密码不一致', request.url),
      303,
    );
  }

  let user;
  try {
    user = await createMarketUser({ username, password });
  } catch (error) {
    const message = error instanceof Error ? error.message : '注册失败';
    const url = new URL('/register', request.url);
    if (message.includes('已被注册')) {
      url.searchParams.set('error', '1');
    } else if (message.includes('账号') || message.includes('密码')) {
      url.searchParams.set('error', '2');
      url.searchParams.set('msg', message);
    } else {
      url.searchParams.set('error', '3');
      url.searchParams.set('msg', message);
    }
    return NextResponse.redirect(url, 303);
  }

  try {
    await activateUserEnv(user.username, user.presetTokens);
  } catch (error) {
    const message = error instanceof Error ? error.message : '初始化配置失败';
    const url = new URL('/register', request.url);
    url.searchParams.set('error', '3');
    url.searchParams.set('msg', message);
    return NextResponse.redirect(url, 303);
  }

  const response = NextResponse.redirect(
    new URL(defaultNavPath(user.permissions, user.role), request.url),
    303,
  );
  const session = await createLocalSessionCookie({
    username: user.username,
    role: user.role,
    permissions: user.permissions,
  });
  response.cookies.set(session.name, session.value, session.options);
  return response;
}
