// 类型定义

export type Env = {
  DB: D1Database;
  KV: KVNamespace;
  SEND_EMAIL: { send(msg: SendEmailPayload): Promise<{ messageId: string }> };
  ASSETS: Fetcher;
  CNB_TOKEN: string;

  CNB_API: string;
  CNB_REPO: string;
  SITE_NAME: string;
  SITE_URL: string;
  MAIL_FROM: string;
  MAIL_FROM_NAME: string;
  DEV_MODE: string;
};

export type SendEmailPayload = {
  to: string;
  from: string | { email: string; name?: string };
  subject: string;
  html?: string;
  text?: string;
};

// ---- CNB OpenAPI 类型 ----

export type CnbUser = {
  username: string;
  nickname?: string;
  avatar?: string;
};

export type CnbIssue = {
  number: string | number;
  title: string;
  body?: string;
  state: 'open' | 'closed';
  state_reason?: 'completed' | 'not_planned' | 'reopened' | 'open' | string;
  labels?: { name?: string }[] | string[];
  author?: CnbUser;
  comment_count?: number;
  created_at?: string;
  updated_at?: string;
  last_acted_at?: string;
  closed_at?: string | null;
  priority?: string;
  invisible?: boolean;
};

export type CnbComment = {
  id: string | number;
  body: string;
  author?: CnbUser;
  created_at?: string;
  updated_at?: string;
};

export type CnbPage<T> = {
  total?: number;
  page?: number;
  page_size?: number;
  list?: T[];
  items?: T[];
  data?: T[];
};

// ---- Issue 模板类型（与 GitHub issue forms / CNB .cnb/ISSUE_TEMPLATE 格式一致） ----

export type TemplateField = {
  type: 'markdown' | 'textarea' | 'input' | 'checkboxes' | 'dropdown';
  id?: string;
  attributes?: {
    label?: string;
    description?: string;
    placeholder?: string;
    value?: string;
    options?: string[];
  };
  validations?: { required?: boolean };
};

export type IssueTemplate = {
  key: string;
  name: string;
  description?: string;
  labels: string[];
  body: TemplateField[];
};

export type TemplateConfig = {
  blankIssuesEnabled: boolean;
  templates: IssueTemplate[];
};

// ---- 应用会话 ----

export type SessionData = {
  uid: number;
  email: string;
  nickname: string;
};
