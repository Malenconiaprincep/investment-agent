const BEIJING_TZ = 'Asia/Shanghai';

function isBeijingTradingSessionFromIso(iso: string): boolean {
  const date = new Date(iso);
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: BEIJING_TZ,
    weekday: 'short',
  }).format(date);
  if (weekday === 'Sat' || weekday === 'Sun') return false;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BEIJING_TZ,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const minutes = hour * 60 + minute;
  const morning = minutes >= 9 * 60 + 30 && minutes <= 11 * 60 + 30;
  const afternoon = minutes >= 13 * 60 && minutes <= 15 * 60;
  return morning || afternoon;
}

export function formatPaperTradeDisplayTime(input: {
  tradeDate: string;
  tradedAt: string;
  source: 'manual' | 'auto';
  side: 'buy' | 'sell';
}): string {
  if (input.source === 'manual' || isBeijingTradingSessionFromIso(input.tradedAt)) {
    return new Date(input.tradedAt).toLocaleString('zh-CN', { timeZone: BEIJING_TZ });
  }
  const [y, m, d] = input.tradeDate.split('-');
  const time = input.side === 'buy' ? '14:30:00' : '15:00:00';
  return `${Number(y)}/${Number(m)}/${Number(d)} ${time}`;
}
