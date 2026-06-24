import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Tool } from '@mastra/core/tools';
import { noopObserve } from '@mastra/core/tools';
import { MCPClient } from '@mastra/mcp';
import { PACKAGE_ROOT } from '../config/paths.js';

/** 投研 Agent 核心工具 */
export const IWENCAI_CORE_TOOLS = [
  'hithink_market_query',
  'hithink_finance_query',
  'news_search',
  'announcement_search',
] as const;

/** 板块轮动 / 选股 Workflow 工具 */
export const IWENCAI_SCREEN_TOOLS = [
  'hithink_sector_selector',
  'hithink_astock_selector',
  'hithink_industry_query',
] as const;

export const IWENCAI_ALL_TOOLS = [
  ...IWENCAI_CORE_TOOLS,
  ...IWENCAI_SCREEN_TOOLS,
] as const;

export type IwencaiToolName = (typeof IWENCAI_ALL_TOOLS)[number];

const SERVER_NAME = 'iwencai';

let client: MCPClient | null = null;
let cachedCoreTools: Record<string, Tool> | null = null;
let cachedAllTools: Record<string, Tool> | null = null;

function resolveIwencaiServerPath(): string {
  const configured = process.env.IWENCAI_MCP_SERVER_PATH?.trim();
  if (configured) {
    return configured;
  }

  const packageRoot = PACKAGE_ROOT;
  return path.join(packageRoot, 'vendor/iwencai-mcp/server.py');
}

export function isIwencaiMcpConfigured(): boolean {
  return Boolean(process.env.IWENCAI_API_KEY?.trim());
}

export function getIwencaiMcpClient(): MCPClient {
  if (!isIwencaiMcpConfigured()) {
    throw new Error('IWENCAI_API_KEY 未设置');
  }

  if (client) {
    return client;
  }

  const serverPath = resolveIwencaiServerPath();
  if (!existsSync(serverPath)) {
    throw new Error(
      `问财 MCP server 不存在: ${serverPath}。请运行 pnpm setup:iwencai`,
    );
  }

  client = new MCPClient({
    id: 'iwencai-mcp-client',
    servers: {
      [SERVER_NAME]: {
        command: 'python3',
        args: [serverPath],
        env: {
          IWENCAI_API_KEY: process.env.IWENCAI_API_KEY!,
          IWENCAI_BASE_URL:
            process.env.IWENCAI_BASE_URL ?? 'https://openapi.iwencai.com',
        },
      },
    },
    timeout: 60_000,
  });

  return client;
}

function pickTools(
  tools: Record<string, Tool>,
  allowedNames: readonly string[],
): Record<string, Tool> {
  const allowed = new Set(
    allowedNames.map((name) => `${SERVER_NAME}_${name}`),
  );
  const picked: Record<string, Tool> = {};

  for (const [name, tool] of Object.entries(tools)) {
    if (allowed.has(name)) {
      picked[name] = tool;
    }
  }

  return picked;
}

async function loadIwencaiToolsSubset(
  allowedNames: readonly string[],
  label: string,
): Promise<Record<string, Tool>> {
  if (!isIwencaiMcpConfigured()) {
    console.warn('[iwencai-mcp] IWENCAI_API_KEY 未设置，跳过问财 MCP 工具');
    return {};
  }

  try {
    const mcp = getIwencaiMcpClient();
    const tools = await mcp.listTools();
    const picked = pickTools(tools, allowedNames);

    if (Object.keys(picked).length === 0) {
      console.warn(`[iwencai-mcp] 未找到 ${label} 工具，请检查 MCP Server`);
      return {};
    }

    console.info(
      `[iwencai-mcp] 已加载 ${Object.keys(picked).length} 个${label}工具: ${Object.keys(picked).join(', ')}`,
    );
    return picked;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[iwencai-mcp] ${label}工具加载失败: ${message}`);
    return {};
  }
}

export async function loadIwencaiCoreTools(): Promise<Record<string, Tool>> {
  const core = await loadIwencaiToolsSubset(IWENCAI_CORE_TOOLS, '核心');
  cachedCoreTools = core;
  return core;
}

export async function loadIwencaiScreenTools(): Promise<Record<string, Tool>> {
  return loadIwencaiToolsSubset(
    [...IWENCAI_CORE_TOOLS, ...IWENCAI_SCREEN_TOOLS],
    '选股',
  );
}

function normalizeIwencaiToolResult(raw: unknown): unknown {
  if (raw == null || typeof raw !== 'object') {
    return raw;
  }

  if ('content' in raw) {
    const content = (raw as { content?: Array<{ type: string; text?: string }> })
      .content;
    const text = content?.find((part) => part.type === 'text')?.text;
    if (text) {
      try {
        return JSON.parse(text) as unknown;
      } catch {
        return text;
      }
    }
  }

  return raw;
}

export async function getIwencaiCoreToolMap(): Promise<Record<string, Tool>> {
  if (cachedCoreTools) {
    return cachedCoreTools;
  }
  return loadIwencaiCoreTools();
}

async function getIwencaiAllToolMap(): Promise<Record<string, Tool>> {
  if (cachedAllTools) {
    return cachedAllTools;
  }

  if (!isIwencaiMcpConfigured()) {
    return {};
  }

  try {
    const mcp = getIwencaiMcpClient();
    const tools = await mcp.listTools();
    cachedAllTools = pickTools(tools, IWENCAI_ALL_TOOLS);
    return cachedAllTools;
  } catch {
    return {};
  }
}

/** Workflow / 脚本直接调用问财 MCP 工具（不经 LLM） */
export async function callIwencaiTool(
  toolName: IwencaiToolName,
  input: { query: string; page?: string; limit?: string; timeout?: number },
): Promise<unknown> {
  const tools = await getIwencaiAllToolMap();
  const key = `${SERVER_NAME}_${toolName}`;
  const tool = tools[key];

  if (!tool?.execute) {
    throw new Error(`问财工具不可用: ${key}`);
  }

  const raw = await tool.execute(input, { observe: noopObserve });
  return normalizeIwencaiToolResult(raw);
}

/** @deprecated 使用 callIwencaiTool */
export async function callIwencaiCoreTool(
  toolName: (typeof IWENCAI_CORE_TOOLS)[number],
  input: { query: string; page?: string; limit?: string; timeout?: number },
): Promise<unknown> {
  return callIwencaiTool(toolName, input);
}

/** 注册到 Mastra.mcpServers，供 Studio「MCP Servers」页展示 */
export function loadIwencaiMcpServerProxies() {
  if (!isIwencaiMcpConfigured()) {
    return {};
  }

  try {
    const proxies = getIwencaiMcpClient().toMCPServerProxies();
    console.info(
      `[iwencai-mcp] 已注册 Studio MCP Server: ${Object.keys(proxies).join(', ')}`,
    );
    return proxies;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[iwencai-mcp] Studio MCP Server 注册失败: ${message}`);
    return {};
  }
}

export async function disconnectIwencaiMcp(): Promise<void> {
  if (!client) {
    return;
  }

  await client.disconnect();
  client = null;
  cachedCoreTools = null;
  cachedAllTools = null;
}
