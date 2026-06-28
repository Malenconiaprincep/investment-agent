# Supabase · Market 用户表

Market 产品线数据库表统一使用 **`market_` 前缀**（对应产品名 Market）。

## 项目信息

| 项 | 值 |
|---|---|
| Project ref | `jixkzyrresmceaekjian` |
| MCP URL | `https://mcp.supabase.com/mcp?project_ref=jixkzyrresmceaekjian` |
| 用户表 | `public.market_users` |

## Cursor MCP 配置

在 Cursor **Settings → MCP** 或 `~/.cursor/mcp.json` 中加入：

```json
{
  "mcpServers": {
    "supabase": {
      "url": "https://mcp.supabase.com/mcp?project_ref=jixkzyrresmceaekjian"
    }
  }
}
```

首次连接会打开浏览器完成 Supabase 授权。授权后可在对话里让 Agent 执行 `apply_migration` / `list_tables`。

## 表结构 `market_users`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | uuid | 主键 |
| username | text | 登录名，唯一 |
| password_hash | text | bcrypt 哈希 |
| label | text | 显示名称 |
| role | text | `member` / `admin` |
| permissions | text[] | 功能权限，如 `backtest`, `admin` |
| preset_tokens | boolean | 是否预置 API Token |
| plan | text | `free` / `pro` / `enterprise` |
| email | text | 可选，预留 |
| supabase_auth_id | uuid | 预留，对接 Supabase Auth |
| is_active | boolean | 是否启用 |
| last_login_at | timestamptz | 最近登录 |
| created_at / updated_at | timestamptz | 审计字段 |

已启用 RLS；Web 服务端应使用 **service_role** 访问，不要在前端暴露。

## 应用迁移

### 方式 A：Supabase MCP（推荐）

连接 MCP 后，对 Agent 说：

> 对项目 jixkzyrresmceaekjian 执行 `supabase/migrations/` 里的 market 迁移

### 方式 B：Dashboard SQL Editor

1. 打开 [Supabase SQL Editor](https://supabase.com/dashboard/project/jixkzyrresmceaekjian/sql)
2. 依次粘贴并运行：
   - `supabase/migrations/20250628120000_market_create_users.sql`
   - `supabase/migrations/20250628120001_market_seed_users.sql`

### 方式 C：Management API 脚本

```bash
export SUPABASE_ACCESS_TOKEN=sbp_xxxx   # Account → Access Tokens
node scripts/apply-supabase-migration.mjs
```

## Web 环境变量（后续接入时用）

```env
SUPABASE_URL=https://jixkzyrresmceaekjian.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...       # 仅服务端，勿提交 git
# 或 anon key + RLS 策略（接 Auth 后）
```

## 注册与登录

Web 工作台已接入 Supabase `market_users` 表：

- **注册** `/register`：创建免费 member 账号（无高级权限）
- **登录** `/login`：验证 bcrypt 密码，写入 JWT 会话 Cookie
- **权限**：注册默认 `plan=free`、`permissions=[]`；管理员可在 Supabase 表内为账号追加 `backtest` 等权限

生产环境请在 `apps/web/.env` 配置：

```env
SUPABASE_URL=https://jixkzyrresmceaekjian.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
AUTH_SESSION_SECRET=...   # openssl rand -base64 32
```

## 初始账号

迁移 `market_seed_users` 会写入与本地 `apps/web/lib/users.ts` 相同的两个账号（密码哈希存储，非明文）。密码仍为你现有的 adminwb / test 密码，用于平滑切换。

## 后续表命名约定

| 表名 | 用途 |
|---|---|
| `market_users` | 用户与权限 |
| `market_subscriptions` | 订阅套餐（待建） |
| `market_usage_logs` | API/LLM 用量（待建） |
