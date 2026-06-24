import { NextResponse, type NextRequest } from 'next/server';
import { isValidLocalSession, LOCAL_AUTH_COOKIE } from '@/lib/local-auth';

const PUBLIC_PATH_PREFIXES = [
  '/login',
  '/api/auth',
  '/_next',
  '/favicon.ico',
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (process.env.INVESTMENT_AGENT_DESKTOP === '1') {
    return NextResponse.next();
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const session = request.cookies.get(LOCAL_AUTH_COOKIE)?.value;
  if (isValidLocalSession(session)) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 });
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = '/login';
  loginUrl.searchParams.set('next', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!.*\\..*).*)'],
};
