import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { investmentAgent } from './agents/investment-agent';
import { storage } from './memory';
import { researchVectors } from './vectors';

export const mastra = new Mastra({
  agents: { investmentAgent },
  storage,
  vectors: { researchVectors },
  logger: new PinoLogger({
    name: 'InvestmentAgent',
    level: 'info',
  }),
});
