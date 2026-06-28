'use client';

import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAuthUser } from '@/hooks/useAuthUser';
import type { AppPermission } from '@/lib/permissions';
import { permissionLabel } from '@/lib/permission-labels';
import { AdminUserEditModal } from './AdminUserEditModal';
import {
  emptyDraft,
  formatTime,
  type AdminUser,
  type EditDraft,
  type UsersPageResult,
} from './types';
import '@/styles/admin.css';

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

export default function AdminUsersPage() {
  const { user: currentUser, loading: authLoading, can } = useAuthUser();
  const isAdmin = can('admin');

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async (targetPage: number, targetPageSize: number) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(targetPage),
        pageSize: String(targetPageSize),
      });
      const res = await fetch(`/api/admin/users?${params}`);
      const data = (await res.json()) as UsersPageResult & { error?: string };
      if (!res.ok) throw new Error(data.error ?? '加载失败');

      setUsers(data.users ?? []);
      setPage(data.page ?? targetPage);
      setPageSize(data.pageSize ?? targetPageSize);
      setTotal(data.total ?? 0);
      setTotalPages(data.totalPages ?? 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    void load(page, pageSize);
  }, [authLoading, isAdmin, load, page, pageSize]);

  function openEdit(user: AdminUser) {
    setEditingUser(user);
    setDraft(emptyDraft(user));
    setMessage(null);
  }

  function closeEdit() {
    setEditingUser(null);
    setDraft(null);
  }

  function togglePermission(permission: AppPermission) {
    setDraft((prev) => {
      if (!prev) return prev;
      const has = prev.permissions.includes(permission);
      return {
        ...prev,
        permissions: has
          ? prev.permissions.filter((item) => item !== permission)
          : [...prev.permissions, permission],
      };
    });
  }

  async function saveUser(username: string) {
    if (!draft) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(username)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: draft.label,
          role: draft.role,
          plan: draft.plan,
          permissions: draft.permissions,
          isActive: draft.isActive,
        }),
      });
      const data = (await res.json()) as { user?: AdminUser; error?: string };
      if (!res.ok) throw new Error(data.error ?? '保存失败');

      setUsers((prev) =>
        prev.map((item) => (item.username === username ? data.user! : item)),
      );
      setMessage(`已更新 ${username} 的权限与套餐`);
      closeEdit();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function resetPassword(username: string) {
    if (!draft?.newPassword) {
      setError('请输入新密码');
      return;
    }
    setResetting(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(username)}/reset-password`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: draft.newPassword }),
        },
      );
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? '重置失败');

      setDraft((prev) => (prev ? { ...prev, newPassword: '' } : prev));
      setMessage(`已重置 ${username} 的密码`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '重置失败');
    } finally {
      setResetting(false);
    }
  }

  function goToPage(nextPage: number) {
    const clamped = Math.min(Math.max(1, nextPage), totalPages);
    setPage(clamped);
  }

  if (authLoading) {
    return (
      <main className="page">
        <PageHeader title="用户管理" description="加载中…" />
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="page">
        <PageHeader
          title="后台管理"
          description="仅管理员可访问。请使用 adminwb 账号登录。"
        />
        <p className="form-error" role="alert">
          当前账号无后台管理权限。
        </p>
      </main>
    );
  }

  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);

  return (
    <main className="page admin-page">
      <PageHeader
        eyebrow="Admin"
        title="用户管理"
        description="为注册用户升级功能权限、调整套餐，或重置登录密码。权限变更后，用户需重新登录生效。"
      />

      {currentUser ? (
        <p className="admin-meta muted">
          当前管理员：<strong>{currentUser.label}</strong>（{currentUser.username}）
        </p>
      ) : null}

      {message ? (
        <p className="admin-notice" role="status">
          {message}
        </p>
      ) : null}

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="admin-toolbar">
        <span className="admin-toolbar-meta muted">
          共 {total} 位用户
        </span>
        <label className="admin-page-size">
          <span className="muted">每页</span>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                {size} 条
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="table-scroll-wrap admin-table-wrap">
        <table className="candidate-table admin-table">
          <thead>
            <tr>
              <th>用户</th>
              <th>套餐</th>
              <th>角色</th>
              <th>状态</th>
              <th>权限</th>
              <th>最近登录</th>
              <th>注册时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="admin-table-empty">
                  加载中…
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={8} className="admin-table-empty">
                  暂无用户
                </td>
              </tr>
            ) : (
              users.map((user) => {
                const isSelf = currentUser?.username === user.username;
                return (
                  <tr key={user.id}>
                    <td>
                      <div className="admin-table-user">
                        <strong>{user.label}</strong>
                        <span className="muted">@{user.username}</span>
                        {isSelf ? (
                          <span className="admin-tag admin-tag--self">当前</span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <span className="admin-tag">{user.plan.toUpperCase()}</span>
                    </td>
                    <td>{user.role}</td>
                    <td>
                      <span
                        className={`admin-status${user.isActive ? ' admin-status--active' : ''}`}
                      >
                        {user.isActive ? '已启用' : '已停用'}
                      </span>
                    </td>
                    <td>
                      <div className="admin-table-perms">
                        {user.permissions.length > 0 ? (
                          user.permissions.map((permission) => (
                            <span key={permission} className="admin-tag">
                              {permissionLabel(permission)}
                            </span>
                          ))
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </div>
                    </td>
                    <td className="admin-table-time">{formatTime(user.lastLoginAt)}</td>
                    <td className="admin-table-time">{formatTime(user.createdAt)}</td>
                    <td>
                      <button
                        type="button"
                        className="button button-secondary button-sm"
                        onClick={() => openEdit(user)}
                      >
                        编辑
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <nav className="admin-pagination" aria-label="用户列表分页">
        <span className="admin-pagination-meta muted">
          第 {page} / {totalPages} 页 · 显示 {rangeStart}–{rangeEnd} 条
        </span>
        <div className="admin-pagination-actions">
          <button
            type="button"
            className="button button-secondary button-sm"
            disabled={page <= 1 || loading}
            onClick={() => goToPage(page - 1)}
          >
            上一页
          </button>
          <button
            type="button"
            className="button button-secondary button-sm"
            disabled={page >= totalPages || loading}
            onClick={() => goToPage(page + 1)}
          >
            下一页
          </button>
        </div>
      </nav>

      {editingUser && draft ? (
        <AdminUserEditModal
          user={editingUser}
          draft={draft}
          isSelf={currentUser?.username === editingUser.username}
          saving={saving}
          resetting={resetting}
          onClose={closeEdit}
          onDraftChange={setDraft}
          onTogglePermission={togglePermission}
          onSave={() => void saveUser(editingUser.username)}
          onResetPassword={() => void resetPassword(editingUser.username)}
        />
      ) : null}
    </main>
  );
}
