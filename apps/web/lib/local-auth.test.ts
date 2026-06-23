import { describe, expect, it } from 'vitest';
import {
  createExpiredLocalSessionCookie,
  createLocalSessionCookie,
  isValidLocalSession,
  LOCAL_AUTH_COOKIE,
  validateLocalCredentials,
} from './local-auth';

describe('local auth', () => {
  it('accepts the local admin credentials', () => {
    expect(
      validateLocalCredentials({ username: 'admin', password: 'admin' }),
    ).toBe(true);
  });

  it('rejects invalid credentials', () => {
    expect(
      validateLocalCredentials({ username: 'admin', password: 'wrong' }),
    ).toBe(false);
    expect(
      validateLocalCredentials({ username: 'user', password: 'admin' }),
    ).toBe(false);
  });

  it('creates and validates the local session cookie', () => {
    const session = createLocalSessionCookie();

    expect(session.name).toBe(LOCAL_AUTH_COOKIE);
    expect(session.options.httpOnly).toBe(true);
    expect(session.options.sameSite).toBe('lax');
    expect(isValidLocalSession(session.value)).toBe(true);
    expect(isValidLocalSession(undefined)).toBe(false);
  });

  it('creates an expired local session cookie for logout', () => {
    const session = createExpiredLocalSessionCookie();

    expect(session.name).toBe(LOCAL_AUTH_COOKIE);
    expect(session.value).toBe('');
    expect(session.options.maxAge).toBe(0);
  });
});
