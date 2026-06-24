export type AppUserId = 'adminwb' | 'test';

export type AppUser = {
  id: AppUserId;
  password: string;
  presetTokens: boolean;
  label: string;
};

export const APP_USERS: Record<AppUserId, AppUser> = {
  adminwb: {
    id: 'adminwb',
    password: 'Wb@Invest2026!xK9',
    presetTokens: true,
    label: '管理员',
  },
  test: {
    id: 'test',
    password: 'test123456',
    presetTokens: false,
    label: '测试账号',
  },
};

export function isAppUserId(value: string): value is AppUserId {
  return value in APP_USERS;
}

export function getAppUser(id: AppUserId): AppUser {
  return APP_USERS[id];
}
