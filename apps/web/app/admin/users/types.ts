import type { AppRole } from '@/lib/permissions';

export type AdminUser = {
  id: string;
  username: string;
  label: string;
  role: AppRole;
  permissions: import('@/lib/permissions').AppPermission[];
  presetTokens: boolean;
  plan: 'free' | 'pro' | 'enterprise';
  email: string | null;
  isActive: boolean;
  createdAt: string | null;
  lastLoginAt: string | null;
};

export type EditDraft = {
  label: string;
  role: AppRole;
  plan: AdminUser['plan'];
  isActive: boolean;
  newPassword: string;
};

export type UsersPageResult = {
  users: AdminUser[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export function emptyDraft(user: AdminUser): EditDraft {
  return {
    label: user.label,
    role: user.role,
    plan: user.plan,
    isActive: user.isActive,
    newPassword: '',
  };
}

export function formatTime(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
