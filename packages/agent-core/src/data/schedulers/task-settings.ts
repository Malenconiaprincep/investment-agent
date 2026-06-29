import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../../mastra/config/paths.js';

export type ScheduledTaskId =
  | 'monitor-background'
  | 'screen-morning'
  | 'etf-morning-radar'
  | 'etf-morning-confirm'
  | 'etf-tail-pick'
  | 'stock-paper'
  | 'etf-paper-monitor'
  | 'stock-intraday-monitor';

export type ScheduledTaskStatus = {
  id: ScheduledTaskId;
  label: string;
  description: string;
  scheduleText: string;
  enabled: boolean;
};

type ScheduledTaskConfig = Partial<Record<ScheduledTaskId, boolean>>;

const CONFIG_PATH = path.join(DATA_DIR, 'scheduled-tasks.json');

const TASKS: Array<Omit<ScheduledTaskStatus, 'enabled'> & { defaultEnabled: boolean }> = [
  {
    id: 'monitor-background',
    label: '消息雷达轮询',
    description: '后台定时扫描候选池、跟踪池和主线快讯',
    scheduleText: '交易日轮询',
    defaultEnabled: true,
  },
  {
    id: 'screen-morning',
    label: '智能选股',
    description: '开盘集合竞价结束后自动跑主线趋势选股并保存记录',
    scheduleText: '交易日 09:25',
    defaultEnabled: true,
  },
  {
    id: 'etf-morning-radar',
    label: 'ETF 早盘异动雷达',
    description: '开盘后发现 ETF 板块异动，只提醒观察，不触发买入',
    scheduleText: '交易日 09:35',
    defaultEnabled: true,
  },
  {
    id: 'etf-morning-confirm',
    label: 'ETF 10点承接确认',
    description: '复查早盘异动 ETF 的承接和量能，等待尾盘确认',
    scheduleText: '交易日 10:00',
    defaultEnabled: true,
  },
  {
    id: 'etf-paper-monitor',
    label: 'ETF 模拟盘监听',
    description: '交易时段按配置间隔检查 ETF 模拟盘买卖信号',
    scheduleText: '交易时段轮询',
    defaultEnabled: true,
  },
  {
    id: 'stock-intraday-monitor',
    label: '股票实时信号扫描',
    description: '交易时段扫描自选 / 选股池里的红钻与动量信号',
    scheduleText: '交易时段轮询',
    defaultEnabled: true,
  },
  {
    id: 'etf-tail-pick',
    label: 'ETF 尾盘推荐',
    description: '收盘前根据 ETF 池和规则生成尾盘参考',
    scheduleText: '交易日 14:45',
    defaultEnabled: true,
  },
  {
    id: 'stock-paper',
    label: '股票模拟盘选股',
    description: '收盘后运行股票模拟盘自动选股流程',
    scheduleText: '交易日 15:05',
    defaultEnabled: true,
  },
];

function readConfig(): ScheduledTaskConfig {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    const parsed = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as Record<
      string,
      unknown
    >;
    const config: ScheduledTaskConfig = {};
    for (const task of TASKS) {
      const enabled = parsed[task.id];
      if (typeof enabled === 'boolean') {
        config[task.id] = enabled;
      }
    }
    return config;
  } catch {
    return {};
  }
}

function writeConfig(config: ScheduledTaskConfig) {
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}

export function listScheduledTasks(): ScheduledTaskStatus[] {
  const config = readConfig();
  return TASKS.map((task) => ({
    id: task.id,
    label: task.label,
    description: task.description,
    scheduleText: task.scheduleText,
    enabled: config[task.id] ?? task.defaultEnabled,
  }));
}

export function isScheduledTaskEnabled(id: ScheduledTaskId): boolean {
  return listScheduledTasks().find((task) => task.id === id)?.enabled ?? true;
}

export function updateScheduledTask(
  id: ScheduledTaskId,
  enabled: boolean,
): ScheduledTaskStatus[] {
  if (!TASKS.some((task) => task.id === id)) {
    throw new Error(`未知定时任务: ${id}`);
  }

  const config = readConfig();
  config[id] = enabled;
  writeConfig(config);
  return listScheduledTasks();
}
