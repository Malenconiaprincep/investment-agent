/**
 * DeepSeek 模型配置
 * @see https://mastra.ai/models/providers/deepseek
 *
 * 在 packages/agent-core/.env 中设置：
 *   DEEPSEEK_API_KEY=sk-...
 *   DEEPSEEK_MODEL=deepseek/deepseek-v4-flash  # 可选
 */
export const DEFAULT_MODEL =
  process.env.DEEPSEEK_MODEL ?? 'deepseek/deepseek-v4-flash';
