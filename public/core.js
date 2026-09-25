/* core.js — API 封装 / Toast / 路由 / 登录弹窗 / 顶栏用户状态 */
'use strict';

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
        <div class="empty-emoji">😵</div>
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
