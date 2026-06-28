import { describe, expect, it } from 'vitest';
import {
  createExpiredLocalSessionCookie,
  createLocalSessionCookie,
  encodeAuthSession,
  isValidLocalSession,
  LOCAL_AUTH_COOKIE,
  parseAuthSession,
  parseSessionUsername,
} from './auth-session';

describe('auth session', () => {
  it('creates and validates a signed session cookie', async () => {
    const session = await createLocalSessionCookie({
      username: 'demo_user',
      role: 'member',
      plan: 'free',
    });

    expect(session.name).toBe(LOCAL_AUTH_COOKIE);
    expect(session.options.httpOnly).toBe(true);
    expect(await parseSessionUsername(session.value)).toBe('demo_user');
    expect(await isValidLocalSession(session.value)).toBe(true);
    expect(await isValidLocalSession(undefined)).toBe(false);

    const parsed = await parseAuthSession(session.value);
    expect(parsed?.plan).toBe('free');
    expect(parsed?.permissions).toEqual([]);
  });

  it('derives pro permissions from plan in session', async () => {
    const session = await createLocalSessionCookie({
      username: 'pro_user',
      role: 'member',
      plan: 'pro',
    });
    const parsed = await parseAuthSession(session.value);
    expect(parsed?.permissions).toEqual(['monitor', 'screen', 'backtest']);
  });

  it('rejects tampered session payloads', async () => {
    const token = await encodeAuthSession({
      username: 'demo_user',
      role: 'member',
      plan: 'free',
    });
    const tampered = `${token}x`;
    expect(await parseAuthSession(tampered)).toBeNull();
  });

  it('creates an expired local session cookie for logout', () => {
    const session = createExpiredLocalSessionCookie();

    expect(session.name).toBe(LOCAL_AUTH_COOKIE);
    expect(session.value).toBe('');
    expect(session.options.maxAge).toBe(0);
  });
});
