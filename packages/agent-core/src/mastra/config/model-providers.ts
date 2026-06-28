export type ModelOption = {
  id: string;
  label: string;
};

export type ProviderRegion = 'cn' | 'global';

export type ModelProvider = {
  id: string;
  label: string;
  region: ProviderRegion;
  apiKeyEnv: string;
  applyUrl: string;
  models: ModelOption[];
};

/** Mastra 模型路由支持的常见提供商（provider/model-name） */
export const MODEL_PROVIDERS: ModelProvider[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    region: 'cn',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    applyUrl: 'https://platform.deepseek.com/api_keys',
    models: [
      { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash（默认）' },
      { id: 'deepseek/deepseek-chat', label: 'DeepSeek Chat' },
    ],
  },
  {
    id: 'alibaba-cn',
    label: '通义千问',
    region: 'cn',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    applyUrl: 'https://dashscope.console.aliyun.com/apiKey',
    models: [
      { id: 'alibaba-cn/qwen-plus', label: 'Qwen Plus' },
      { id: 'alibaba-cn/qwen-max', label: 'Qwen Max' },
      { id: 'alibaba-cn/qwen-turbo', label: 'Qwen Turbo' },
      { id: 'alibaba-cn/qwen-flash', label: 'Qwen Flash' },
    ],
  },
  {
    id: 'moonshotai-cn',
    label: 'Kimi（月之暗面）',
    region: 'cn',
    apiKeyEnv: 'MOONSHOT_API_KEY',
    applyUrl: 'https://platform.moonshot.cn/console/api-keys',
    models: [
      { id: 'moonshotai-cn/kimi-k2.5', label: 'Kimi K2.5' },
      { id: 'moonshotai-cn/kimi-k2.6', label: 'Kimi K2.6' },
      { id: 'moonshotai-cn/kimi-k2-turbo-preview', label: 'Kimi K2 Turbo' },
    ],
  },
  {
    id: 'zhipuai',
    label: '智谱 GLM',
    region: 'cn',
    apiKeyEnv: 'ZHIPU_API_KEY',
    applyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
    models: [
      { id: 'zhipuai/glm-4.7', label: 'GLM-4.7' },
      { id: 'zhipuai/glm-4.7-flash', label: 'GLM-4.7 Flash' },
      { id: 'zhipuai/glm-5', label: 'GLM-5' },
    ],
  },
  {
    id: 'minimax-cn',
    label: 'MiniMax',
    region: 'cn',
    apiKeyEnv: 'MINIMAX_API_KEY',
    applyUrl: 'https://platform.minimaxi.com/user-center/basic-information',
    models: [
      { id: 'minimax-cn/MiniMax-M2.5', label: 'MiniMax M2.5' },
      { id: 'minimax-cn/MiniMax-M2.7', label: 'MiniMax M2.7' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    region: 'global',
    apiKeyEnv: 'OPENAI_API_KEY',
    applyUrl: 'https://platform.openai.com/api-keys',
    models: [
      { id: 'openai/gpt-4o', label: 'GPT-4o' },
      { id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    region: 'global',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    applyUrl: 'https://console.anthropic.com/settings/keys',
    models: [
      { id: 'anthropic/claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
      { id: 'anthropic/claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku' },
    ],
  },
  {
    id: 'google',
    label: 'Google Gemini',
    region: 'global',
    apiKeyEnv: 'GOOGLE_API_KEY',
    applyUrl: 'https://aistudio.google.com/apikey',
    models: [
      { id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    ],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    region: 'global',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    applyUrl: 'https://openrouter.ai/keys',
    models: [
      {
        id: 'openrouter/deepseek/deepseek-chat',
        label: 'DeepSeek Chat（经 OpenRouter）',
      },
      {
        id: 'openrouter/anthropic/claude-sonnet-4',
        label: 'Claude Sonnet 4（经 OpenRouter）',
      },
    ],
  },
  {
    id: 'xai',
    label: 'xAI',
    region: 'global',
    apiKeyEnv: 'XAI_API_KEY',
    applyUrl: 'https://console.x.ai/',
    models: [
      { id: 'xai/grok-3', label: 'Grok 3' },
      { id: 'xai/grok-3-mini', label: 'Grok 3 Mini' },
    ],
  },
  {
    id: 'mistral',
    label: 'Mistral',
    region: 'global',
    apiKeyEnv: 'MISTRAL_API_KEY',
    applyUrl: 'https://console.mistral.ai/api-keys/',
    models: [
      { id: 'mistral/mistral-large-latest', label: 'Mistral Large' },
      { id: 'mistral/mistral-small-latest', label: 'Mistral Small' },
    ],
  },
];

export const PROVIDER_REGIONS: Array<{ id: ProviderRegion; label: string }> = [
  { id: 'cn', label: '国内' },
  { id: 'global', label: '海外' },
];

export const AI_MODEL_ENV = 'AI_MODEL' as const;

export const AI_API_KEY_ENVS = MODEL_PROVIDERS.map((p) => p.apiKeyEnv);

export const DEFAULT_MODEL_ID = 'deepseek/deepseek-v4-flash';

const providerById = new Map(MODEL_PROVIDERS.map((p) => [p.id, p]));
const providerByApiKey = new Map(MODEL_PROVIDERS.map((p) => [p.apiKeyEnv, p]));

export function getProvidersByRegion(region: ProviderRegion): ModelProvider[] {
  return MODEL_PROVIDERS.filter((p) => p.region === region);
}

export function getProviderById(id: string): ModelProvider | undefined {
  return providerById.get(id);
}

export function getProviderIdFromModel(modelId: string): string {
  const trimmed = modelId.trim();
  if (!trimmed) return 'deepseek';
  return trimmed.split('/')[0] ?? 'deepseek';
}

export function getApiKeyEnvForModel(modelId: string): string {
  const providerId = getProviderIdFromModel(modelId);
  const known = providerById.get(providerId);
  if (known) return known.apiKeyEnv;
  return `${providerId.toUpperCase().replace(/-/g, '_')}_API_KEY`;
}

export function getProviderForModel(modelId: string): ModelProvider | undefined {
  return providerById.get(getProviderIdFromModel(modelId));
}

export function getProviderByApiKeyEnv(apiKeyEnv: string): ModelProvider | undefined {
  return providerByApiKey.get(apiKeyEnv);
}

export function resolveModelId(): string {
  return (
    process.env[AI_MODEL_ENV]?.trim() ||
    process.env.DEEPSEEK_MODEL?.trim() ||
    DEFAULT_MODEL_ID
  );
}

export function isModelApiKeyConfigured(modelId?: string): boolean {
  const model = modelId?.trim() || resolveModelId();
  const apiKeyEnv = getApiKeyEnvForModel(model);
  return Boolean(process.env[apiKeyEnv]?.trim());
}
