'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import styles from './settings-ai.module.css';
import {
  AI_MODEL_ENV,
  DEFAULT_MODEL_ID,
  getProviderById,
  getProviderForModel,
  getProvidersByRegion,
  isKnownModelId,
  MODEL_PROVIDERS,
  PROVIDER_REGIONS,
  type ProviderRegion,
} from '@/lib/model-providers';
import type { AppPlan, AppRole } from '@/lib/permissions';

type EnvKeyStatus = { configured: boolean; masked?: string; value?: string };

type TokenConfigStatus = {
  username: string;
  userLabel: string;
  presetTokens: boolean;
  envPath: string | null;
  aiModel: string;
  requiredApiKeyEnv: string;
  keys: Record<string, EnvKeyStatus>;
  restartRequired?: boolean;
};

type ScheduledTaskStatus = {
  id: string;
  label: string;
  description: string;
  scheduleText: string;
  enabled: boolean;
};

type SettingsUser = {
  role: AppRole;
  plan: AppPlan;
};

type SettingsTab = 'scheduled' | 'ai';

type OtherKeyField = {
  key: string;
  label: string;
  required?: boolean;
  placeholder: string;
  hint?: string;
};

const OTHER_KEY_FIELDS: OtherKeyField[] = [
  {
    key: 'IWENCAI_API_KEY',
    label: '问财 API Key',
    required: true,
    placeholder: 'sk-...',
    hint: '智能选股、板块筛选、热点新闻需要此 Key',
  },
  {
    key: 'IWENCAI_BASE_URL',
    label: '问财 API 地址',
    placeholder: 'https://openapi.iwencai.com',
    hint: '一般保持默认即可',
  },
];

