import { NextResponse } from 'next/server';
import {
  createLocalSessionCookie,
  validateLocalCredentials,
} from '@/lib/local-auth';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const form = await request.formData();
  const username = String(form.get('username') ?? '');
  const password = String(form.get('password') ?? '');

  if (!validateLocalCredentials({ username, password })) {
    return NextResponse.redirect(new URL('/login?error=1', request.url), 303);
  }

  const response = NextResponse.redirect(new URL('/', request.url), 303);
  const session = createLocalSessionCookie();
  response.cookies.set(session.name, session.value, session.options);
  return response;
}
