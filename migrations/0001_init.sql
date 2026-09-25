-- 喵聚 Issues D1 初始化
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  nickname      TEXT,
  created_at    INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL
);

-- 用户通过本平台创建的 Issue 映射（issue 本体在 CNB 仓库中）
CREATE TABLE IF NOT EXISTS user_issues (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL,
  issue_number INTEGER NOT NULL,
  template_key TEXT,
  title        TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  UNIQUE(user_id, issue_number)
);
CREATE INDEX IF NOT EXISTS idx_user_issues_user ON user_issues(user_id);

-- 用户通过本平台发表的评论
CREATE TABLE IF NOT EXISTS user_comments (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL,
  issue_number INTEGER NOT NULL,
  comment_id   TEXT,
  body         TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_comments_user ON user_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_user_comments_issue ON user_comments(issue_number);
