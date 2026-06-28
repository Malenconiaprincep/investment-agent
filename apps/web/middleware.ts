import { NextResponse, type NextRequest } from 'next/server';
import {
  LOCAL_AUTH_COOKIE,
  parseAuthSession,
} from '@/lib/local-auth';
import { isAuthPath } from '@/lib/auth-paths';
import { canAccessPathWithPermissions, permissionForPath } from '@/lib/permissions';

const PUBLIC_PATH_PREFIXES = [
  '/login',
  '/register',
  '/api/auth',
  '/_next',
  '/favicon.ico',
];

function isPublicPath(pathname: string): boolean {
  return (
    isAuthPath(pathname) ||
    PUBLIC_PATH_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    )
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const sessionValue = request.cookies.get(LOCAL_AUTH_COOKIE)?.value;
  const session = await parseAuthSession(sessionValue);

  if (!session) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 });
    }

    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (
    permissionForPath(pathname) &&
    !canAccessPathWithPermissions(session.permissions, pathname)
  ) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: '无权访问此功能' }, { status: 403 });
    }

    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = '/monitor';
    redirectUrl.searchParams.set('forbidden', permissionForPath(pathname)!);
    return NextResponse.redirect(redirectUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!.*\\..*).*)'],
};
