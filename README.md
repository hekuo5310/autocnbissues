# 喵聚 Issues（autocnbissues）

通过 **CNB OpenAPI** 帮助用户向 [`cnb.cool/MiaoJu/issue`](https://cnb.cool/MiaoJu/issue) 提交 Issue 的轻量平台，部署于 **Cloudflare Workers + D1 + KV**。

用户无需注册 CNB 账号：使用 **邮箱验证码** 登录后，选择仓库提供的 Issue 模板填写提交；之后可随时查看所有 Issue、阅读评论并以自己的昵称回复。

## 功能特性

- **模板化提交**：实时读取 `MiaoJu/issue` 仓库 `.cnb/ISSUE_TEMPLATE/` 下的 5 个模板（功能建议 / Bug 反馈 / 体验问题 / 服务异常 / 安全漏洞），动态渲染表单（必填校验、placeholder、说明文字），并自动带上模板标签；支持自由提交
- **邮箱验证码登录**：6 位验证码、10 分钟有效、60 秒发送冷却、同 IP 每小时限 10 封、5 次尝试上限，会话 7 天有效（HttpOnly Cookie）
- **Issue 浏览**：进行中 / 已关闭 / 全部筛选，关键词搜索，分页，"我提交的"标记
- **评论回复**：Markdown 渲染，回复自动署名（昵称 + 脱敏邮箱），"我回复的"标记
- **个人资料**：昵称修改、我的提交列表
- **安全**：CNB Token 仅存服务端 Secret；提交频率限制（每小时 3 个 Issue、每分钟 1 条回复）；所有用户输入经校验与转义

## 技术栈

| 组件 | 说明 |
|------|------|
| Cloudflare Workers | 应用本体（Hono 路由 + Static Assets 前端） |
| D1 | 用户、用户提交的 Issue 映射、用户评论记录 |
| KV | 邮箱验证码、会话、频率限制、模板缓存（1 小时） |
| Email Service（`send_email` binding） | Workers 原生邮件发送（新功能），发送验证码邮件 |
| CNB OpenAPI | `api.cnb.cool`：创建/查询 Issue、评论 |

前端为无构建步骤的原生 SPA（`public/`），由 Workers Static Assets 直接服务；Markdown 渲染使用 marked + DOMPurify（CDN，加载失败时自动降级纯文本）。

## 部署步骤

### 0. 准备

- 一个 Cloudflare 账号
- 一个已托管到 Cloudflare 的域名（用于发件，如 `your-domain.com`）
- 一个 CNB Personal Access Token（具备对 `MiaoJu/issue` 的 Issue 读写权限）

### 1. 创建 D1 与 KV

```bash
npm install

# 创建 D1 数据库，把输出中的 database_id 填入 wrangler.jsonc
npx wrangler d1 create autocnb-issues

# 创建 KV 命名空间，把输出中的 id 填入 wrangler.jsonc
npx wrangler kv namespace create CACHE
```

### 2. 配置发件域名（Email Sending）

打开 Cloudflare Dashboard → **Compute (Workers) → Email Service → Email Sending → Onboard Domain**，选择你的域名完成接入（自动配置 SPF / DKIM / DMARC / bounce MX 记录）。

然后把 `wrangler.jsonc` 中的 `MAIL_FROM` 改为该域名下的地址（如 `noreply@your-domain.com`）。

> 说明：`send_email` binding 未配置收件限制时，可将邮件发往任意收件人；发件人地址必须属于已接入 Email Sending 的域名。

### 3. 配置变量与密钥

编辑 `wrangler.jsonc` 的 `vars`：

| 变量 | 说明 |
|------|------|
| `CNB_REPO` | 目标仓库，默认 `MiaoJu/issue` |
| `SITE_NAME` | 站点名称（邮件标题、署名中使用） |
| `SITE_URL` | 部署后的站点地址（workers.dev 或自定义域） |
| `MAIL_FROM` / `MAIL_FROM_NAME` | 发件邮箱 / 发件人名 |
| `CNB_API` | CNB API 根地址，默认 `https://api.cnb.cool` |
| `DEV_MODE` | **生产必须为 `false`** |

写入 CNB Token（Secret，不要写进配置文件）：

```bash
npx wrangler secret put CNB_TOKEN
# 按提示粘贴你的 CNB Personal Access Token
```

### 4. 初始化数据库并部署

```bash
# 初始化远端 D1 表结构
npx wrangler d1 execute autocnb-issues --remote --file=migrations/0001_init.sql

# 部署
npx wrangler deploy
```

部署完成后访问 `https://autocnb-issues.<your-subdomain>.workers.dev`（或你在 `SITE_URL` 配置的地址）即可使用。

## 本地开发

```bash
cp .dev.vars.example .dev.vars   # 按需修改（CNB_TOKEN 必填）
npx wrangler d1 execute autocnb-issues --local --file=migrations/0001_init.sql
npm run dev                      # http://localhost:8787
```

`.dev.vars` 中设置 `DEV_MODE=true` 时：

- 邮件发送走本地模拟（不会真实发信）；
- `src/dev-mock.ts` 提供的 CNB mock 生效（列表 / 详情 / 评论为内置假数据，创建 Issue 与回复写入本地 D1，业务闭环可测）。生产环境 `DEV_MODE=false` 时 mock 完全不生效。
- 模板接口会先尝试从 CNB 实时拉取并缓存到 KV；无法出网时可直接向本地 KV 写入内置快照：

```bash
npx wrangler kv key put "tpl:miaoju:v1" --path=src/builtin-templates.json --binding=KV --local
```

## API 一览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/config` | 站点配置 |
| GET | `/api/templates` | Issue 模板列表（CNB 实时 + KV 缓存 + 内置兜底） |
| POST | `/api/auth/send-code` | 发送邮箱验证码 |
| POST | `/api/auth/verify` | 校验验证码并登录/注册 |
| POST | `/api/auth/logout` | 退出登录 |
| GET | `/api/auth/me` | 当前用户 |
| PUT | `/api/me` | 修改昵称 |
| GET | `/api/issues` | Issue 列表（state/page/page_size/keyword） |
| POST | `/api/issues` | 提交 Issue（需登录） |
| GET | `/api/issues/:number` | Issue 详情 |
| GET | `/api/issues/:number/comments` | 评论列表 |
| POST | `/api/issues/:number/comments` | 发表回复（需登录） |
| GET | `/api/my/issues` | 我的提交（需登录） |

## 目录结构

```
├── src/
│   ├── index.ts        # Worker 入口 + API 路由（Hono）
│   ├── auth.ts         # 验证码 / 会话 / 频率限制
│   ├── email.ts        # 验证码邮件（send_email binding）
│   ├── cnb.ts          # CNB OpenAPI 客户端
│   ├── templates.ts    # 模板拉取 / 解析 / 正文渲染
│   ├── dev-mock.ts     # 本地开发 mock（仅 DEV_MODE）
│   └── builtin-templates.json  # 模板内置快照（兜底）
├── public/             # 前端 SPA（无构建）
├── migrations/         # D1 表结构
├── wrangler.jsonc      # Workers 配置
└── .dev.vars.example   # 本地开发变量示例
```

## 常见问题

- **验证码收不到**：检查发件域名是否已在 Email Sending 完成接入；查看 Worker 日志中的 `E_SENDER_NOT_VERIFIED` 等错误码。
- **提交 Issue 报 CNB 权限错误**：确认 `CNB_TOKEN` 具备目标仓库的 Issue 写权限，且 `CNB_REPO` 配置正确。
- **模板没有更新**：模板有 1 小时 KV 缓存；如需立即生效可删除 KV key `tpl:miaoju:v1`，或直接部署（内置快照会兜底）。
