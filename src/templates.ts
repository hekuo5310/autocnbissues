// Issue 模板：优先从 CNB 仓库 .cnb/ISSUE_TEMPLATE/ 实时获取并解析，
// 结果缓存到 KV（1 小时）；拉取失败时回退到内置模板快照。

import yaml from 'js-yaml';
import type { Env, TemplateConfig, IssueTemplate, TemplateField } from './types';
import BUILTIN from './builtin-templates.json';

const CACHE_KEY = 'tpl:miaoju:v1';
const CACHE_TTL = 3600; // 1h

type RawTemplateFile = {
  name?: string;
  description?: string;
  title?: string;
  labels?: string[];
  body?: TemplateField[];
  about?: string;
};

export const FALLBACK: TemplateConfig = {
  blankIssuesEnabled: BUILTIN.blankIssuesEnabled,
  templates: BUILTIN.templates as IssueTemplate[],
};

function parseYml(key: string, text: string): IssueTemplate | null {
  const doc = yaml.load(text) as RawTemplateFile | null | undefined;
  if (!doc || !doc.name) return null;
  return {
    key,
    name: doc.name,
    description: doc.description || doc.about || '',
    labels: Array.isArray(doc.labels) ? doc.labels : [],
    body: Array.isArray(doc.body) ? doc.body : [],
  };
}

async function fetchFromCnb(env: Env): Promise<TemplateConfig | null> {
  try {
    const base = (env.CNB_API || 'https://api.cnb.cool').replace(/\/+$/, '');
    const repo = env.CNB_REPO;
    const headers = {
      Accept: 'application/json',
      Authorization: `Bearer ${env.CNB_TOKEN}`,
      'User-Agent': 'autocnb-issues/1.0',
    };

    // 1. 列出 .cnb/ISSUE_TEMPLATE 目录
    const dir = (await fetch(`${base}/${repo}/-/git/contents/.cnb/ISSUE_TEMPLATE`, { headers }).then(
      (r) => (r.ok ? r.json() : null),
    )) as { entries?: { type: string; name: string }[] } | null;
    if (!dir?.entries) return null;

    const files = dir.entries
      .filter((e) => e.type === 'blob' && e.name.endsWith('.yml') && e.name !== 'config.yml')
      .map((e) => e.name)
      .sort();

    // 2. config.yml（blank_issues_enabled）
    let blankIssuesEnabled = true;
    const cfgRes = await fetch(`${base}/${repo}/-/git/raw/main/.cnb/ISSUE_TEMPLATE/config.yml`, {
      headers,
    });
    if (cfgRes.ok) {
      try {
        const cfg = yaml.load(await cfgRes.text()) as { blank_issues_enabled?: boolean } | null;
        if (cfg && typeof cfg.blank_issues_enabled === 'boolean') {
          blankIssuesEnabled = cfg.blank_issues_enabled;
        }
      } catch {
        /* 忽略 config 解析失败 */
      }
    }

    // 3. 逐个拉取并解析模板
    const templates: IssueTemplate[] = [];
    for (const f of files) {
      const res = await fetch(`${base}/${repo}/-/git/raw/main/.cnb/ISSUE_TEMPLATE/${f}`, { headers });
      if (!res.ok) continue;
      const tpl = parseYml(f.replace(/\.yml$/, ''), await res.text());
      if (tpl) templates.push(tpl);
    }
    if (!templates.length) return null;
    return { blankIssuesEnabled, templates };
  } catch (e) {
    console.error('[templates] fetch failed:', (e as Error).message);
    return null;
  }
}

export async function getTemplates(env: Env): Promise<TemplateConfig> {
  // 先读缓存
  try {
    const cached = await env.KV.get<TemplateConfig>(CACHE_KEY, 'json');
    if (cached?.templates?.length) return cached;
  } catch {
    /* 缓存读取失败不阻塞 */
  }

  const fresh = await fetchFromCnb(env);
  const config = fresh ?? FALLBACK;
  try {
    await env.KV.put(CACHE_KEY, JSON.stringify(config), { expirationTtl: CACHE_TTL });
  } catch {
    /* 缓存写入失败不阻塞 */
  }
  return config;
}

export function findTemplate(config: TemplateConfig, key: string): IssueTemplate | null {
  if (key === '__blank__') {
    return {
      key: '__blank__',
      name: '自由提交',
      description: '不套用模板，直接描述你的问题或建议',
      labels: [],
      body: [
        {
          type: 'textarea',
          id: '__blank_content__',
          attributes: {
            label: '内容',
            description: '详细描述你的问题、建议或想法，支持 Markdown 语法',
            placeholder:
              '请描述你遇到的问题或想提出的建议…\n\n包含复现步骤、期望结果、环境信息等能帮助我们更快处理。',
          },
          validations: { required: true },
        },
      ],
    };
  }
  return config.templates.find((t) => t.key === key) ?? null;
}

/**
 * 按模板渲染 Issue 的 markdown 正文。
 * 结构与 CNB 上模板渲染产物一致：每个字段一个 `## 标题` 段落；
 * 模板中的 markdown 说明块原样输出。
 */
export function renderIssueBody(tpl: IssueTemplate, fields: Record<string, string>): string {
  const parts: string[] = [];
  const missing: string[] = [];

  for (const item of tpl.body) {
    const attrs = item.attributes ?? {};
    if (item.type === 'markdown') {
      if (attrs.value) parts.push(attrs.value.trim());
      continue;
    }
    if (item.type !== 'input' && item.type !== 'textarea') continue;

    const label = attrs.label ?? item.id ?? '';
    const value = (fields[item.id ?? ''] ?? '').trim();
    const required = item.validations?.required === true;

    if (!value) {
      if (required) missing.push(label);
      continue;
    }
    // 防御:字段内容里出现 "## " 行首会被当作标题,缩进两格即可保持原文语义
    const safeValue = value.replace(/^(\s*)(#{1,6}\s)/gm, '$1\u200b$2');
    parts.push(`## ${label}\n\n${safeValue}`);
  }

  if (missing.length) {
    throw new Error(`必填项未填写：${missing.join('、')}`);
  }
  return parts.join('\n\n').trim() || '(空)';
}
