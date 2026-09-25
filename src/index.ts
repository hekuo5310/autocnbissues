// 喵聚 Issues —— Cloudflare Workers 入口
// 路由: /api/* 为后端接口；其余路径由 public/ 静态资源(SPA)响应

import { Hono } from 'hono';
import type { Env, SessionData, CnbIssue } from './types';
import { CnbApiError, listIssues, getIssue, listComments, createIssue, updateIssue, createComment, labelNames } from './cnb';
import { getTemplates, findTemplate, renderIssueBody } from './templates';
import { sendCode, verifyCode, logout, getSession, requireSession, refreshSession, maskEmail } from './auth';
import { mockApp } from './dev-mock';

type C = { Bindings: Env };

const app = new Hono<C>();

// 本地开发 mock（DEV_MODE=true 时接管 CNB 相关路由；生产直接放行）
app.route('/', mockApp);


app.onError((err, c) => {
  if (err instanceof CnbApiError) {
    return c.json({ ok: false, error: `CNB: ${err.message}` }, err.status === 404 ? 404 : 502);
  }
  console.error('[api] unexpected error:', err?.stack || err);
  return c.json({ ok: false, error: '服务器内部错误，请稍后再试' }, 500);
});

// ---------- 基础信息 ----------

app.get('/api/config', (c) => {
  return c.json({
    ok: true,
    siteName: c.env.SITE_NAME,
    repo: c.env.CNB_REPO,
    repoUrl: `https://cnb.cool/${c.env.CNB_REPO}`,
    devMode: c.env.DEV_MODE === 'true',
  });
});

app.get('/api/templates', async (c) => {
  const cfg = await getTemplates(c.env);
  return c.json({
    ok: true,
    blankIssuesEnabled: cfg.blankIssuesEnabled,
    templates: cfg.templates.map((t) => ({
      key: t.key,
      name: t.name,
      description: t.description,
      labels: t.labels,
      body: t.body,
    })),
  });
});

// ---------- 认证 ----------

app.post('/api/auth/send-code', (c) => sendCode(c));
app.post('/api/auth/verify', (c) => verifyCode(c));
app.post('/api/auth/logout', (c) => logout(c));

app.get('/api/auth/me', async (c) => {
  const s = await getSession(c);
  if (!s) return c.json({ ok: true, user: null });
  return c.json({ ok: true, user: s });
});

app.put('/api/me', async (c) => {
  const s = await requireSession(c);
  if (s instanceof Response) return s;
  const body = await c.req.json<{ nickname?: string }>().catch(() => ({ nickname: '' }));
  const nickname = (body.nickname ?? '').trim();
  if (nickname.length < 1 || nickname.length > 24) {
    return c.json({ ok: false, error: '昵称长度需在 1-24 个字符之间' }, 400);
  }
  await c.env.DB.prepare('UPDATE users SET nickname = ? WHERE id = ?').bind(nickname, s.uid).run();
  const next: SessionData = { ...s, nickname };
  await refreshSession(c, next);
  return c.json({ ok: true, user: next });
});

// ---------- 提交 Issue ----------