export default function SettingsPage() {
  const [status, setStatus] = useState<TokenConfigStatus | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [useCustomModel, setUseCustomModel] = useState(false);
  const [showOtherKeys, setShowOtherKeys] = useState(false);
  const [region, setRegion] = useState<ProviderRegion>('cn');
  const [providerId, setProviderId] = useState('deepseek');
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTaskStatus[]>([]);
  const [taskSavingId, setTaskSavingId] = useState<string | null>(null);
  const [canUseScheduledTasks, setCanUseScheduledTasks] = useState(false);
  const [activeTab, setActiveTab] = useState<SettingsTab>('ai');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, userRes] = await Promise.all([
        fetch('/api/settings/env'),
        fetch('/api/auth/me'),
      ]);
      const data = (await res.json()) as TokenConfigStatus & { error?: string };
      if (!res.ok) throw new Error(data.error ?? '加载失败');
      setStatus(data);
      setDraft({});

      const userData = (await userRes.json()) as SettingsUser & { error?: string };
      if (!userRes.ok) throw new Error(userData.error ?? '加载账号信息失败');
      const nextCanUseScheduledTasks =
        userData.role === 'admin' ||
        userData.plan === 'pro' ||
        userData.plan === 'enterprise';
      setCanUseScheduledTasks(nextCanUseScheduledTasks);
      const hash =
        typeof window === 'undefined' ? '' : window.location.hash.replace('#', '');
      setActiveTab(
        nextCanUseScheduledTasks && hash === 'scheduled-tasks'
          ? 'scheduled'
          : 'ai',
      );

      if (nextCanUseScheduledTasks) {
        const tasksRes = await fetch('/api/settings/scheduled-tasks');
        const taskData = (await tasksRes.json()) as {
          tasks?: ScheduledTaskStatus[];
          error?: string;
        };
        if (!tasksRes.ok) throw new Error(taskData.error ?? '加载定时任务失败');
        setScheduledTasks(taskData.tasks ?? []);
      } else {
        setScheduledTasks([]);
      }

      const model = data.aiModel?.trim() || DEFAULT_MODEL_ID;
      const provider = getProviderForModel(model);
      if (provider && isKnownModelId(model)) {
        setUseCustomModel(false);
        setRegion(provider.region);
        setProviderId(provider.id);
      } else {
        setUseCustomModel(true);
        setRegion(provider?.region ?? 'cn');
        setProviderId(provider?.id ?? 'deepseek');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canUseScheduledTasks && activeTab === 'scheduled') {
      setActiveTab('ai');
    }
  }, [activeTab, canUseScheduledTasks]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeModel = useMemo(() => {
    if (AI_MODEL_ENV in draft) {
      return draft[AI_MODEL_ENV]?.trim() || DEFAULT_MODEL_ID;
    }
    return status?.aiModel?.trim() || DEFAULT_MODEL_ID;
  }, [draft, status?.aiModel]);

  const activeProvider = useMemo(() => {
    if (useCustomModel) {
      return getProviderForModel(activeModel) ?? getProviderById(providerId);
    }
    return getProviderById(providerId) ?? getProviderForModel(activeModel);
  }, [useCustomModel, activeModel, providerId]);

  const providersInRegion = useMemo(() => getProvidersByRegion(region), [region]);

  function fieldValue(key: string): string {
    if (key in draft) return draft[key] ?? '';
    if (key === AI_MODEL_ENV) return status?.keys[AI_MODEL_ENV]?.value ?? '';
    return '';
  }

  function secretPlaceholder(key: string, fallback: string): string {
    const current = status?.keys[key];
    if (current?.configured && current.masked) {
      return `已配置 ${current.masked}（留空不修改）`;
    }
    return fallback;
  }

  function selectProvider(nextProviderId: string) {
    const provider = getProviderById(nextProviderId);
    if (!provider) return;
    setProviderId(nextProviderId);
    setUseCustomModel(false);
    setDraft((prev) => ({
      ...prev,
      [AI_MODEL_ENV]: provider.models[0]?.id ?? DEFAULT_MODEL_ID,
    }));
  }

  function selectRegion(nextRegion: ProviderRegion) {
    setRegion(nextRegion);
    const first = getProvidersByRegion(nextRegion)[0];
    if (first) selectProvider(first.id);
  }

  function selectModel(modelId: string) {
    setUseCustomModel(false);
    setDraft((prev) => ({ ...prev, [AI_MODEL_ENV]: modelId }));
    const provider = getProviderForModel(modelId);
    if (provider) {
      setProviderId(provider.id);
      setRegion(provider.region);
    }
  }

  function selectTab(tab: SettingsTab) {
    if (tab === 'scheduled' && !canUseScheduledTasks) return;
    setActiveTab(tab);
    const hash = tab === 'scheduled' ? '#scheduled-tasks' : '#ai-model';
    window.history.replaceState(null, '', `${window.location.pathname}${hash}`);
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);

    const allKeys = [
      AI_MODEL_ENV,
      ...MODEL_PROVIDERS.map((p) => p.apiKeyEnv),
      ...OTHER_KEY_FIELDS.map((f) => f.key),
    ];

    const updates: Record<string, string | null> = {};
    for (const key of allKeys) {
      if (!(key in draft)) continue;
      const value = draft[key]?.trim() ?? '';
      updates[key] = value || null;
    }

    if (Object.keys(updates).length === 0) {
      setError('没有需要保存的修改');
      setSaving(false);
      return;
    }

    try {
      const res = await fetch('/api/settings/env', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = (await res.json()) as TokenConfigStatus & { error?: string };
      if (!res.ok) throw new Error(data.error ?? '保存失败');
      setStatus(data);
      setDraft({});
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function toggleScheduledTask(task: ScheduledTaskStatus) {
    setTaskSavingId(task.id);
    setError(null);
    try {
      const res = await fetch('/api/settings/scheduled-tasks', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: task.id, enabled: !task.enabled }),
      });
      const data = (await res.json()) as {
        tasks?: ScheduledTaskStatus[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? '保存定时任务失败');
      setScheduledTasks(data.tasks ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存定时任务失败');
    } finally {
      setTaskSavingId(null);
    }
  }

  const requiredApiKeyEnv = activeProvider?.apiKeyEnv ?? status?.requiredApiKeyEnv;
  const missingAiKey =
    status && requiredApiKeyEnv && !status.keys[requiredApiKeyEnv]?.configured;
  const missingIwencai =
    status && !status.keys.IWENCAI_API_KEY?.configured;
  const missingRequired = missingAiKey || missingIwencai;

  const otherProviders = MODEL_PROVIDERS.filter(
    (p) => p.apiKeyEnv !== activeProvider?.apiKeyEnv,
  );

  const configuredOtherCount = otherProviders.filter(
    (p) => status?.keys[p.apiKeyEnv]?.configured,
  ).length;

  return (
    <main className="page page--list">
      <PageHeader
        title="设置"
        description="管理本机定时任务与 AI 模型配置。"
      />

      <div className="list-stack">
        <nav className="page-toolbar">
          <Link href="/monitor" className="button button-secondary">
            ← 返回
          </Link>
        </nav>

        {loading && <div className="list-loading">加载配置…</div>}
        {error && <div className="error">{error}</div>}

        {status && !loading && (
          <>
            <section className="pane-card monitor-settings-section">
              <h2 className="section-title">当前账号</h2>
              <p className="muted monitor-settings-hint">
                <strong>{status.userLabel}</strong>（{status.username}）
                {status.presetTokens
                  ? ' · 已预置 Token，可直接使用；如需更换可在此修改'
                  : ' · 请自行配置全部 Token 后使用智能选股等功能'}
              </p>
            </section>

            <div className={styles.settingsTabs} role="tablist">
              {canUseScheduledTasks && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'scheduled'}
                  className={`${styles.settingsTab}${
                    activeTab === 'scheduled' ? ` ${styles.settingsTabActive}` : ''
                  }`}
                  onClick={() => selectTab('scheduled')}
                >
                  定时任务
                </button>
              )}
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'ai'}
                className={`${styles.settingsTab}${
                  activeTab === 'ai' ? ` ${styles.settingsTabActive}` : ''
                }`}
                onClick={() => selectTab('ai')}
              >
                AI 模型
              </button>
            </div>

            {canUseScheduledTasks && activeTab === 'scheduled' && (
              <section
                id="scheduled-tasks"
                className="pane-card monitor-settings-section"
              >
                <h2 className="section-title">定时任务</h2>
                <div className="settings-env-grid">
                  {scheduledTasks.map((task) => (
                    <label key={task.id} className="settings-env-field">
                      <span className="settings-env-label">
                        {task.label}
                        <span className="settings-env-badge">
                          {task.scheduleText}
                        </span>
                      </span>
                      <span className="muted settings-env-hint">
                        {task.description}
                      </span>
                      <div className={styles.switchRow}>
                        <input
                          type="checkbox"
                          checked={task.enabled}
                          disabled={taskSavingId === task.id}
                          onChange={() => void toggleScheduledTask(task)}
                        />
                        <span>{task.enabled ? '已开启' : '已关闭'}</span>
                      </div>
                    </label>
                  ))}
                </div>
              </section>
            )}

            {activeTab === 'ai' && missingRequired && (
              <div className="error">
                仍有必填 Token 未配置，请先补全后再使用智能选股 / AI 分析。
                {missingAiKey && activeProvider && (
                  <>
                    {' '}
                    当前模型需要 <strong>{activeProvider.label}</strong> API Key。
                  </>
                )}
              </div>
            )}

            {activeTab === 'ai' && (
            <form id="ai-model" onSubmit={(e) => void handleSave(e)}>
              <section className="pane-card monitor-settings-section">
                <h2 className="section-title">AI 模型</h2>

                <div className={styles.aiLayout}>
                  <div className={styles.regionTabs} role="tablist">
                    {PROVIDER_REGIONS.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        role="tab"
                        aria-selected={region === item.id}
                        className={`${styles.regionTab}${region === item.id ? ` ${styles.regionTabActive}` : ''}`}
                        onClick={() => selectRegion(item.id)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>

                  <div className={styles.providerGrid}>
                    {providersInRegion.map((provider) => (
                      <button
                        key={provider.id}
                        type="button"
                        className={`${styles.providerChip}${
                          !useCustomModel && providerId === provider.id
                            ? ` ${styles.providerChipActive}`
                            : ''
                        }`}
                        onClick={() => selectProvider(provider.id)}
                      >
                        {provider.label}
                      </button>
                    ))}
                  </div>

                  {!useCustomModel && activeProvider && (
                    <label className="settings-env-field">
                      <span className="settings-env-label">具体模型</span>
                      <select
                        className="input"
                        value={
                          isKnownModelId(activeModel) &&
                          activeProvider.models.some((m) => m.id === activeModel)
                            ? activeModel
                            : activeProvider.models[0]?.id ?? DEFAULT_MODEL_ID
                        }
                        onChange={(e) => selectModel(e.target.value)}
                      >
                        {activeProvider.models.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  {useCustomModel && (
                    <label className="settings-env-field">
                      <span className="settings-env-label">自定义模型 ID</span>
                      <input
                        type="text"
                        className="input"
                        autoComplete="off"
                        placeholder="provider/model-name，如 zhipuai/glm-4.7"
                        value={fieldValue(AI_MODEL_ENV) || activeModel}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            [AI_MODEL_ENV]: e.target.value,
                          }))
                        }
                      />
                      <span className="muted settings-env-hint">
                        格式为 provider/model-name，与 Mastra 文档一致。
                      </span>
                    </label>
                  )}

                  <button
                    type="button"
                    className={styles.textToggle}
                    onClick={() => {
                      setUseCustomModel((prev) => !prev);
                      if (!useCustomModel) {
                        setDraft((d) => ({
                          ...d,
                          [AI_MODEL_ENV]: isKnownModelId(activeModel)
                            ? ''
                            : activeModel,
                        }));
                      }
                    }}
                  >
                    {useCustomModel ? '← 返回预设模型' : '使用自定义模型 ID…'}
                  </button>

                  {activeProvider && (
                    <label className={`settings-env-field ${styles.keyField}`}>
                      <span className="settings-env-label">
                        {activeProvider.label} API Key *
                        {requiredApiKeyEnv &&
                          status.keys[requiredApiKeyEnv]?.configured && (
                            <span className="settings-env-badge">已配置</span>
                          )}
                      </span>
                      <input
                        type="password"
                        className="input"
                        autoComplete="off"
                        placeholder={secretPlaceholder(
                          activeProvider.apiKeyEnv,
                          'sk-...',
                        )}
                        value={fieldValue(activeProvider.apiKeyEnv)}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            [activeProvider.apiKeyEnv]: e.target.value,
                          }))
                        }
                      />
                      <span className="muted settings-env-hint">
                        申请：
                        <a
                          href={activeProvider.applyUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {activeProvider.applyUrl}
                        </a>
                      </span>
                    </label>
                  )}

                  <p className={`muted settings-env-hint ${styles.summary}`}>
                    当前模型：<code>{activeModel}</code>
                  </p>
                </div>
              </section>

              <section className="pane-card monitor-settings-section">
                <button
                  type="button"
                  className={styles.textToggle}
                  aria-expanded={showOtherKeys}
                  onClick={() => setShowOtherKeys((prev) => !prev)}
                >
                  预配置其他提供商 Key（可选）
                  {configuredOtherCount > 0 && (
                    <span className="settings-env-badge">
                      已配置 {configuredOtherCount} 个
                    </span>
                  )}
                  <span className={styles.chevron}>
                    {showOtherKeys ? '▾' : '▸'}
                  </span>
                </button>

                {showOtherKeys && (
                  <div className={`settings-env-grid ${styles.otherKeysPanel}`}>
                    {otherProviders.map((provider) => (
                      <label
                        key={provider.apiKeyEnv}
                        className="settings-env-field"
                      >
                        <span className="settings-env-label">
                          {provider.label}
                          {status.keys[provider.apiKeyEnv]?.configured && (
                            <span className="settings-env-badge">已配置</span>
                          )}
                        </span>
                        <input
                          type="password"
                          className="input"
                          autoComplete="off"
                          placeholder={secretPlaceholder(
                            provider.apiKeyEnv,
                            'sk-...',
                          )}
                          value={fieldValue(provider.apiKeyEnv)}
                          onChange={(e) =>
                            setDraft((prev) => ({
                              ...prev,
                              [provider.apiKeyEnv]: e.target.value,
                            }))
                          }
                        />
                      </label>
                    ))}
                  </div>
                )}
              </section>

              <section className="pane-card monitor-settings-section">
                <h2 className="section-title">问财 MCP</h2>

                <div className="settings-env-grid">
                  {OTHER_KEY_FIELDS.map((field) => (
                    <label key={field.key} className="settings-env-field">
                      <span className="settings-env-label">
                        {field.label}
                        {field.required ? ' *' : ''}
                        {status.keys[field.key]?.configured && (
                          <span className="settings-env-badge">已配置</span>
                        )}
                      </span>
                      <input
                        type="password"
                        className="input"
                        autoComplete="off"
                        placeholder={secretPlaceholder(
                          field.key,
                          field.placeholder,
                        )}
                        value={fieldValue(field.key)}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            [field.key]: e.target.value,
                          }))
                        }
                      />
                      {field.hint && (
                        <span className="muted settings-env-hint">
                          {field.hint}
                        </span>
                      )}
                    </label>
                  ))}
                </div>

                <div className="page-toolbar" style={{ marginTop: '1rem' }}>
                  <button
                    type="submit"
                    className="button button-primary"
                    disabled={saving}
                  >
                    {saving ? '保存中…' : '保存 Token'}
                  </button>
                </div>

                {saved && (
                  <p className="monitor-settings-saved">
                    已保存并同步到 agent-core，下次 AI 分析将使用当前模型与 Key。
                  </p>
                )}
              </section>
            </form>
            )}
          </>
        )}
      </div>
    </main>
  );
}
