import { NextResponse } from 'next/server';
import { createExpiredLocalSessionCookie } from '@/lib/local-auth';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL('/login', request.url), 303);
  const session = createExpiredLocalSessionCookie();
  response.cookies.set(session.name, session.value, session.options);
  return response;
}
