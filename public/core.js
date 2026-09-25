/* core.js — API 封装 / Toast / 路由 / 登录弹窗 / 顶栏用户状态 */
'use strict';

// ---------- Material 图标（内联 SVG，替代 emoji，无外部字体依赖） ----------

const ICONS = {
  lightbulb: '<path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z"/>',
  bug: '<path d="M20 8h-2.81c-.45-.78-1.07-1.45-1.82-1.96L17 4.41 15.59 3l-2.17 2.17C12.96 5.06 12.49 5 12 5c-.49 0-.96.06-1.41.17L8.41 3 7 4.41l1.62 1.63C7.88 6.55 7.26 7.22 6.81 8H4v2h2.09c-.05.33-.09.66-.09 1v1H4v2h2v1c0 .34.04.67.09 1H4v2h2.81c1.04 1.79 2.97 3 5.19 3s4.15-1.21 5.19-3H20v-2h-2.09c.05-.33.09-.66.09-1v-1h2v-2h-2v-1c0-.34-.04-.67-.09-1H20V8zm-6 8h-4v-2h4v2zm0-4h-4v-2h4v2z"/>',
  description: '<path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>',
  report: '<path d="M15.73 3H8.27L3 8.27v7.46L8.27 21h7.46L21 15.73V8.27L15.73 3zM12 17.3c-.72 0-1.3-.58-1.3-1.3 0-.72.58-1.3 1.3-1.3.72 0 1.3.58 1.3 1.3 0 .72-.58 1.3-1.3 1.3zm1-4.3h-2V7h2v6z"/>',
  lock: '<path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>',
  edit: '<path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>',
  pin: '<path d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z"/>',
  chat: '<path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/>',
  forum: '<path d="M21 6h-2v9H6v2c0 .55.45 1 1 1h11l4 4V7c0-.55-.45-1-1-1zm-4 6V3c0-.55-.45-1-1-1H3c-.55 0-1 .45-1 1v14l4-4h10c.55 0 1-.45 1-1z"/>',
  circle: '<path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2z"/>',
  check_circle: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>',
  inbox: '<path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 12h-4c0 1.66-1.34 3-3 3s-3-1.34-3-3H5V5h14v10z"/>',
  error: '<path d="M11 15h2v2h-2zm0-8h2v6h-2zm.99-5C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z"/>',
  assignment: '<path d="M19 3h-4.18C14.4 1.84 13.3 1 12 1c-1.3 0-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>',
  send: '<path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>',
  check: '<path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>',
  search: '<path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>',
  arrow_back: '<path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>',
  arrow_forward: '<path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/>',
  open_in_new: '<path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/>',
  visibility: '<path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>',
  visibility_off: '<path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/>',
  restart_alt: '<path d="M12 5V2.21c0-.45-.54-.67-.85-.35l-3.81 3.82c-.2.2-.2.51 0 .71l3.81 3.81c.31.31.85.09.85-.35V7c3.31 0 6 2.69 6 6 0 .79-.15 1.54-.43 2.23l1.47 1.47C19.59 15.55 20 14.32 20 13c0-4.42-3.58-8-8-8zm-6 8c0-1.02.25-1.97.71-2.81L5.24 8.72C4.46 9.95 4 11.42 4 13c0 4.42 3.58 8 8 8v2.79c0 .45.54.67.85.35l3.81-3.82c.2-.2.2-.51 0-.71l-3.81-3.81c-.31-.31-.85-.09-.85.35V19c-3.31 0-6-2.69-6-6z"/>',
  tune: '<path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z"/>',
  hourglass_empty: '<path d="M6 2v6h.01L6 8.01 10 12l-4 4 .01.01H6V22h12v-5.99h-.01L18 16l-4-4 4-3.99-.01-.01H18V2H6zm10 14.5V20H8v-3.5l4-4 4 4zm-4-5l-4-4V4h8v3.5l-4 4z"/>',
  block: '<path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12c0-4.42 3.58-8 8-8 1.85 0 3.55.63 4.9 1.69L5.69 16.9C4.63 15.55 4 13.85 4 12zm8 8c-1.85 0-3.55-.63-4.9-1.69L18.31 7.1C19.37 8.45 20 10.15 20 12c0 4.42-3.58 8-8 8z"/>',
  link: '<path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/>',
  add: '<path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/>',
  close: '<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>',
};

