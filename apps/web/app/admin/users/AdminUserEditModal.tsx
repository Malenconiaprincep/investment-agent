'use client';

import type { AppPermission, AppRole } from '@/lib/permissions';
import {
  PERMISSION_OPTIONS,
  PLAN_OPTIONS,
} from '@/lib/permission-labels';
import type { AdminUser, EditDraft } from './types';

type AdminUserEditModalProps = {
  user: AdminUser;
  draft: EditDraft;
  isSelf: boolean;
  saving: boolean;
  resetting: boolean;
  onClose: () => void;
  onDraftChange: (draft: EditDraft) => void;
  onTogglePermission: (permission: AppPermission) => void;
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
  onTogglePermission,
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

          <fieldset className="admin-permissions-fieldset">
            <legend>功能权限</legend>
            <div className="admin-permission-grid">
              {PERMISSION_OPTIONS.map((option) => (
                <label key={option.value} className="admin-permission-item">
                  <input
                    type="checkbox"
                    checked={draft.permissions.includes(option.value)}
                    disabled={isSelf && option.value === 'admin'}
                    onChange={() => onTogglePermission(option.value)}
                  />
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

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
              {saving ? '保存中…' : '保存权限'}
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
