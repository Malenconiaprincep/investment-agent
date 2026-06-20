import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { investmentAgent } from './agents/investment-agent';
import { reportWriterAgent } from './agents/report-writer-agent';
import { storage } from './memory';
import { researchVectors } from './vectors';
import { researchWorkflow } from './workflows/research-workflow';

export const mastra = new Mastra({
  agents: { investmentAgent, reportWriterAgent },
  workflows: { researchWorkflow },
  storage,
  vectors: { researchVectors },
  logger: new PinoLogger({
    name: 'InvestmentAgent',
    level: 'info',
  }),
});
