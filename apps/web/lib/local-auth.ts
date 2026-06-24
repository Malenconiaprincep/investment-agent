export const LOCAL_AUTH_COOKIE = 'investment_agent_local_session';

const LOCAL_ADMIN_USERNAME = 'admin';
const LOCAL_ADMIN_PASSWORD = 'admin';
const LOCAL_SESSION_VALUE = 'local-admin';

export function validateLocalCredentials(input: {
  username: string;
  password: string;
}): boolean {
  return (
    input.username === LOCAL_ADMIN_USERNAME &&
    input.password === LOCAL_ADMIN_PASSWORD
  );
}

export function isValidLocalSession(value: string | undefined): boolean {
  return value === LOCAL_SESSION_VALUE;
}

export function createLocalSessionCookie() {
  return {
    name: LOCAL_AUTH_COOKIE,
    value: LOCAL_SESSION_VALUE,
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