function ico(name, cls = '') {
  return `<svg class="md-ico${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`;
}

// ---------- API ----------

async function api(path, opts = {}) {
  const init = { headers: {}, credentials: 'same-origin' };
  if (opts.method) init.method = opts.method;
  if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, init);
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`请求失败（HTTP ${res.status}）`);
  }
  if (!res.ok || data.ok === false) {
    const err = new Error(data.error || `请求失败（HTTP ${res.status}）`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- Toast ----------

function toast(msg, type = 'ok', ms = 3200) {
  const wrap = document.getElementById('toast-wrap');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 320);
  }, ms);
}

// ---------- 全局状态 ----------

const App = {
  user: null,
  config: null,
  templatesCache: null,
};

async function loadConfig() {
  if (App.config) return App.config;
  const [cfg, me] = await Promise.all([api('/api/config'), api('/api/auth/me')]);
  App.config = cfg;
  App.user = me.user;
  return App.config;
}

// ---------- Markdown ----------

function renderMarkdown(text) {
  if (!text) return '';
  if (window.marked && window.DOMPurify) {
    const html = window.marked.parse(text, { breaks: true, gfm: true });
    return window.DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
  }
  // CDN 失败时的兜底：转义 + 保留换行
  const div = document.createElement('div');
  div.textContent = text;
  return `<p style="white-space:pre-wrap">${div.innerHTML}</p>`;
}

// ---------- 时间 ----------

function fmtTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function esc(s) {
  const div = document.createElement('div');
  div.textContent = s == null ? '' : String(s);
  return div.innerHTML;
}

// ---------- 登录弹窗 ----------

const LoginUI = {
  step: 'email',
  email: '',
  timer: null,

  open() {
    document.getElementById('login-modal').hidden = false;
    document.getElementById('login-error').textContent = '';
    document.getElementById('login-tip').hidden = true;
    this.resetStep();
  },
  close() {
    document.getElementById('login-modal').hidden = true;
    clearInterval(this.timer);
  },
  resetStep() {
    this.step = 'email';
    this.email = '';
    document.getElementById('login-email').value = '';
    document.getElementById('login-code').value = '';
    document.getElementById('code-row').hidden = true;
    document.getElementById('login-email').disabled = false;
    const next = document.getElementById('btn-next');
    next.textContent = '获取验证码';
    next.disabled = false;
  },

  async next() {
    const errEl = document.getElementById('login-error');
    errEl.textContent = '';
    const btn = document.getElementById('btn-next');

    if (this.step === 'email') {
      const email = document.getElementById('login-email').value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errEl.textContent = '请输入有效的邮箱地址';
        return;
      }
      this.email = email;
      btn.disabled = true;
      btn.textContent = '发送中…';
      try {
        const r = await api('/api/auth/send-code', { method: 'POST', body: { email } });
        if (r.devMode) {
          const tip = document.getElementById('login-tip');
          tip.hidden = false;
          tip.textContent = `【开发模式】邮件 binding 未启用，本次验证码：${r.devCode}`;
        }
        this.enterCodeStep();
      } catch (e) {
        errEl.textContent = e.message;
        btn.disabled = false;
        btn.textContent = '获取验证码';
      }
      return;
    }

    // step === 'code'
    const code = document.getElementById('login-code').value.trim();
    if (!/^\d{6}$/.test(code)) {
      errEl.textContent = '请输入 6 位数字验证码';
      return;
    }
    btn.disabled = true;
    btn.textContent = '验证中…';
    try {
      const r = await api('/api/auth/verify', { method: 'POST', body: { email: this.email, code } });
      App.user = r.user;
      this.close();
      clearInterval(this.timer);
      toast(`欢迎回来，${r.user.nickname}！`);
      renderHeaderUser();
      route(); // 刷新当前页面登录态相关内容
    } catch (e) {
      errEl.textContent = e.message;
      btn.disabled = false;
      btn.textContent = '登录';
    }
  },

  enterCodeStep() {
    this.step = 'code';
    document.getElementById('login-email').disabled = true;
    document.getElementById('code-row').hidden = false;
    const btn = document.getElementById('btn-next');
    btn.textContent = '登录';
    btn.disabled = false;
    document.getElementById('login-code').focus();
    this.startCooldown(60);
  },

  async resend() {
    const errEl = document.getElementById('login-error');
    errEl.textContent = '';
    try {
      const r = await api('/api/auth/send-code', { method: 'POST', body: { email: this.email } });
      if (r.devMode) {
        const tip = document.getElementById('login-tip');
        tip.hidden = false;
        tip.textContent = `【开发模式】邮件 binding 未启用，本次验证码：${r.devCode}`;
      }
      toast('验证码已重新发送');
      this.startCooldown(60);
    } catch (e) {
      errEl.textContent = e.message;
    }
  },

  startCooldown(sec) {
    clearInterval(this.timer);
    const btn = document.getElementById('btn-resend');
    btn.disabled = true;
    let left = sec;
    const tick = () => {
      btn.textContent = `${left}s 后重发`;
      if (left <= 0) {
        clearInterval(this.timer);
        btn.disabled = false;
        btn.textContent = '重新发送';
        return;
      }
      left -= 1;
    };
    tick();
    this.timer = setInterval(tick, 1000);
  },
};

