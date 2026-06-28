# 投研助手 Beta 官网

公开营销站：macOS / Windows 桌面版下载、使用教程、Beta 标识与 X 反馈入口。

## 本地开发

```bash
# 在 monorepo 根目录
pnpm install
cp apps/site/.env.example apps/site/.env.local
# 编辑 .env.local，填入 NEXT_PUBLIC_CONTACT_X_URL

pnpm site:dev
```

打开 http://localhost:3001

## Vercel 部署

1. 在 Vercel 新建项目，Root Directory 设为 `apps/site`
2. 配置环境变量（见 `.env.example`）
3. 部署后启用 Vercel Analytics（项目 Settings → Analytics）

## 页面

| 路由 | 说明 |
|------|------|
| `/` | 首页 |
| `/download` | macOS / Windows 安装包下载 |
| `/docs` | 教程索引 |
| `/feedback` | X 反馈说明 |
