import { loadIwencaiCoreTools } from '../../mcp/iwencai.js';
import { getAnnouncementsTool } from '../../tools/market/announcements-tool.js';
import { getDailyQuoteTool } from '../../tools/market/daily-quote-tool.js';
import { getFinancialReportTool } from '../../tools/market/financial-report-tool.js';
import { searchNewsTool } from '../../tools/market/search-news-tool.js';
import { comparePeersTool } from '../../tools/market/compare-peers-tool.js';
import { researchNotesTool } from '../../tools/research-notes-tool.js';

export const committeeIwencaiTools = await loadIwencaiCoreTools();

export const COMMITTEE_OUTPUT_FORMAT = `
输出必须为 JSON（不要 markdown 代码块），格式：
{
  "symbol": "600519",
  "score": 1-10,
  "bullets": ["要点1", "要点2"],
  "risks": ["风险1"],
  "dataSources": ["eastmoney", "iwencai"]
}`;

export const committeeMarketTools = {
  searchNewsTool,
  getFinancialReportTool,
  getAnnouncementsTool,
  getDailyQuoteTool,
  comparePeersTool,
  researchNotesTool,
};
