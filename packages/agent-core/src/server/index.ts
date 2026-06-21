import 'dotenv/config';

import { serve } from '@hono/node-server';
import { app } from './app.js';

const port = Number(process.env.PORT ?? process.env.AGENT_CORE_PORT ?? 4000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[agent-core] HTTP 服务已启动 http://127.0.0.1:${info.port}`);
});
