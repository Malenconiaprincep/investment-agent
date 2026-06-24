import { NextResponse } from 'next/server';
import {
  createLocalSessionCookie,
  validateLocalCredentials,
} from '@/lib/local-auth';
import { activateUserEnv } from '@/lib/user-env';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const form = await request.formData();
  const username = String(form.get('username') ?? '').trim();
  const password = String(form.get('password') ?? '');

  const userId = validateLocalCredentials({ username, password });
  if (!userId) {
    return NextResponse.redirect(new URL('/login?error=1', request.url), 303);
  }

  try {
    await activateUserEnv(userId);
  } catch (error) {
    const message = error instanceof Error ? error.message : '激活配置失败';
    const url = new URL('/login', request.url);
    url.searchParams.set('error', '2');
    url.searchParams.set('msg', message);
    return NextResponse.redirect(url, 303);
  }

  const next =
    String(form.get('next') ?? '').trim() ||
    new URL(request.url).searchParams.get('next') ||
    '/monitor';
  const response = NextResponse.redirect(new URL(next, request.url), 303);
  const session = createLocalSessionCookie(userId);
  response.cookies.set(session.name, session.value, session.options);
  return response;
}
