import { SignJWT, jwtVerify } from 'jose';
import {
  permissionsForPlan,
  type AppPlan,
} from './plan-permissions';
import type { AppPermission, AppRole } from './permissions';

export const LOCAL_AUTH_COOKIE = 'investment_agent_local_session';

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export type AuthSession = {
  username: string;
  role: AppRole;
  plan: AppPlan;
  permissions: AppPermission[];
  exp: number;
};

export const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,32}$/;

export function isValidUsername(value: string): boolean {
  return USERNAME_PATTERN.test(value);
}

function getSessionSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SESSION_SECRET?.trim();
  if (secret) {
    return new TextEncoder().encode(secret);
  }
  if (process.env.INVESTMENT_AGENT_DESKTOP === '1') {
    return new TextEncoder().encode('desktop-local-auth-session-secret');
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('生产环境必须配置 AUTH_SESSION_SECRET');
  }
  return new TextEncoder().encode('dev-insecure-auth-session-secret');
}

function normalizePlan(value: unknown): AppPlan {
  if (value === 'pro' || value === 'enterprise') return value;
  return 'free';
}

export async function encodeAuthSession(input: {
  username: string;
  role: AppRole;
  plan: AppPlan;
}): Promise<string> {
  return new SignJWT({
    username: input.username,
    role: input.role,
    plan: input.plan,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getSessionSecretKey());
}

export async function parseAuthSession(
  value: string | undefined,
): Promise<AuthSession | null> {
  if (!value) return null;

  try {
    const { payload } = await jwtVerify(value, getSessionSecretKey(), {
      algorithms: ['HS256'],
    });

    const username = typeof payload.username === 'string' ? payload.username : '';
    const role = payload.role;
    const plan = normalizePlan(payload.plan);
    const exp = typeof payload.exp === 'number' ? payload.exp : 0;

    if (
      !isValidUsername(username) ||
      (role !== 'member' && role !== 'admin') ||
      exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return {
      username,
      role,
      plan,
      permissions: permissionsForPlan(plan, role),
      exp,
    };
  } catch {
    return null;
  }
}

export async function isValidLocalSession(
  value: string | undefined,
): Promise<boolean> {
  return (await parseAuthSession(value)) !== null;
}

export async function parseSessionUsername(
  value: string | undefined,
): Promise<string | null> {
  return (await parseAuthSession(value))?.username ?? null;
}

export async function createLocalSessionCookie(session: {
  username: string;
  role: AppRole;
  plan: AppPlan;
}) {
  return {
    name: LOCAL_AUTH_COOKIE,
    value: await encodeAuthSession(session),
    options: {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure:
        process.env.NODE_ENV === 'production' &&
        process.env.INVESTMENT_AGENT_DESKTOP !== '1',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    },
  };
}

export function createExpiredLocalSessionCookie() {
  return {
    name: LOCAL_AUTH_COOKIE,
    value: '',
    options: {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure:
        process.env.NODE_ENV === 'production' &&
        process.env.INVESTMENT_AGENT_DESKTOP !== '1',
      path: '/',
      maxAge: 0,
    },
  };
}
