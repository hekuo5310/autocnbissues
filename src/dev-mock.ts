// 仅本地开发（DEV_MODE=true）时生效的 CNB mock 路由。
// 沙箱/离线环境无法出站访问 api.cnb.cool，用 mock 验证业务流程与 UI。
// 生产环境 DEV_MODE=false：每个 handler 会直接 next() 放行给真实路由，mock 永不生效。
// mock 的"已创建 issue / 已发评论"存 KV（本地 state 持久化），worker 重启不丢失。

import { Hono } from 'hono';
import type { Env } from './types';
import { getSession } from './auth';

const ISSUES_KEY = 'mock:issues';
const COMMENTS_KEY_PREFIX = 'mock:comments:';

type MockIssue = {
  number: number; title: string; body: string; state: 'open' | 'closed';
  labels: string[]; author: string; createdAt: string; lastActedAt: string; commentCount: number;
};
type MockComment = { id: string; author: string; body: string; createdAt: string; mineUid: number };

const BASE_ISSUES: MockIssue[] = [
  { number: 42, title: '播放器在全屏时切换清晰度体验不佳', state: 'open', labels: ['功能建议'], author: 'SDCOM', createdAt: '2026-09-23T08:12:00Z', lastActedAt: '2026-09-24T10:00:00Z', commentCount: 3, body: '## 这个功能要解决什么问题？\n\n全屏播放时想换清晰度必须退出全屏，很打断观看体验。\n\n## 设想的方案？如有\n\n希望播放控制栏常驻清晰度按钮。' },
  { number: 41, title: 'iOS Safari 下视频偶发黑屏有声音', state: 'open', labels: ['Bug:待鉴定'], author: 'miao-001', createdAt: '2026-09-22T14:40:00Z', lastActedAt: '2026-09-23T09:30:00Z', commentCount: 5, body: '## 简单描述一下问题和重现方式\n\n1. 打开番剧页\n2. 点击播放\n3. 期望画面正常\n4. 实际偶发黑屏，只有声音' },
  { number: 40, title: '网页加载速度比之前慢', state: 'closed', labels: ['体验报告'], author: 'demo-user', createdAt: '2026-09-21T10:00:00Z', lastActedAt: '2026-09-22T18:20:00Z', commentCount: 2, body: '## 整体体验\n\n最近两周首页首屏明显变慢，弱网下尤其明显。' },
];

const BASE_COMMENTS: Omit<MockComment, 'mineUid'>[] = [
  { id: '9001', author: 'MiaoJu-dev', body: '收到，已在内部排期，感谢反馈！', createdAt: '2026-09-23T09:00:00Z' },
  { id: '9002', author: 'another-user', body: '我也遇到这个问题，补充一下：`Chrome 130` 与 `Safari 18` 都能复现。', createdAt: '2026-09-23T11:25:00Z' },
  { id: '9003', author: '喵聚-客服', body: '新版本已发布，请升级后再试试，有问题欢迎继续反馈～', createdAt: '2026-09-24T10:00:00Z' },
];

async function getCreatedIssues(env: Env): Promise<MockIssue[]> {
  return (await env.KV.get<MockIssue[]>(ISSUES_KEY, 'json')) ?? [];
}
async function getComments(env: Env, n: number): Promise<MockComment[]> {
  return (await env.KV.get<MockComment[]>(COMMENTS_KEY_PREFIX + n, 'json')) ?? [];
}
async function nextNumber(env: Env): Promise<number> {
  const cur = Number((await env.KV.get('mock:seq')) || '500');
  await env.KV.put('mock:seq', String(cur + 1));
  return cur;
}

export const mockApp = new Hono<{ Bindings: Env }>();

mockApp.get('/api/issues', async (c, next) => {
  if (c.env.DEV_MODE !== 'true') return next();
  const state = c.req.query('state') || 'open';
  const created = await getCreatedIssues(c.env);
  const all = [...created, ...BASE_ISSUES].filter((i) => state === 'all' || i.state === state);
  return c.json({ ok: true, issues: all.map((i) => ({ ...i, isMine: i.number >= 500 })), page: 1, hasMore: false });
});

mockApp.get('/api/issues/:number', async (c, next) => {
  if (c.env.DEV_MODE !== 'true') return next();
  const n = Number(c.req.param('number'));
  const created = await getCreatedIssues(c.env);
  const i = created.find((x) => x.number === n) ?? BASE_ISSUES.find((x) => x.number === n);
  if (!i) return c.json({ ok: false, error: 'Issue 不存在（mock）' }, 404);
  return c.json({
    ok: true,
    issue: { ...i, closedAt: i.state === 'closed' ? '2026-09-22T18:20:00Z' : null },
    isMine: n >= 500,
  });
});

