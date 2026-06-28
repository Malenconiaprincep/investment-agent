import type { AppPermission, AppRole } from './permissions';

/** 登录账号（username） */
export type AppUserId = string;

export type AppUser = {
  id: AppUserId;
  label: string;
  role: AppRole;
  permissions: AppPermission[];
  presetTokens: boolean;
  plan: 'free' | 'pro' | 'enterprise';
};

export function toAppUser(profile: {
  username: string;
  label: string;
  role: AppRole;
  permissions: AppPermission[];
  presetTokens: boolean;
  plan: 'free' | 'pro' | 'enterprise';
}): AppUser {
  return {
    id: profile.username,
    label: profile.label,
    role: profile.role,
    permissions: profile.permissions,
    presetTokens: profile.presetTokens,
    plan: profile.plan,
  };
}