async function logout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch { /* 忽略 */ }
  App.user = null;
  renderHeaderUser();
  toast('已退出登录');
  location.hash = '#/new';
  route();
}

// ---------- 顶栏用户 ----------

function renderHeaderUser() {
  const box = document.getElementById('header-user');
  if (App.user) {
    const initial = (App.user.nickname || '?').slice(0, 1).toUpperCase();
    box.innerHTML = `
      <div class="user-chip" id="user-chip" title="点击进入我的页面 / 退出">
        <span class="avatar">${esc(initial)}</span>
        <span>${esc(App.user.nickname)}</span>
      </div>`;
    document.getElementById('user-chip').onclick = () => {
      if (confirm(`昵称：${App.user.nickname}\n邮箱：${App.user.email}\n\n是否退出登录？`)) logout();
    };
  } else {
    box.innerHTML = `<button class="btn btn-ghost" id="btn-login">登录</button>`;
    document.getElementById('btn-login').onclick = () => LoginUI.open();
  }
}

// ---------- 路由 ----------

async function route() {
  const hash = location.hash.replace(/^#\/?/, '') || 'new';
  const [name, ...rest] = hash.split('/');
  const appEl = document.getElementById('app');
  appEl.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';

  document.querySelectorAll('.nav a').forEach((a) => {
    a.classList.toggle('active', a.dataset.nav === name);
  });

  // 路由表在调用时求值（views.js 的渲染函数须在两个脚本都加载后才可用）
  const routes = {
    new: renderNewPage,
    issues: renderListPage,
    issue: renderDetailPage,
    mine: renderMinePage,
  };
  try {
    await loadConfig();
    renderHeaderUser(); // 登录态就绪后刷新顶栏（DOMContentLoaded 时 user 可能尚未加载）
    document.getElementById('footer-repo-link').textContent = App.config.repo;
    document.getElementById('footer-repo-link').href = App.config.repoUrl;
    const fn = routes[name] || renderNewPage;
    await fn(appEl, ...rest);
  } catch (e) {
    appEl.innerHTML = `
      <div class="empty">
        <div class="empty-ico">${ico('error')}</div>
        <p>${esc(e.message)}</p>
        <button class="btn btn-outline" onclick="location.reload()">刷新重试</button>
      </div>`;
  }
}

window.addEventListener('hashchange', route);

// ---------- 初始化 ----------

document.addEventListener('DOMContentLoaded', () => {
  renderHeaderUser();

  document.getElementById('btn-next').onclick = () => LoginUI.next();
  document.getElementById('login-close').onclick = () => LoginUI.close();
  document.getElementById('btn-resend').onclick = () => LoginUI.resend();
  document.getElementById('login-modal').addEventListener('click', (e) => {
    if (e.target.id === 'login-modal') LoginUI.close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') LoginUI.close();
    if (e.key === 'Enter' && !document.getElementById('login-modal').hidden) LoginUI.next();
  });

  route();
});
