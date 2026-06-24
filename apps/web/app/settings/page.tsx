'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';

type EnvKeyStatus = { configured: boolean; masked?: string };

type TokenConfigStatus = {
  username: string;
  userLabel: string;
  presetTokens: boolean;
  envPath: string | null;
  keys: Record<string, EnvKeyStatus>;
  restartRequired?: boolean;
};

type KeyField = {
  key: string;
  label: string;
  required?: boolean;
  placeholder: string;
  hint?: string;
};

const KEY_FIELDS: KeyField[] = [
  {
    key: 'DEEPSEEK_API_KEY',
    label: 'DeepSeek API Key',
    required: true,
    placeholder: 'sk-...',
    hint: '必填，用于 AI 分析与投委会。申请：https://platform.deepseek.com/api_keys',
  },
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
  {
    key: 'LIBSQL_URL',
    label: 'Turso 数据库 URL',
    placeholder: 'libsql://your-db.turso.io',
    hint: '可选，不填则使用本地 SQLite',
  },
  {
    key: 'LIBSQL_AUTH_TOKEN',
    label: 'Turso Auth Token',
    placeholder: 'eyJ...',
    hint: '与 Turso URL 配套使用',
  },
  {
    key: 'AGENT_CORE_TOKEN',
    label: 'Agent Core Token',
    placeholder: '可选共享密钥',
    hint: '远程部署 agent-core 时使用，本地一般留空',
  },
];

export default function SettingsPage() {
  const [status, setStatus] = useState<TokenConfigStatus | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/settings/env');
      const data = (await res.json()) as TokenConfigStatus & { error?: string };
      if (!res.ok) throw new Error(data.error ?? '加载失败');
      setStatus(data);
      setDraft({});
    } catch (err) {
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function fieldValue(key: string): string {
    if (key in draft) return draft[key] ?? '';
    return '';
  }

  function fieldPlaceholder(field: KeyField): string {
    const current = status?.keys[field.key];
    if (current?.configured && current.masked) {
      return `已配置 ${current.masked}（留空不修改）`;
    }
    return field.placeholder;
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);

    const updates: Record<string, string | null> = {};
    for (const field of KEY_FIELDS) {
      if (!(field.key in draft)) continue;
      const value = draft[field.key]?.trim() ?? '';
      updates[field.key] = value || null;
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

  const missingRequired =
    status &&
    KEY_FIELDS.some(
      (field) => field.required && !status.keys[field.key]?.configured,
    );

  return (
    <main className="page page--list">
      <PageHeader
        title="Token 设置"
        description="按当前登录账号独立保存 API Key。保存后立即同步到 agent-core，无需重启。"
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

            {missingRequired && (
              <div className="error">
                仍有必填 Token 未配置，请先补全后再使用智能选股 / AI 分析。
              </div>
            )}

            {status.envPath && (
              <section className="pane-card monitor-settings-section">
                <h2 className="section-title">配置文件位置</h2>
                <p className="muted monitor-settings-hint">
                  <code>{status.envPath}</code>
                </p>
              </section>
            )}

            <form onSubmit={(e) => void handleSave(e)}>
              <section className="pane-card monitor-settings-section">
                <h2 className="section-title">API Token</h2>

                <div className="settings-env-grid">
                  {KEY_FIELDS.map((field) => (
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
                        placeholder={fieldPlaceholder(field)}
                        value={fieldValue(field.key)}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            [field.key]: e.target.value,
                          }))
                        }
                      />
                      {field.hint && (
                        <span className="muted settings-env-hint">{field.hint}</span>
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
                    已保存并同步到 agent-core，可直接使用。
                  </p>
                )}
              </section>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
