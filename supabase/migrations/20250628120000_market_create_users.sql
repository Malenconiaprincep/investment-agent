-- Market 产品线用户表（表名统一 market_ 前缀）
-- 对应 apps/web 本地用户模型：username / role / permissions / preset_tokens

create or replace function public.market_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.market_users (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  password_hash text not null,
  label text not null default '',
  role text not null default 'member'
    check (role in ('member', 'admin')),
  permissions text[] not null default '{}'::text[],
  preset_tokens boolean not null default false,
  plan text not null default 'free'
    check (plan in ('free', 'pro', 'enterprise')),
  email text,
  supabase_auth_id uuid unique,
  is_active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint market_users_username_key unique (username),
  constraint market_users_email_key unique (email),
  constraint market_users_permissions_valid check (
    permissions <@ array['backtest', 'admin', 'screen', 'research', 'committee', 'signals', 'etf_pick']::text[]
  )
);

comment on table public.market_users is 'Market 投研工作台用户（账号、角色、功能权限）';
comment on column public.market_users.permissions is '功能权限点，与 apps/web/lib/permissions.ts 对齐';
comment on column public.market_users.preset_tokens is '登录时是否预置 admin 默认 API Token';
comment on column public.market_users.supabase_auth_id is '预留：对接 Supabase Auth 时关联 auth.users.id';

create index if not exists market_users_username_idx on public.market_users (username);
create index if not exists market_users_role_idx on public.market_users (role);
create index if not exists market_users_plan_idx on public.market_users (plan);
create index if not exists market_users_is_active_idx on public.market_users (is_active);

drop trigger if exists market_users_set_updated_at on public.market_users;
create trigger market_users_set_updated_at
  before update on public.market_users
  for each row
  execute function public.market_set_updated_at();

alter table public.market_users enable row level security;

-- 默认不开放 anon/authenticated 直连；Web 服务端用 service_role 访问
-- 后续接 Supabase Auth 时可加：using (auth.uid() = supabase_auth_id)
