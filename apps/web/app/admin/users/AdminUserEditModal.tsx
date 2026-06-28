'use client';

import type { AppRole } from '@/lib/permissions';
import { PLAN_OPTIONS, planDescription } from '@/lib/plan-permissions';
import type { AdminUser, EditDraft } from './types';

type AdminUserEditModalProps = {
  user: AdminUser;
  draft: EditDraft;
  isSelf: boolean;
  saving: boolean;
  resetting: boolean;
  onClose: () => void;
  onDraftChange: (draft: EditDraft) => void;
  onSave: () => void;
  onResetPassword: () => void;
};

export function AdminUserEditModal({
  user,
  draft,
  isSelf,
  saving,
  resetting,
  onClose,
  onDraftChange,
  onSave,
  onResetPassword,
}: AdminUserEditModalProps) {
  return (
    <div className="admin-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="admin-modal"
        role="dialog"
        aria-labelledby="admin-edit-title"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="admin-modal-head">
          <div>
            <h2 id="admin-edit-title" className="admin-modal-title">
              编辑用户
            </h2>
            <p className="admin-modal-sub muted">
              {user.label} · @{user.username}
            </p>
          </div>
          <button
            type="button"
            className="button button-secondary admin-modal-close"
            onClick={onClose}
          >
            关闭
          </button>
        </div>

        <div className="admin-edit-panel admin-edit-panel--modal">
          <label className="form-field">
            <span>显示名称</span>
            <input
              value={draft.label}
              onChange={(e) =>
                onDraftChange({ ...draft, label: e.target.value })
              }
            />
          </label>

          <div className="admin-edit-grid">
            <label className="form-field">
              <span>角色</span>
              <select
                value={draft.role}
                disabled={isSelf}
                onChange={(e) =>
                  onDraftChange({
                    ...draft,
                    role: e.target.value as AppRole,
                  })
                }
              >
                <option value="member">member</option>
                <option value="admin">admin</option>
              </select>
            </label>

            <label className="form-field">
              <span>套餐</span>
              <select
                value={draft.plan}
                onChange={(e) =>
                  onDraftChange({
                    ...draft,
                    plan: e.target.value as AdminUser['plan'],
                  })
                }
              >
                {PLAN_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <p className="admin-plan-summary muted">
            {planDescription(draft.plan)}
            {draft.role === 'admin' ? '；管理员额外拥有后台管理权限。' : null}
          </p>

          <label className="admin-toggle">
            <input
              type="checkbox"
              checked={draft.isActive}
              disabled={isSelf}
              onChange={(e) =>
                onDraftChange({ ...draft, isActive: e.target.checked })
              }
            />
            <span>账号启用</span>
          </label>

          <div className="admin-edit-actions">
            <button
              type="button"
              className="button"
              disabled={saving}
              onClick={onSave}
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>

          <div className="admin-reset-block">
            <h3>重置密码</h3>
            <p className="muted">
              为用户设置新密码（至少 8 位），保存后立即生效。
            </p>
            <div className="admin-reset-row">
              <input
                type="password"
                placeholder="新密码"
                value={draft.newPassword}
                onChange={(e) =>
                  onDraftChange({ ...draft, newPassword: e.target.value })
                }
              />
              <button
                type="button"
                className="button button-secondary"
                disabled={resetting || !draft.newPassword}
                onClick={onResetPassword}
              >
                {resetting ? '重置中…' : '重置密码'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
