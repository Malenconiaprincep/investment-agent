import 'dotenv/config';

import { serve } from '@hono/node-server';
import { app } from './app.js';
import { startMonitorBackgroundWorker } from '../data/monitor/background.js';
import { startDailyTasksBackgroundWorker } from '../data/schedulers/daily-tasks-background.js';
import { ensureFeishuEnvFromFallback } from './env-config.js';

const port = Number(process.env.PORT ?? process.env.AGENT_CORE_PORT ?? 4000);

ensureFeishuEnvFromFallback();

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[agent-core] HTTP 服务已启动 http://127.0.0.1:${info.port}`);
  startMonitorBackgroundWorker();
  startDailyTasksBackgroundWorker();
});