mockApp.get('/api/issues/:number/comments', async (c, next) => {
  if (c.env.DEV_MODE !== 'true') return next();
  const s = await getSession(c);
  const n = Number(c.req.param('number'));
  const mine = await getComments(c.env, n);
  const base = BASE_COMMENTS.map((cm) => ({ ...cm, authorUsername: cm.author, isMine: !!s && cm.id === '9003' }));
  const extra = mine.map((cm) => ({ ...cm, authorUsername: cm.author, isMine: !!s && cm.mineUid === s.uid }));
  return c.json({ ok: true, comments: [...base, ...extra], page: 1, hasMore: false });
});

mockApp.post('/api/issues/:number/comments', async (c, next) => {
  if (c.env.DEV_MODE !== 'true') return next();
  const s = await getSession(c);
  if (!s) return c.json({ ok: false, error: '请先登录' }, 401);
  const body = await c.req.json<{ body?: string }>().catch(() => ({ body: '' }));
  const text = (body.body ?? '').trim();
  if (!text || text.length > 4000) return c.json({ ok: false, error: '回复内容需在 1-4000 个字符之间' }, 400);
  const n = Number(c.req.param('number'));
  // 与生产逻辑一致：回复头部补充来源标注（用户邮箱）
  const fullBody = [
    `本条回复来自【${s.email}】`,
    '',
    `> 来自「${c.env.SITE_NAME}」用户 **${s.nickname}**（邮箱已验证）`,
    '',
    text,
  ].join('\n');
  const commentId = `mock-${Date.now()}`;
  const list = await getComments(c.env, n);
  list.push({ id: commentId, author: s.nickname, body: fullBody, createdAt: new Date().toISOString(), mineUid: s.uid });
  await c.env.KV.put(COMMENTS_KEY_PREFIX + n, JSON.stringify(list));
  await c.env.DB.prepare(
    'INSERT INTO user_comments (user_id, issue_number, comment_id, body, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(s.uid, n, commentId, text, Date.now())
    .run();
  return c.json({ ok: true, commentId });
});

mockApp.post('/api/issues', async (c, next) => {
  if (c.env.DEV_MODE !== 'true') return next();
  const s = await getSession(c);
  if (!s) return c.json({ ok: false, error: '请先登录' }, 401);
  const body = await c.req
    .json<{ title?: string; body?: string }>()
    .catch(() => ({ title: '', body: '' }));
  const title = (body.title ?? '').slice(0, 255);
  const number = await nextNumber(c.env);
  const now = new Date().toISOString();
  const list = await getCreatedIssues(c.env);
  // 与生产逻辑一致：创建后立刻在尾部追加来源标注（用户邮箱）
  const finalBody = `${body.body || `（mock 正文）${title}`}\n\n---\n\n本条issues来自【${s.email}】`;
  list.unshift({
    number, title,
    body: finalBody,
    state: 'open', labels: [], author: s.nickname, createdAt: now, lastActedAt: now, commentCount: 0,
  });
  await c.env.KV.put(ISSUES_KEY, JSON.stringify(list));
  await c.env.DB.prepare(
    'INSERT INTO user_issues (user_id, issue_number, template_key, title, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(s.uid, number, 'mock', title, Date.now())
    .run();
  return c.json({ ok: true, number });
});

mockApp.get('/api/my/issues', async (c, next) => {
  if (c.env.DEV_MODE !== 'true') return next();
  const s = await getSession(c);
  if (!s) return c.json({ ok: false, error: '请先登录' }, 401);
  const created = await getCreatedIssues(c.env);
  const rows = await c.env.DB.prepare(
    'SELECT issue_number, title, created_at FROM user_issues WHERE user_id = ? ORDER BY created_at DESC LIMIT 15',
  )
    .bind(s.uid)
    .all<{ issue_number: number; title: string; created_at: number }>();
  const issues = (rows.results ?? []).map((r) => {
    const known = created.find((i) => i.number === r.issue_number) ?? BASE_ISSUES.find((i) => i.number === r.issue_number);
    return {
      number: r.issue_number,
      title: known?.title ?? r.title,
      state: known?.state ?? 'open',
      labels: known?.labels ?? [],
      commentCount: known?.commentCount ?? 0,
      createdAt: known?.createdAt ?? new Date(r.created_at).toISOString(),
      isMine: true,
    };
  });
  return c.json({ ok: true, issues, page: 1, hasMore: false });
});
