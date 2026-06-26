import { describe, expect, it, beforeEach } from 'vitest';
import {
  buildFeishuPushKey,
  resetFeishuPushDedupeForTests,
  shouldFeishuPushOnce,
} from './feishu-dedupe.js';

describe('feishu dedupe', () => {
  beforeEach(() => {
    resetFeishuPushDedupeForTests();
  });

  it('allows first push and blocks duplicate same day', () => {
    const key = buildFeishuPushKey('stock-intraday', '300014', '2026-06-25');
    expect(shouldFeishuPushOnce(key)).toBe(true);
    expect(shouldFeishuPushOnce(key)).toBe(false);
  });

  it('allows same symbol on different dates', () => {
    const keyA = buildFeishuPushKey('stock-intraday', '300014', '2026-06-25');
    const keyB = buildFeishuPushKey('stock-intraday', '300014', '2026-06-26');
    expect(shouldFeishuPushOnce(keyA)).toBe(true);
    expect(shouldFeishuPushOnce(keyB)).toBe(true);
  });
});
