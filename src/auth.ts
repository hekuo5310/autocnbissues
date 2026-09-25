// 认证：邮箱验证码登录 + KV 会话
// - 验证码: 6 位数字, 10 分钟有效, 最多 5 次尝试, 同邮箱 60s 冷却, 同 IP 每小时最多 10 封
// - 会话:   随机 32 字节 token, HttpOnly Cookie, 7 天有效期, KV 存储

import type { Context } from 'hono';
import { setCookie, deleteCookie, getCookie } from 'hono/cookie';
import type { Env, SessionData } from './types';
import { sendVerificationEmail } from './email';

const CODE_TTL = 600; // 10 min
const CODE_MAX_TRIES = 5;
const SEND_COOLDOWN = 60; // 60s
const IP_HOURLY_LIMIT = 10;
const SESSION_TTL = 7 * 24 * 3600; // 7 days

export const SESSION_COOKIE = 'mj_session';

const emailRe = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,24}$/;
export function isValidEmail(email: string): boolean {
  return emailRe.test(email) && !email.includes('..');
}

export function randomCode(): string {
  const buf = new Uint32Array(6);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => String(n % 10)).join('');
}

function randomToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

function clientIp(c: Context<{ Bindings: Env }>): string {
  return (
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// ---------- 发送验证码 ----------

export async function sendCode(c: Context<{ Bindings: Env }>) {
  const body = await c.req.json<{ email?: string }>().catch(() => ({ email: '' }));
  const email = normalizeEmail(body.email ?? '');
  if (!isValidEmail(email)) {
    return c.json({ ok: false, error: '请输入有效的邮箱地址' }, 400);
  }
  const ip = clientIp(c);

  // 冷却检查（同邮箱）
  const cooldownKey = `vc.cd:${email}`;
  const cooling = await c.env.KV.get(cooldownKey);
  if (cooling) {
    return c.json({ ok: false, error: '发送太频繁，请 1 分钟后再试' }, 429);
  }

  // IP 小时限额
  const hour = Math.floor(Date.now() / 3600_000);
  const ipKey = `vc.ip:${ip}:${hour}`;
  const count = Number((await c.env.KV.get(ipKey)) || '0');
  if (count >= IP_HOURLY_LIMIT) {
    return c.json({ ok: false, error: '当前网络发送次数已达上限，请稍后再试' }, 429);
  }

  const code = randomCode();
  await c.env.KV.put(`vc.code:${email}`, JSON.stringify({ code, tries: 0 }), {
    expirationTtl: CODE_TTL,
  });
  await c.env.KV.put(cooldownKey, '1', { expirationTtl: SEND_COOLDOWN });
  await c.env.KV.put(ipKey, String(count + 1), { expirationTtl: 3600 });

  const result = await sendVerificationEmail(c.env, email, code);

  // 开发模式下邮件 binding 不可用时，把验证码直接返回（生产 DEV_MODE=false 绝不会走这里）
  if (!result.sent) {
    if (c.env.DEV_MODE === 'true') {
      return c.json({ ok: true, devMode: true, devCode: code, warning: result.error });
    }
    return c.json(
      { ok: false, error: '验证码邮件发送失败，请稍后重试；若持续失败请联系站长检查邮件域名配置' },
      500,
    );
  }
  return c.json({ ok: true });
}

// ---------- 校验验证码并登录 ----------

export async function verifyCode(c: Context<{ Bindings: Env }>) {
  const body = await c.req.json<{ email?: string; code?: string }>().catch(() => ({ email: '', code: '' }));
  const email = normalizeEmail(body.email ?? '');
  const code = (body.code ?? '').trim();
  if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
    return c.json({ ok: false, error: '邮箱或验证码格式不正确' }, 400);
  }

  const codeKey = `vc.code:${email}`;
  const raw = await c.env.KV.get(codeKey);
  if (!raw) {
    return c.json({ ok: false, error: '验证码已过期，请重新获取' }, 400);
  }
  const rec = JSON.parse(raw) as { code: string; tries: number };
  if (rec.tries >= CODE_MAX_TRIES) {
    await c.env.KV.delete(codeKey);
    return c.json({ ok: false, error: '尝试次数过多，请重新获取验证码' }, 429);
  }
  if (rec.code !== code) {
    await c.env.KV.put(codeKey, JSON.stringify({ ...rec, tries: rec.tries + 1 }), {
      expirationTtl: CODE_TTL,
    });
    return c.json({ ok: false, error: '验证码不正确' }, 400);
  }

  await c.env.KV.delete(codeKey);

  // 创建或更新用户
  const now = Date.now();
  const db = c.env.DB;
  let user = await db
    .prepare('SELECT id, nickname FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: number; nickname: string | null }>();
  if (user) {
    await db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(now, user.id).run();
  } else {
    const r = await db
      .prepare('INSERT INTO users (email, created_at, last_login_at) VALUES (?, ?, ?)')
      .bind(email, now, now)
      .run();
    user = { id: Number(r.meta.last_row_id), nickname: null };
  }

  const defaultNickname = maskEmail(email);
  const session: SessionData = {
    uid: user.id,
    email,
    nickname: user.nickname || defaultNickname,
  };
  const token = randomToken();
  await c.env.KV.put(`sess:${token}`, JSON.stringify(session), { expirationTtl: SESSION_TTL });
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL,
  });
  return c.json({ ok: true, user: session });
}

export function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  const head = name.slice(0, Math.min(2, name.length));
  return `${head}***@${domain}`;
}

// ---------- 会话 ----------

export async function getSession(c: Context<{ Bindings: Env }>): Promise<SessionData | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const raw = await c.env.KV.get(`sess:${token}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionData;
  } catch {
    return null;
  }
}

export async function requireSession(c: Context<{ Bindings: Env }>): Promise<SessionData | Response> {
  const s = await getSession(c);
  if (!s) return c.json({ ok: false, error: '请先登录' }, 401);
  return s;
}

export async function logout(c: Context<{ Bindings: Env }>) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await c.env.KV.delete(`sess:${token}`);
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
}

export async function refreshSession(c: Context<{ Bindings: Env }>, session: SessionData) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await c.env.KV.put(`sess:${token}`, JSON.stringify(session), { expirationTtl: SESSION_TTL });
  }
}
