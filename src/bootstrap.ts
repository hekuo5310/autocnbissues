// D1 表结构自愈（自启动检查）
// 背景：Cloudflare Workers Builds 只执行 `wrangler deploy`，不会自动应用 D1 迁移；
// 若数据库是新建的（从未执行 `wrangler d1 migrations apply`），任何涉及 DB 的请求
// 都会因 "no such table: users" 报 500。
// 方案：每个 Worker 隔离实例在首次处理 /api/* 请求时，幂等地执行一次建表语句
// （全部为 CREATE TABLE / INDEX IF NOT EXISTS，与 migrations/0001_init.sql 完全一致），
// 开销可忽略；已建表时为空操作。若执行失败则重置状态，允许下次请求重试。
//
// 注意：不能用 DB.exec()——它会按换行符朴素切分 SQL，多行 CREATE TABLE 会被截断
// 报 "incomplete input"；这里用 DB.batch() 逐条预编译执行，才是正确姿势。

import type { Env } from './types';

const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  nickname      TEXT,
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL
)`,
  `CREATE TABLE IF NOT EXISTS user_issues (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL,
  issue_number INTEGER NOT NULL,
  template_key TEXT,
  title        TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  UNIQUE(user_id, issue_number)
)`,
  `CREATE INDEX IF NOT EXISTS idx_user_issues_user ON user_issues(user_id)`,
  `CREATE TABLE IF NOT EXISTS user_comments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL,
  issue_number INTEGER NOT NULL,
  comment_id   TEXT,
  body         TEXT NOT NULL,
  created_at   INTEGER NOT NULL
)`,
  `CREATE INDEX IF NOT EXISTS idx_user_comments_user ON user_comments(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_user_comments_issue ON user_comments(issue_number)`,
  // 站内置顶表：CNB 标签操作可能无权限（403），置顶状态以本表兜底（列表排序与 badge 用）
  `CREATE TABLE IF NOT EXISTS pinned_issues (
  issue_number INTEGER PRIMARY KEY,
  pinned_at    INTEGER NOT NULL,
  pinned_by    INTEGER
)`,
  // 站内私密表：CNB API 目前忽略 invisible 字段，本表兜底实现站内隐私过滤（非所有者不可见）
  `CREATE TABLE IF NOT EXISTS private_issues (
  issue_number INTEGER PRIMARY KEY,
  set_at       INTEGER NOT NULL,
  set_by       INTEGER
)`,
];

let ready: Promise<void> | null = null;

export function ensureSchema(env: Env): Promise<void> {
  if (!ready) {
    ready = env.DB
      .batch(SCHEMA_STATEMENTS.map((sql) => env.DB.prepare(sql)))
      .then(() => undefined)
      .catch((e) => {
        ready = null; // 失败后允许下次请求重试
        throw e;
      });
  }
  return ready;
}
