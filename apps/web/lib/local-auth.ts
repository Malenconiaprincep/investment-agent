import type { AppUserId } from './users';
import { APP_USERS, isAppUserId } from './users';

export const LOCAL_AUTH_COOKIE = 'investment_agent_local_session';

const SESSION_PREFIX = 'user:';

export function validateLocalCredentials(input: {
  username: string;
  password: string;
}): AppUserId | null {
  if (!isAppUserId(input.username)) return null;
  const user = APP_USERS[input.username];
  return input.password === user.password ? user.id : null;
}

export function createSessionValue(username: AppUserId): string {
  return `${SESSION_PREFIX}${username}`;
}

export function parseSessionUsername(
  value: string | undefined,
): AppUserId | null {
  if (!value?.startsWith(SESSION_PREFIX)) return null;
  const username = value.slice(SESSION_PREFIX.length);
  return isAppUserId(username) ? username : null;
}

export function isValidLocalSession(value: string | undefined): boolean {
  return parseSessionUsername(value) !== null;
}

export function createLocalSessionCookie(username: AppUserId) {
  return {
    name: LOCAL_AUTH_COOKIE,
    value: createSessionValue(username),
    options: {
      httpOnly: true,
      sameSite: 'lax' as const,
      secure:
        process.env.NODE_ENV === 'production' &&
        process.env.INVESTMENT_AGENT_DESKTOP !== '1',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
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
