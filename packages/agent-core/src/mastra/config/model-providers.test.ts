import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MODEL_ID,
  getApiKeyEnvForModel,
  getProviderIdFromModel,
  isModelApiKeyConfigured,
  resolveModelId,
} from './model-providers.js';

describe('model-providers', () => {
  it('maps model id to provider api key env', () => {
    expect(getApiKeyEnvForModel('deepseek/deepseek-v4-flash')).toBe(
      'DEEPSEEK_API_KEY',
    );
    expect(getApiKeyEnvForModel('openai/gpt-4o')).toBe('OPENAI_API_KEY');
    expect(getApiKeyEnvForModel('alibaba-cn/qwen-plus')).toBe(
      'DASHSCOPE_API_KEY',
    );
    expect(getApiKeyEnvForModel('moonshotai-cn/kimi-k2.5')).toBe(
      'MOONSHOT_API_KEY',
    );
    expect(getApiKeyEnvForModel('zhipuai/glm-4.7')).toBe('ZHIPU_API_KEY');
    expect(getApiKeyEnvForModel('openrouter/deepseek/deepseek-chat')).toBe(
      'OPENROUTER_API_KEY',
    );
  });

  it('extracts provider id from model id', () => {
    expect(getProviderIdFromModel('anthropic/claude-3-5-haiku-latest')).toBe(
      'anthropic',
    );
  });

  it('resolves model from AI_MODEL with DEEPSEEK_MODEL fallback', () => {
    const prevAi = process.env.AI_MODEL;
    const prevDeepseek = process.env.DEEPSEEK_MODEL;
    delete process.env.AI_MODEL;
    process.env.DEEPSEEK_MODEL = 'deepseek/deepseek-chat';
    expect(resolveModelId()).toBe('deepseek/deepseek-chat');
    process.env.AI_MODEL = 'openai/gpt-4o';
    expect(resolveModelId()).toBe('openai/gpt-4o');
    if (prevAi === undefined) delete process.env.AI_MODEL;
    else process.env.AI_MODEL = prevAi;
    if (prevDeepseek === undefined) delete process.env.DEEPSEEK_MODEL;
    else process.env.DEEPSEEK_MODEL = prevDeepseek;
  });

  it('checks configured api key for active model', () => {
    const prev = process.env.OPENAI_API_KEY;
    process.env.AI_MODEL = 'openai/gpt-4o';
    delete process.env.OPENAI_API_KEY;
    expect(isModelApiKeyConfigured()).toBe(false);
    process.env.OPENAI_API_KEY = 'sk-test';
    expect(isModelApiKeyConfigured()).toBe(true);
    if (prev === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = prev;
    process.env.AI_MODEL = DEFAULT_MODEL_ID;
  });
});
