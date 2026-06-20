import { Mastra } from '@mastra/core/mastra';
import { LibSQLStore } from '@mastra/libsql';
import { PinoLogger } from '@mastra/loggers';
import { investmentAgent } from './agents/investment-agent';

export const mastra = new Mastra({
  agents: { investmentAgent },
  storage: new LibSQLStore({
    id: 'mastra-storage',
    url: 'file:./mastra.db',
  }),
  logger: new PinoLogger({
    name: 'InvestmentAgent',
    level: 'info',
  }),
});
