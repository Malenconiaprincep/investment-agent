# Design

## Theme

Product UI · 深色投研工作台 · 暖色点缀（非科技蓝紫）

## Color Palette

| Token | Value | Usage |
|-------|-------|--------|
| `--bg` | `#0b0d10` | 页面背景（带暖灰，非纯黑） |
| `--bg-elevated` | `#12151a` | 顶栏、侧栏 |
| `--surface` | `#161a21` | 输入、面板 |
| `--border` | `#2a3038` | 分隔线 |
| `--border-strong` | `#3d4550` | 悬停边框 |
| `--text` | `#e8eaed` | 正文 |
| `--text-muted` | `#9aa3ad` | 次要文字（非彩色底上的灰字） |
| `--accent` | `#c9924a` | 主操作、当前步骤（琥珀金） |
| `--accent-hover` | `#dbaa62` | 主操作悬停 |
| `--accent-muted` | `rgba(201, 146, 74, 0.12)` | 选中背景 |
| `--link` | `#7eb8da` | 链接 |
| `--success` | `#5cb87a` | PASS |
| `--danger` | `#e07070` | FAIL / 错误 |

## Typography

- **UI**：IBM Plex Sans（拉丁）+ PingFang SC / Microsoft YaHei（中文）
- **标题（H1）**：Noto Serif SC，600 — 仅页面标题，不用在按钮/标签
- **Scale**：0.75 / 0.875 / 1 / 1.125 / 1.375 rem（固定 rem，非 fluid）
- **Prose**：研报 Markdown 最大宽度 72ch

## Components

- **Button primary**：实心琥珀，圆角 6px，hover 提亮，disabled 60% 透明度
- **Button secondary**：透明 + 边框，hover 浅底
- **Input**：surface 底 + border，focus 琥珀 outline-offset
- **Pipeline step**：胶囊标签，active = accent 边框 + muted 底，done = success 边框
- **Panel**：单层 surface + 顶部分隔标题，禁止 panel 内再套 panel
- **Table**：全宽，斑马纹极浅，表头 sticky（长列表）

## Layout

- 内容区 `max-width: 1080px`，大屏选股页可用 `layout-split`（280px 侧栏 + 主区）
- 顶栏固定高度 56px，导航 + 当前路由指示
- 区块间距 24px / 32px

## Motion

- 150–200ms ease（非 bounce）
- 步骤切换仅 opacity / border-color
