const pushedUntil = new Map<string, number>();

export function shouldFeishuPushOnce(
  key: string,
  ttlMs = 24 * 60 * 60 * 1000,
): boolean {
  const now = Date.now();
  for (const [existingKey, expireAt] of pushedUntil) {
    if (expireAt <= now) pushedUntil.delete(existingKey);
  }
  const expireAt = pushedUntil.get(key);
  if (expireAt != null && expireAt > now) return false;
  pushedUntil.set(key, now + ttlMs);
  return true;
}

export function resetFeishuPushDedupeForTests() {
  pushedUntil.clear();
}

export function buildFeishuPushKey(
  category: string,
  symbol: string,
  tradeDate: string,
): string {
  return `${category}:${tradeDate}:${symbol}`;
}
