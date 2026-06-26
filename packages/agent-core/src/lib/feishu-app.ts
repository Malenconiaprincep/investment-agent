import type { FeishuSendResult } from './feishu-webhook.js';

export type FeishuAppConfig = {
  appId: string;
  appSecret: string;
  chatId?: string;
};

type TokenResponse = {
  code?: number;
  msg?: string;
  tenant_access_token?: string;
  expire?: number;
};

type ApiResponse = {
  code?: number;
  msg?: string;
  data?: unknown;
};

export type FeishuChatSummary = {
  chatId: string;
  name: string;
};

type ChatsListResponse = {
  code?: number;
  msg?: string;
  data?: {
    items?: Array<{ chat_id?: string; name?: string }>;
    has_more?: boolean;
    page_token?: string;
  };
};

let tokenCache: { token: string; expireAt: number } | null = null;

export function resetFeishuAppTokenCacheForTests() {
  tokenCache = null;
}

export async function getFeishuTenantAccessToken(
  config: FeishuAppConfig,
): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expireAt - 60_000) {
    return tokenCache.token;
  }

  const response = await fetch(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        app_id: config.appId,
        app_secret: config.appSecret,
      }),
    },
  );

  const json = (await response.json()) as TokenResponse;
  if (!response.ok || json.code !== 0 || !json.tenant_access_token) {
    throw new Error(json.msg ?? `获取 tenant_access_token 失败（HTTP ${response.status}）`);
  }

  tokenCache = {
    token: json.tenant_access_token,
    expireAt: Date.now() + (json.expire ?? 7200) * 1000,
  };
  return tokenCache.token;
}

async function sendFeishuAppRaw(
  config: FeishuAppConfig,
  receiveId: string,
  msgType: string,
  content: Record<string, unknown>,
): Promise<FeishuSendResult> {
  const token = await getFeishuTenantAccessToken(config);
  const url = new URL('https://open.feishu.cn/open-apis/im/v1/messages');
  url.searchParams.set('receive_id_type', 'chat_id');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      receive_id: receiveId,
      msg_type: msgType,
      content: JSON.stringify(content),
    }),
  });

  const json = (await response.json()) as ApiResponse;
  if (!response.ok || json.code !== 0) {
    return {
      ok: false,
      error: json.msg ?? `HTTP ${response.status}`,
      status: response.status,
    };
  }
  return { ok: true, status: response.status };
}

export async function sendFeishuAppText(
  config: FeishuAppConfig,
  text: string,
  receiveId?: string,
): Promise<FeishuSendResult> {
  const chatId = receiveId ?? config.chatId;
  if (!chatId) {
    return { ok: false, error: '未配置 FEISHU_CHAT_ID（运行 pnpm feishu:chats 查询）' };
  }
  return sendFeishuAppRaw(config, chatId, 'text', { text });
}

export async function sendFeishuAppPost(
  config: FeishuAppConfig,
  title: string,
  lines: string[],
  receiveId?: string,
): Promise<FeishuSendResult> {
  const chatId = receiveId ?? config.chatId;
  if (!chatId) {
    return { ok: false, error: '未配置 FEISHU_CHAT_ID（运行 pnpm feishu:chats 查询）' };
  }
  return sendFeishuAppRaw(config, chatId, 'post', {
    zh_cn: {
      title,
      content: lines.map((line) => [{ tag: 'text', text: line }]),
    },
  });
}

export async function listFeishuAppChats(
  config: FeishuAppConfig,
): Promise<FeishuChatSummary[]> {
  const token = await getFeishuTenantAccessToken(config);
  const url = new URL('https://open.feishu.cn/open-apis/im/v1/chats');
  url.searchParams.set('page_size', '50');

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const json = (await response.json()) as ChatsListResponse;
  if (!response.ok || json.code !== 0) {
    throw new Error(
      json.msg ??
        `拉取群列表失败（HTTP ${response.status}）。请确认应用已发布、机器人已进群，并开通 im:chat:readonly 权限`,
    );
  }

  return (json.data?.items ?? [])
    .filter((item) => item.chat_id)
    .map((item) => ({
      chatId: String(item.chat_id),
      name: String(item.name ?? '未命名群'),
    }));
}
