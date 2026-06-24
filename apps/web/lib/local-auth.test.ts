import { describe, expect, it } from 'vitest';
import {
  createExpiredLocalSessionCookie,
  createLocalSessionCookie,
  isValidLocalSession,
  LOCAL_AUTH_COOKIE,
  parseSessionUsername,
  validateLocalCredentials,
} from './local-auth';

describe('local auth', () => {
  it('accepts adminwb credentials', () => {
    expect(
      validateLocalCredentials({
        username: 'adminwb',
        password: 'Wb@Invest2026!xK9',
      }),
    ).toBe('adminwb');
  });

  it('accepts test credentials', () => {
    expect(
      validateLocalCredentials({
        username: 'test',
        password: 'test123456',
      }),
    ).toBe('test');
  });

  it('rejects invalid credentials', () => {
    expect(
      validateLocalCredentials({ username: 'adminwb', password: 'wrong' }),
    ).toBeNull();
    expect(
      validateLocalCredentials({ username: 'admin', password: 'admin' }),
    ).toBeNull();
  });

  it('creates and validates the local session cookie', () => {
    const session = createLocalSessionCookie('adminwb');

    expect(session.name).toBe(LOCAL_AUTH_COOKIE);
    expect(session.options.httpOnly).toBe(true);
    expect(session.options.sameSite).toBe('lax');
    expect(parseSessionUsername(session.value)).toBe('adminwb');
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
