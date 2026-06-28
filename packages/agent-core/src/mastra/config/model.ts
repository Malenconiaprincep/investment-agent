/**
 * AI 模型配置（Mastra 统一路由 provider/model-name）
 * @see https://mastra.ai/models
 *
 * 在 .env 中设置：
 *   AI_MODEL=deepseek/deepseek-v4-flash
 *   DEEPSEEK_API_KEY=sk-...   # 与所选模型提供商对应
 *
 * 兼容旧配置：DEEPSEEK_MODEL 仍可作为 AI_MODEL 的回退。
 */
import {
  DEFAULT_MODEL_ID,
  isModelApiKeyConfigured,
  resolveModelId,
} from './model-providers.js';

export { DEFAULT_MODEL_ID, isModelApiKeyConfigured, resolveModelId };

export const DEFAULT_MODEL = resolveModelId();