app.post('/api/issues', async (c) => {
  const s = await requireSession(c);
  if (s instanceof Response) return s;

  const body = await c.req
    .json<{ template?: string; title?: string; fields?: Record<string, string> }>()
    .catch(() => ({ template: '', title: '', fields: {} }));
  const tplKey = (body.template ?? '').trim();
  const title = (body.title ?? '').trim();
  const fields = body.fields ?? {};

  if (title.length < 2 || title.length > 255) {
    return c.json({ ok: false, error: '标题长度需在 2-255 个字符之间' }, 400);
  }

  const cfg = await getTemplates(c.env);
  const tpl = findTemplate(cfg, tplKey);
  if (!tpl) return c.json({ ok: false, error: '模板不存在，请刷新页面重试' }, 400);

  let issueBody: string;
  try {
    issueBody = renderIssueBody(tpl, fields);
  } catch (e) {
    return c.json({ ok: false, error: (e as Error).message }, 400);
  }

  // 频率限制：每用户每小时最多 3 个新 Issue
  const hour = Math.floor(Date.now() / 3600_000);
  const rlKey = `rl.issue:${s.uid}:${hour}`;
  const count = Number((await c.env.KV.get(rlKey)) || '0');
  if (count >= 3) {
    return c.json({ ok: false, error: '提交太频繁啦，每小时最多提交 3 个 Issue，请稍后再试' }, 429);
  }

  const fullBody = [
    `> 本 Issue 由「${c.env.SITE_NAME}」平台用户 **${s.nickname}**（邮箱已验证：${maskEmail(s.email)}）提交`,
    '',
    issueBody,
  ].join('\n');

  const issue = await createIssue(c.env, { title, body: fullBody, labels: tpl.labels });

  // 创建完成后立刻修改内容：在尾部追加来源标注（用户邮箱）
  try {
    await updateIssue(c.env, issue.number, {
      body: `${fullBody}\n\n---\n\n本条issues来自【${s.email}】`,
    });
  } catch (e) {
    // 追加标注失败不影响 Issue 已创建的结果
    console.error('[api] issue 来源标注追加失败:', e);
  }

  await c.env.DB.prepare(
    'INSERT INTO user_issues (user_id, issue_number, template_key, title, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(s.uid, Number(issue.number), tplKey === '__blank__' ? '__blank__' : tplKey, title, Date.now())
    .run();
  await c.env.KV.put(rlKey, String(count + 1), { expirationTtl: 3600 });

  return c.json({ ok: true, number: issue.number, url: `${c.env.SITE_URL}/#/issue/${issue.number}` });
});

// ---------- Issue 列表 / 详情 / 评论 ----------

async function myIssueNumbers(c: { env: Env }, session: SessionData | null): Promise<Set<number>> {
  if (!session) return new Set();
  const rows = await c.env.DB.prepare('SELECT issue_number FROM user_issues WHERE user_id = ?')
    .bind(session.uid)
    .all<{ issue_number: number }>();
  return new Set((rows.results ?? []).map((r) => r.issue_number));
}

app.get('/api/issues', async (c) => {
  const state = c.req.query('state') || 'open';
  const page = Number(c.req.query('page') || '1');
  const pageSize = Math.min(Number(c.req.query('page_size') || '15'), 50);
  const keyword = (c.req.query('keyword') || '').slice(0, 80);

  const session = await getSession(c);
  const issues = await listIssues(c.env, { state, page, pageSize, keyword });
  const mine = await myIssueNumbers(c, session);

  return c.json({
    ok: true,
    issues: issues.map((i) => ({
      number: Number(i.number),
      title: i.title,
      state: i.state,
      labels: labelNames(i),
      commentCount: i.comment_count ?? 0,
      author: i.author?.nickname || i.author?.username || '',
      createdAt: i.created_at,
      lastActedAt: i.last_acted_at || i.updated_at,
      isMine: mine.has(Number(i.number)),
    })),
    page,
    hasMore: issues.length >= pageSize,
  });
});

app.get('/api/my/issues', async (c) => {
  const s = await requireSession(c);
  if (s instanceof Response) return s;

  const page = Math.max(Number(c.req.query('page') || '1'), 1);
  const pageSize = 15;
  const rows = await c.env.DB.prepare(
    'SELECT issue_number, title, template_key, created_at FROM user_issues WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
  )
    .bind(s.uid, pageSize, (page - 1) * pageSize)
    .all<{ issue_number: number; title: string; template_key: string; created_at: number }>();

  const issues = await Promise.all(
    (rows.results ?? []).map(async (r) => {
      try {
        const i = await getIssue(c.env, r.issue_number);
        return {
          number: r.issue_number,
          title: i.title || r.title,
          state: i.state,
          labels: labelNames(i),
          commentCount: i.comment_count ?? 0,
          createdAt: i.created_at,
          isMine: true,
        };
      } catch {
        return {
          number: r.issue_number,
          title: r.title,
          state: 'open',
          labels: [],
          commentCount: 0,
          createdAt: new Date(r.created_at).toISOString(),
          isMine: true,
        };
      }
    }),
  );
  return c.json({ ok: true, issues, page, hasMore: (rows.results ?? []).length >= pageSize });
});

app.get('/api/issues/:number', async (c) => {
  const number = c.req.param('number');
  if (!/^\d+$/.test(number)) return c.json({ ok: false, error: '无效的 Issue 编号' }, 400);

  const session = await getSession(c);
  const issue = await getIssue(c.env, number);
  const mine = await myIssueNumbers(c, session);

  return c.json({
    ok: true,
    issue: {
      number: Number(issue.number),
      title: issue.title,
      body: issue.body || '',
      state: issue.state,
      labels: labelNames(issue),
      author: issue.author?.nickname || issue.author?.username || '',
      commentCount: issue.comment_count ?? 0,
      createdAt: issue.created_at,
      closedAt: issue.closed_at,
    },
    isMine: mine.has(Number(issue.number)),
  });
});

app.get('/api/issues/:number/comments', async (c) => {
  const number = c.req.param('number');
  if (!/^\d+$/.test(number)) return c.json({ ok: false, error: '无效的 Issue 编号' }, 400);
  const page = Math.max(Number(c.req.query('page') || '1'), 1);
  const pageSize = Math.min(Number(c.req.query('page_size') || '50'), 100);

  const session = await getSession(c);
  const comments = await listComments(c.env, number, { page, pageSize });
  const mineRows = await c.env.DB.prepare(
    'SELECT comment_id FROM user_comments WHERE user_id = ? AND issue_number = ?',
  )
    .bind(session?.uid ?? -1, Number(number))
    .all<{ comment_id: string | null }>();
  const mineIds = new Set((mineRows.results ?? []).map((r) => String(r.comment_id)));

  return c.json({
    ok: true,
    comments: comments.map((cm) => ({
      id: String(cm.id),
      body: cm.body,
      author: cm.author?.nickname || cm.author?.username || '',
      authorUsername: cm.author?.username || '',
      createdAt: cm.created_at,
      updatedAt: cm.updated_at,
      isMine: mineIds.has(String(cm.id)),
    })),
    page,
    hasMore: comments.length >= pageSize,
  });
});

app.post('/api/issues/:number/comments', async (c) => {
  const s = await requireSession(c);
  if (s instanceof Response) return s;

  const number = c.req.param('number');
  if (!/^\d+$/.test(number)) return c.json({ ok: false, error: '无效的 Issue 编号' }, 400);

  const body = await c.req.json<{ body?: string }>().catch(() => ({ body: '' }));
  const text = (body.body ?? '').trim();
  if (text.length < 1 || text.length > 4000) {
    return c.json({ ok: false, error: '回复内容需在 1-4000 个字符之间' }, 400);
  }

  // 频率限制：同用户同 Issue 60 秒 1 条；全局每小时 20 条
  const cdKey = `rl.cm.cd:${s.uid}:${number}`;
  if (await c.env.KV.get(cdKey)) {
    return c.json({ ok: false, error: '回复太快啦，请 1 分钟后再试' }, 429);
  }
  const hour = Math.floor(Date.now() / 3600_000);
  const rlKey = `rl.cm:${s.uid}:${hour}`;
  const count = Number((await c.env.KV.get(rlKey)) || '0');
  if (count >= 20) {
    return c.json({ ok: false, error: '今天回复的次数有点多了，请一小时后再试' }, 429);
  }

  // 预检 issue 是否可见
  try {
    await getIssue(c.env, number);
  } catch {
    return c.json({ ok: false, error: 'Issue 不存在或不可见' }, 404);
  }

  // 需求：在回复头部补充来源标注（用户邮箱）
  const fullBody = [
    `本条回复来自【${s.email}】`,
    '',
    `> 来自「${c.env.SITE_NAME}」用户 **${s.nickname}**（邮箱已验证）`,
    '',
    text,
  ].join('\n');
  const comment = await createComment(c.env, number, fullBody);

  await c.env.DB.prepare(
    'INSERT INTO user_comments (user_id, issue_number, comment_id, body, created_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(s.uid, Number(number), String(comment.id), text, Date.now())
    .run();
  await c.env.KV.put(cdKey, '1', { expirationTtl: 60 });
  await c.env.KV.put(rlKey, String(count + 1), { expirationTtl: 3600 });

  return c.json({ ok: true, commentId: String(comment.id) });
});

// ---------- 兜底：非 /api 路径交给静态资源 ----------

app.get('*', async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
