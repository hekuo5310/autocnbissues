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
  invisible?: boolean;
  state_reason?: string;
};
type MockComment = { id: string; author: string; body: string; createdAt: string; mineUid: number };

const PIN_LABEL = '置顶';

function mockRepoBase(env: Env): string {
  return `https://cnb.cool/${env.CNB_REPO}`;
}

function parseLinkEntries(body: string): Array<{ type: 'issue'; number: number; url: string } | { type: 'commit'; sha: string; url: string }> {
  const links: Array<{ type: 'issue'; number: number; url: string } | { type: 'commit'; sha: string; url: string }> = [];
  const lineRe = /^- \[(?:Issue #(\d+)|提交 ([0-9a-f]{7,40}))\]\(([^)\s]+)\)\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = lineRe.exec(body))) {
    if (m[1]) links.push({ type: 'issue', number: Number(m[1]), url: m[3] });
    else if (m[2]) links.push({ type: 'commit', sha: m[2].toLowerCase(), url: m[3] });
  }
  return links;
}

function stripLinkSections(body: string): string {
  return body
    .replace(/\n*### 关联 Issue\n(?:- \[[^\]]*\]\([^)]*\)\n?)+/g, '')
    .replace(/\n*### 关联提交\n(?:- \[[^\]]*\]\([^)]*\)\n?)+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

function rebuildBodyWithLinks(body: string, links: ReturnType<typeof parseLinkEntries>, env: Env): string {
  const base = stripLinkSections(body);
  const issues = links.filter((l) => l.type === 'issue');
  const commits = links.filter((l) => l.type === 'commit');
  let out = base;
  if (issues.length) {
    out += '\n\n### 关联 Issue\n' + issues.map((l) => `- [Issue #${l.number}](${mockRepoBase(env)}/-/issues/${l.number})`).join('\n');
  }
  if (commits.length) {
    out += '\n\n### 关联提交\n' + commits.map((l) => `- [提交 ${l.sha.slice(0, 10)}](${mockRepoBase(env)}/-/commit/${l.sha})`).join('\n');
  }
  return out;
}

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
  const privateRows = await c.env.DB.prepare('SELECT issue_number FROM private_issues').all<{ issue_number: number }>();
  const d1Private = new Set((privateRows.results ?? []).map((r) => r.issue_number));
  return c.json({
    ok: true,
    issues: all
      .map((i) => ({
        ...i,
        invisible: !!i.invisible || d1Private.has(i.number),
        pinned: i.labels.includes(PIN_LABEL),
        stateReason: i.state_reason || null,
        isMine: i.number >= 500,
      }))
      // 私密 issue 仅本人可见（与生产一致）
      .filter((x) => !x.invisible || x.isMine),
    page: 1,
    hasMore: false,
  });
});

mockApp.get('/api/issues/:number', async (c, next) => {
  if (c.env.DEV_MODE !== 'true') return next();
  const n = Number(c.req.param('number'));
  const created = await getCreatedIssues(c.env);
  const i = created.find((x) => x.number === n) ?? BASE_ISSUES.find((x) => x.number === n);
  if (!i) return c.json({ ok: false, error: 'Issue 不存在（mock）' }, 404);
  const d1PrivateRow = !!(await c.env.DB.prepare('SELECT 1 FROM private_issues WHERE issue_number = ?').bind(n).first());
  const isPrivate = !!i.invisible || d1PrivateRow;
  // 私密 issue 仅本人可见（与生产一致）
  if (isPrivate && n < 500) return c.json({ ok: false, error: 'Issue 不存在或不可见' }, 404);
  return c.json({
    ok: true,
    issue: {
      ...i,
      invisible: isPrivate,
      pinned: i.labels.includes(PIN_LABEL),
      stateReason: i.state_reason || null,
      links: parseLinkEntries(i.body),
      closedAt: i.state === 'closed' ? '2026-09-22T18:20:00Z' : null,
    },
    isMine: n >= 500,
  });
});

mockApp.patch('/api/issues/:number', async (c, next) => {
  if (c.env.DEV_MODE !== 'true') return next();
  const s = await getSession(c);
  if (!s) return c.json({ ok: false, error: '请先登录' }, 401);
  const n = Number(c.req.param('number'));
  // 与生产逻辑一致：只能管理自己提交的 Issue（user_issues 表归属校验）
  const owned = await c.env.DB.prepare('SELECT issue_number FROM user_issues WHERE user_id = ? AND issue_number = ?')
    .bind(s.uid, n)
    .first();
  if (!owned) return c.json({ ok: false, error: '只能管理自己提交的 Issue' }, 403);
  const body = await c.req.json<{ state?: string; state_reason?: string; invisible?: boolean }>().catch(() => ({}) as { state?: string; state_reason?: string; invisible?: boolean });
  // 与生产逻辑一致：参数校验
  if (body.state !== undefined && body.state !== 'open' && body.state !== 'closed') {
    return c.json({ ok: false, error: '无效的 Issue 状态' }, 400);
  }
  if (body.state === 'closed') {
    if (body.state_reason !== undefined && body.state_reason !== 'completed' && body.state_reason !== 'not_planned') {
      return c.json({ ok: false, error: '无效的关闭原因' }, 400);
    }
  }
  if (body.invisible !== undefined && typeof body.invisible !== 'boolean') {
    return c.json({ ok: false, error: '无效的私密设置' }, 400);
  }
  if (body.state === undefined && body.invisible === undefined) {
    return c.json({ ok: false, error: '没有需要修改的内容' }, 400);
  }
  const created = await getCreatedIssues(c.env);
  const idx = created.findIndex((x) => x.number === n);
  if (idx === -1) return c.json({ ok: false, error: 'mock 中不存在该 Issue' }, 404);
  if (body.state === 'open' || body.state === 'closed') {
    created[idx].state = body.state;
    created[idx].state_reason = body.state === 'closed' ? (body.state_reason || 'completed') : 'reopened';
  }
  if (typeof body.invisible === 'boolean') {
    created[idx].invisible = body.invisible;
    // 与生产一致：私密状态同时落 D1（站点级兜底）
    if (body.invisible === true) {
      await c.env.DB.prepare('INSERT OR REPLACE INTO private_issues (issue_number, set_at, set_by) VALUES (?, ?, ?)')
        .bind(n, Date.now(), s.uid)
        .run();
    } else {
      await c.env.DB.prepare('DELETE FROM private_issues WHERE issue_number = ?').bind(n).run();
    }
  }
  await c.env.KV.put(ISSUES_KEY, JSON.stringify(created));
  return c.json({
    ok: true,
    state: created[idx].state,
    stateReason: created[idx].state_reason || null,
    invisible: !!created[idx].invisible,
    ...(typeof body.invisible === 'boolean' ? { cnbApplied: true } : {}),
  });
});

mockApp.post('/api/issues/:number/pin', async (c, next) => {
  if (c.env.DEV_MODE !== 'true') return next();
  const s = await getSession(c);
  if (!s) return c.json({ ok: false, error: '请先登录' }, 401);
  const n = Number(c.req.param('number'));
  const owned = await c.env.DB.prepare('SELECT issue_number FROM user_issues WHERE user_id = ? AND issue_number = ?')
    .bind(s.uid, n)
    .first();
  if (!owned) return c.json({ ok: false, error: '只能管理自己提交的 Issue' }, 403);
  const created = await getCreatedIssues(c.env);
  const idx = created.findIndex((x) => x.number === n);
  if (idx === -1) return c.json({ ok: false, error: 'mock 中不存在该 Issue' }, 404);
  const pinned = created[idx].labels.includes(PIN_LABEL);
  created[idx].labels = pinned ? created[idx].labels.filter((l) => l !== PIN_LABEL) : [...created[idx].labels, PIN_LABEL];
  await c.env.KV.put(ISSUES_KEY, JSON.stringify(created));
  return c.json({ ok: true, pinned: !pinned, labelSynced: true });
});

mockApp.post('/api/issues/:number/links', async (c, next) => {
  if (c.env.DEV_MODE !== 'true') return next();
  const s = await getSession(c);
  if (!s) return c.json({ ok: false, error: '请先登录' }, 401);
  const n = Number(c.req.param('number'));
  const owned = await c.env.DB.prepare('SELECT issue_number FROM user_issues WHERE user_id = ? AND issue_number = ?')
    .bind(s.uid, n)
    .first();
  if (!owned) return c.json({ ok: false, error: '只能管理自己提交的 Issue' }, 403);
  const body = await c.req.json<{ type?: string; value?: string }>().catch(() => ({}) as { type?: string; value?: string });
  const created = await getCreatedIssues(c.env);
  const idx = created.findIndex((x) => x.number === n);
  if (idx === -1) return c.json({ ok: false, error: 'mock 中不存在该 Issue' }, 404);
  const links = parseLinkEntries(created[idx].body);
  if (body.type === 'issue') {
    const m = (body.value || '').trim().match(/^#?(\d+)$/);
    if (!m) return c.json({ ok: false, error: '请输入有效的 Issue 编号' }, 400);
    const num = Number(m[1]);
    if (num === n) return c.json({ ok: false, error: '不能绑定 Issue 自身' }, 400);
    if (links.some((l) => l.type === 'issue' && l.number === num)) return c.json({ ok: false, error: '该条目已绑定' }, 400);
    links.push({ type: 'issue', number: num, url: `${mockRepoBase(c.env)}/-/issues/${num}` });
  } else if (body.type === 'commit') {
    let m = (body.value || '').trim().match(/^([0-9a-f]{7,40})$/i);
    if (!m) m = (body.value || '').trim().match(/\/-commit\/([0-9a-f]{7,40})/i);
    if (!m) return c.json({ ok: false, error: '请输入有效的提交 SHA 或提交链接' }, 400);
    const sha = m[1].toLowerCase();
    if (links.some((l) => l.type === 'commit' && l.sha === sha)) return c.json({ ok: false, error: '该条目已绑定' }, 400);
    links.push({ type: 'commit', sha, url: `${mockRepoBase(c.env)}/-/commit/${sha}` });
  } else {
    return c.json({ ok: false, error: '无效的绑定类型' }, 400);
  }
  created[idx].body = rebuildBodyWithLinks(created[idx].body, links, c.env);
  await c.env.KV.put(ISSUES_KEY, JSON.stringify(created));
  return c.json({ ok: true, links });
});

mockApp.delete('/api/issues/:number/links', async (c, next) => {
  if (c.env.DEV_MODE !== 'true') return next();
  const s = await getSession(c);
  if (!s) return c.json({ ok: false, error: '请先登录' }, 401);
  const n = Number(c.req.param('number'));
  const owned = await c.env.DB.prepare('SELECT issue_number FROM user_issues WHERE user_id = ? AND issue_number = ?')
    .bind(s.uid, n)
    .first();
  if (!owned) return c.json({ ok: false, error: '只能管理自己提交的 Issue' }, 403);
  const body = await c.req.json<{ type?: string; value?: string }>().catch(() => ({}) as { type?: string; value?: string });
  const created = await getCreatedIssues(c.env);
  const idx = created.findIndex((x) => x.number === n);
  if (idx === -1) return c.json({ ok: false, error: 'mock 中不存在该 Issue' }, 404);
  const links = parseLinkEntries(created[idx].body);
  const kept = links.filter((l) => {
    if (body.type === 'issue') return !(l.type === 'issue' && l.number === Number((body.value || '').replace(/^#/, '')));
    if (body.type === 'commit') return !(l.type === 'commit' && l.sha === (body.value || '').toLowerCase());
    return true;
  });
  if (kept.length === links.length) return c.json({ ok: false, error: '未找到该绑定条目' }, 404);
  created[idx].body = rebuildBodyWithLinks(created[idx].body, kept, c.env);
  await c.env.KV.put(ISSUES_KEY, JSON.stringify(created));
  return c.json({ ok: true, links: kept });
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
  return c.json({ ok: true, number, labelsApplied: true });
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
      stateReason: known?.state_reason || null,
      invisible: !!known?.invisible,
      pinned: (known?.labels ?? []).includes(PIN_LABEL),
      labels: known?.labels ?? [],
      commentCount: known?.commentCount ?? 0,
      createdAt: known?.createdAt ?? new Date(r.created_at).toISOString(),
      isMine: true,
    };
  });
  return c.json({ ok: true, issues, page: 1, hasMore: false });
});
