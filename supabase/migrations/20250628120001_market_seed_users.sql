-- 迁移现有硬编码账号到 market_users（密码为 bcrypt，非明文）
-- adminwb / test 与 README 保持一致

insert into public.market_users (
  username,
  password_hash,
  label,
  role,
  permissions,
  preset_tokens,
  plan
) values
  (
    'adminwb',
    '$2b$12$ZRXr4cZQOwFId5BJRCz9MuXh6qDF0oTCkEiEdKbRWtIVWgXsS0u36',
    '管理员',
    'admin',
    array['backtest', 'admin']::text[],
    true,
    'pro'
  ),
  (
    'test',
    '$2b$12$/KhN.Tgh.Y.zWrAAe./lQOgSbGZzOQesOLEG3YDEX4Q.7gQGtz5LK',
    '测试账号',
    'member',
    array[]::text[],
    false,
    'free'
  )
on conflict (username) do update set
  password_hash = excluded.password_hash,
  label = excluded.label,
  role = excluded.role,
  permissions = excluded.permissions,
  preset_tokens = excluded.preset_tokens,
  plan = excluded.plan,
  updated_at = now();
