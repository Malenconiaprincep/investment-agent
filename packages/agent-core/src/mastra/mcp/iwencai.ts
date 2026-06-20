import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Tool } from '@mastra/core/tools';
import { MCPClient } from '@mastra/mcp';
import { DATA_DIR } from '../config/paths.js';

/** 首批接入的问财 MCP 核心工具（不含选股/宏观等扩展能力） */
export const IWENCAI_CORE_TOOLS = [
  'hithink_market_query',
  'hithink_finance_query',
  'news_search',
  'announcement_search',
] as const;

const SERVER_NAME = 'iwencai';

let client: MCPClient | null = null;

function resolveIwencaiServerPath(): string {
  const configured = process.env.IWENCAI_MCP_SERVER_PATH?.trim();
  if (configured) {
    return configured;
  }

  const packageRoot = path.join(DATA_DIR, '../..');
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

function pickCoreTools(
  tools: Record<string, Tool>,
): Record<string, Tool> {
  const allowed = new Set(
    IWENCAI_CORE_TOOLS.map((name) => `${SERVER_NAME}_${name}`),
  );
  const picked: Record<string, Tool> = {};

  for (const [name, tool] of Object.entries(tools)) {
    if (allowed.has(name)) {
      picked[name] = tool;
    }
  }

  return picked;
}

export async function loadIwencaiCoreTools(): Promise<Record<string, Tool>> {
  if (!isIwencaiMcpConfigured()) {
    console.warn('[iwencai-mcp] IWENCAI_API_KEY 未设置，跳过问财 MCP 工具');
    return {};
  }

  try {
    const mcp = getIwencaiMcpClient();
    const tools = await mcp.listTools();
    const core = pickCoreTools(tools);

    if (Object.keys(core).length === 0) {
      console.warn('[iwencai-mcp] 未找到核心工具，请检查 MCP Server');
      return {};
    }

    console.info(
      `[iwencai-mcp] 已加载 ${Object.keys(core).length} 个核心工具: ${Object.keys(core).join(', ')}`,
    );
    return core;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[iwencai-mcp] 加载失败，将仅使用本地行情工具: ${message}`);
    return {};
  }
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
}
