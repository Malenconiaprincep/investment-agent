import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import {
  announcementAgent,
  committeeSupervisor,
  financialAgent,
  newsAgent,
  riskAgent,
  sentimentAgent,
  technicalAgent,
} from './agents/committee/committee-supervisor.js';
import { investmentAgent } from './agents/investment-agent';
import { reportWriterAgent } from './agents/report-writer-agent';
import { sectorRotationAgent } from './agents/sector-rotation-agent.js';
import { loadIwencaiMcpServerProxies } from './mcp/iwencai.js';
import { storage } from './memory';
import { researchVectors } from './vectors';
import { committeeWorkflow } from './workflows/committee-workflow.js';
import { researchWorkflow } from './workflows/research-workflow';
import { sectorScreenWorkflow } from './workflows/sector-screen-workflow.js';

const iwencaiMcpServers = loadIwencaiMcpServerProxies();

export const mastra = new Mastra({
  agents: {
    investmentAgent,
    reportWriterAgent,
    sectorRotationAgent,
    newsAgent,
    financialAgent,
    announcementAgent,
    technicalAgent,
    riskAgent,
    sentimentAgent,
    committeeSupervisor,
  },
  workflows: {
    researchWorkflow,
    sectorScreenWorkflow,
    committeeWorkflow,
  },
  // @ts-ignore
  mcpServers: iwencaiMcpServers,
  storage,
  vectors: { researchVectors },
  logger: new PinoLogger({
    name: 'InvestmentAgent',
    level: 'info',
  }),
});
