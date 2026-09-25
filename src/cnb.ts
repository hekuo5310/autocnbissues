// CNB OpenAPI 客户端
// 文档: https://docs.cnb.cool/zh/develops/openapi.html （swagger: https://api.cnb.cool/swagger.json）
// 注意: 所有请求必须带 `Accept: application/json`，否则返回 406

import type { Env, CnbComment, CnbIssue } from './types';

export class CnbApiError extends Error {
  status: number;
  code?: number;
  constructor(status: number, message: string, code?: number) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function cnbFetch<T = unknown>(
  env: Env,
  path: string,
  init: { method?: string; body?: unknown; query?: Record<string, string> } = {},
): Promise<T> {
  const base = (env.CNB_API || 'https://api.cnb.cool').replace(/\/+$/, '');
  let url = `${base}${path}`;
  if (init.query) {
    const qs = new URLSearchParams(init.query).toString();
    if (qs) url += `?${qs}`;
  }

  const method = init.method ?? 'GET';
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${env.CNB_TOKEN}`,
    'User-Agent': 'autocnb-issues/1.0',
  };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method,
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  const text = await res.text();
  let data: { errcode?: number; errmsg?: string } | unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new CnbApiError(res.status, `CNB API 返回了非 JSON 响应（HTTP ${res.status}）`);
  }

  if (!res.ok) {
    const obj = data as { errcode?: number; errmsg?: string } | null;
    throw new CnbApiError(
      res.status,
      obj?.errmsg || `CNB API 请求失败（HTTP ${res.status}）`,
      obj?.errcode,
    );
  }
  return data as T;
}

/** Issue 列表（返回体为数组；total 以响应头或长度近似给出，这里用数组返回） */
export async function listIssues(
  env: Env,
  opts: { state?: string; page?: number; pageSize?: number; keyword?: string } = {},
): Promise<CnbIssue[]> {
  const query: Record<string, string> = {
    page: String(opts.page && opts.page > 0 ? opts.page : 1),
    page_size: String(opts.pageSize && opts.pageSize > 0 ? Math.min(opts.pageSize, 100) : 20),
    order_by: '-created_at',
  };
  if (opts.state === 'open' || opts.state === 'closed') query.state = opts.state;
  if (opts.keyword) query.keyword = opts.keyword;
  return cnbFetch<CnbIssue[]>(env, `/${env.CNB_REPO}/-/issues`, { query });
}

export async function getIssue(env: Env, number: number | string): Promise<CnbIssue> {
  return cnbFetch<CnbIssue>(env, `/${env.CNB_REPO}/-/issues/${number}`);
}

export async function listComments(
  env: Env,
  number: number | string,
  opts: { page?: number; pageSize?: number } = {},
): Promise<CnbComment[]> {
  const query: Record<string, string> = {
    sort: 'created',
    page: String(opts.page && opts.page > 0 ? opts.page : 1),
    page_size: String(opts.pageSize && opts.pageSize > 0 ? Math.min(opts.pageSize, 100) : 50),
  };
  return cnbFetch<CnbComment[]>(env, `/${env.CNB_REPO}/-/issues/${number}/comments`, { query });
}

export async function createIssue(
  env: Env,
  form: { title: string; body: string; labels?: string[] },
): Promise<CnbIssue> {
  return cnbFetch<CnbIssue>(env, `/${env.CNB_REPO}/-/issues`, {
    method: 'POST',
    body: { title: form.title, body: form.body, labels: form.labels ?? [] },
  });
}

/** 更新 Issue（PATCH /{repo}/-/issues/{number}）：支持修改 title / body / state / invisible（是否私密） */
export async function updateIssue(
  env: Env,
  number: number | string,
  patch: { title?: string; body?: string; state?: 'open' | 'closed'; invisible?: boolean },
): Promise<CnbIssue> {
  return cnbFetch<CnbIssue>(env, `/${env.CNB_REPO}/-/issues/${number}`, {
    method: 'PATCH',
    body: patch,
  });
}

export async function createComment(
  env: Env,
  number: number | string,
  body: string,
): Promise<CnbComment> {
  return cnbFetch<CnbComment>(env, `/${env.CNB_REPO}/-/issues/${number}/comments`, {
    method: 'POST',
    body: { body },
  });
}

export function labelNames(issue: CnbIssue): string[] {
  return (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l?.name ?? '')).filter(Boolean);
}
