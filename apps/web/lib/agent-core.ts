type AgentCoreConfig = {
  baseUrl: string;
  token?: string;
};

export function getAgentCoreConfig(): AgentCoreConfig {
  const baseUrl = process.env.AGENT_CORE_URL?.trim().replace(/\/$/, '');
  if (!baseUrl) {
    throw new Error('未配置 AGENT_CORE_URL，请先启动 agent-core HTTP 服务');
  }
  const token = process.env.AGENT_CORE_TOKEN?.trim();
  return { baseUrl, token };
}

function buildHeaders(contentType = 'application/json'): HeadersInit {
  const { token } = getAgentCoreConfig();
  const headers: Record<string, string> = { 'Content-Type': contentType };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function readAgentCoreError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { error?: string };
    return parsed.error ?? text;
  } catch {
    return text || `agent-core 请求失败 (${response.status})`;
  }
}

export async function callAgentCoreCli(
  module: string,
  args: string[],
): Promise<string> {
  const { baseUrl } = getAgentCoreConfig();
  const response = await fetch(`${baseUrl}/cli/${module}`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({ args }),
  });

  if (!response.ok) {
    throw new Error(await readAgentCoreError(response));
  }

  return response.text();
}

export async function runAgentCoreJson(args: string[]): Promise<string> {
  return callAgentCoreCli('reports', args);
}

export async function runAgentCoreScreeningsJson(
  args: string[],
): Promise<string> {
  return callAgentCoreCli('screenings', args);
}

export async function runAgentCoreBatchResearch(
  symbols: string[],
): Promise<string> {
  return callAgentCoreCli('batch-research', symbols);
}

export async function runAgentCoreFeedback(args: string[]): Promise<string> {
  return callAgentCoreCli('feedback', args);
}

export async function runAgentCoreWatchlistJson(args: string[]): Promise<string> {
  return callAgentCoreCli('watchlist', args);
}

export async function runAgentCorePaperJson(args: string[]): Promise<string> {
  return callAgentCoreCli('paper', args);
}

export async function proxyAgentCoreStream(
  path: '/stream/research' | '/stream/screen' | '/stream/committee',
  body: unknown,
): Promise<Response> {
  const { baseUrl } = getAgentCoreConfig();
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(body),
  });
}
