import type { MonitorAlert } from './store.js';
import {
  getMonitorRuntimeState,
  setMonitorRuntimeState,
} from './store.js';

export type AutoTrackMode = 'balanced' | 'aggressive' | 'notify_only';

export const AUTO_TRACK_MODE_LABEL: Record<AutoTrackMode, string> = {
  balanced: '均衡（推荐）',
  aggressive: '积极',
  notify_only: '仅提醒',
};

export const WATCHLIST_POOL_LIMIT = 20;

const AUTO_TRACK_STATE_KEY = 'auto-track-mode';

const OVERHEAT_DAILY_PCT = 7;
const OVERHEAT_RET20_PCT = 30;
const NEWS_CATALYST_MAX_PCT = 3;

export type AutoTrackDecision = {
  shouldTrack: boolean;
  reason: string;
};

export type AutoTrackRuleItem = {
  label: string;
  detail: string;
};

export function resolveAutoTrackModeFromEnv(): AutoTrackMode {
  const raw = process.env.MONITOR_AUTO_TRACK?.trim().toLowerCase();
  if (raw === 'aggressive' || raw === 'notify_only') return raw;
  return 'balanced';
}

export async function getAutoTrackMode(): Promise<AutoTrackMode> {
  const stored = await getMonitorRuntimeState(AUTO_TRACK_STATE_KEY);
  const mode = stored?.mode;
  if (mode === 'balanced' || mode === 'aggressive' || mode === 'notify_only') {
    return mode;
  }
  return resolveAutoTrackModeFromEnv();
}

export async function setAutoTrackMode(mode: AutoTrackMode): Promise<void> {
  await setMonitorRuntimeState(AUTO_TRACK_STATE_KEY, {
    mode,
    updatedAt: new Date().toISOString(),
  });
}

function isStName(name: string | null): boolean {
  if (!name) return false;
  return /^\*?ST/i.test(name.trim()) || name.includes('ST');
}

function isOverheated(alert: MonitorAlert): string | null {
  if (alert.pctChg != null && alert.pctChg > OVERHEAT_DAILY_PCT) {
    return `当日涨幅 ${alert.pctChg.toFixed(2)}% 已偏大，避免追高`;
  }
  if (alert.ret20dPct != null && alert.ret20dPct > OVERHEAT_RET20_PCT) {
    return `20 日涨幅 ${alert.ret20dPct.toFixed(2)}% 已偏高`;
  }
  return null;
}

export function evaluateAutoTrack(input: {
  alert: MonitorAlert;
  mode: AutoTrackMode;
  alreadyInWatchlist?: boolean;
}): AutoTrackDecision {
  const { alert, mode, alreadyInWatchlist } = input;

  if (!alert.symbol || !alert.name) {
    return { shouldTrack: false, reason: '未识别到有效标的' };
  }

  if (isStName(alert.name)) {
    return { shouldTrack: false, reason: 'ST 标的不自动加入跟踪池' };
  }

  if (mode === 'notify_only') {
    return { shouldTrack: false, reason: '当前为「仅提醒」模式，不自动加池' };
  }

  if (alert.alertType === 'theme_ignite' || !alert.symbol) {
    return { shouldTrack: false, reason: '主线快讯无个股，不加入跟踪池' };
  }

  if (alert.alertType === 'watchlist_surge') {
    return {
      shouldTrack: false,
      reason: alreadyInWatchlist
        ? '已在跟踪池，波动提醒不重复加池'
        : '自选波动提醒不自动加池',
    };
  }

  const overheat = isOverheated(alert);
  if (overheat) {
    return { shouldTrack: false, reason: overheat };
  }

  if (mode === 'aggressive') {
    if (
      alert.alertType === 'pre_move' ||
      alert.alertType === 'early_move' ||
      alert.alertType === 'news_catalyst' ||
      alert.alertType === 'watchlist_surge'
    ) {
      return { shouldTrack: true, reason: '积极模式：符合条件的提醒自动加池' };
    }
    return { shouldTrack: false, reason: '消息记录，不自动加池' };
  }

  // balanced (default)
  if (alert.alertType === 'pre_move' && alert.severity === 'urgent') {
    return { shouldTrack: true, reason: '潜伏催化且涨幅尚小，自动加入跟踪池' };
  }

  if (alert.alertType === 'early_move') {
    return { shouldTrack: true, reason: '主线温和启动，自动加入跟踪池' };
  }

  if (alert.alertType === 'news_catalyst') {
    if (alert.severity !== 'urgent') {
      return {
        shouldTrack: false,
        reason: '普通资讯催化仅提醒，不自动加池',
      };
    }
    if (alert.pctChg != null && alert.pctChg >= NEWS_CATALYST_MAX_PCT) {
      return {
        shouldTrack: false,
        reason: `新闻催化时涨幅已达 ${alert.pctChg.toFixed(2)}%，仅提醒`,
      };
    }
    return { shouldTrack: true, reason: '高优先级新闻催化且涨幅不大，自动加池' };
  }

  return { shouldTrack: false, reason: '未满足均衡模式自动加池条件' };
}

export function describeAutoTrackRules(mode: AutoTrackMode): AutoTrackRuleItem[] {
  const common: AutoTrackRuleItem[] = [
    {
      label: '过热过滤',
      detail: `当日涨幅 > ${OVERHEAT_DAILY_PCT}% 或 20 日 > ${OVERHEAT_RET20_PCT}% 不自动加池`,
    },
    { label: 'ST 标的', detail: '不自动加入跟踪池' },
    {
      label: '跟踪池上限',
      detail: `最多 ${WATCHLIST_POOL_LIMIT} 只，满员时新标的会加池失败`,
    },
  ];

  if (mode === 'notify_only') {
    return [
      {
        label: '仅提醒',
        detail: '雷达照常扫描并展示提醒，不自动写入跟踪池',
      },
      ...common,
    ];
  }

  if (mode === 'aggressive') {
    return [
      {
        label: '自动加池',
        detail: '潜伏、资讯、启动、自选波动等个股提醒均尝试加池（仍受过热/ST 过滤）',
      },
      ...common,
    ];
  }

  return [
    {
      label: '潜伏催化',
      detail: '高优先级 + 涨幅尚小 → 自动加池',
    },
    {
      label: '温和启动',
      detail: '主线温和走强 → 自动加池',
    },
    {
      label: '新闻催化',
      detail: `仅高优先级且当日涨幅 < ${NEWS_CATALYST_MAX_PCT}% → 自动加池`,
    },
    {
      label: '自选波动',
      detail: '已在池内，只提醒不重复加池',
    },
    {
      label: '主线快讯',
      detail: '无个股代码，仅展示资讯',
    },
    ...common,
  ];
}

export async function getAutoTrackSettings(watchlistCount: number) {
  const mode = await getAutoTrackMode();
  const envDefault = resolveAutoTrackModeFromEnv();
  return {
    mode,
    modeLabel: AUTO_TRACK_MODE_LABEL[mode],
    envDefault,
    envDefaultLabel: AUTO_TRACK_MODE_LABEL[envDefault],
    watchlistCount,
    watchlistLimit: WATCHLIST_POOL_LIMIT,
    rules: describeAutoTrackRules(mode),
  };
}
