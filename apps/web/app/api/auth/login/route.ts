import { NextResponse } from 'next/server';
import {
  createLocalSessionCookie,
} from '@/lib/local-auth';
import {
  touchMarketUserLogin,
  verifyMarketUserPassword,
} from '@/lib/market-users';
import { activateUserEnv } from '@/lib/user-env';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const form = await request.formData();
  const username = String(form.get('username') ?? '').trim();
  const password = String(form.get('password') ?? '');

  let user;
  try {
    user = await verifyMarketUserPassword(username, password);
  } catch (error) {
    const message = error instanceof Error ? error.message : '登录失败';
    const url = new URL('/login', request.url);
    url.searchParams.set('error', '3');
    url.searchParams.set('msg', message);
    return NextResponse.redirect(url, 303);
  }

  if (!user) {
    return NextResponse.redirect(new URL('/login?error=1', request.url), 303);
  }

  const isDesktop = process.env.INVESTMENT_AGENT_DESKTOP === '1';

  try {
    await activateUserEnv(user.username, user.presetTokens);
    await touchMarketUserLogin(user.username);
  } catch (error) {
    if (!isDesktop) {
      const message = error instanceof Error ? error.message : '激活配置失败';
      const url = new URL('/login', request.url);
      url.searchParams.set('error', '2');
      url.searchParams.set('msg', message);
      return NextResponse.redirect(url, 303);
    }
    console.warn('[desktop] Token 同步失败，仍允许登录:', error);
    try {
      await touchMarketUserLogin(user.username);
    } catch {
      // ignore
    }
  }

  const next =
    String(form.get('next') ?? '').trim() ||
    new URL(request.url).searchParams.get('next') ||
    '/monitor';

  let session;
  try {
    session = await createLocalSessionCookie({
      username: user.username,
      role: user.role,
      permissions: user.permissions,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '创建登录会话失败';
    const url = new URL('/login', request.url);
    url.searchParams.set('error', '3');
    url.searchParams.set('msg', message);
    return NextResponse.redirect(url, 303);
  }

  const response = NextResponse.redirect(new URL(next, request.url), 303);
  response.cookies.set(session.name, session.value, session.options);
  return response;
}
