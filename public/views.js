/* views.js — 页面渲染：提交 Issue / 列表 / 详情 / 我的（Material Design 3 风格，图标为内联 SVG） */
'use strict';

const TPL_META = {
  '0-feature-request': { icon: 'lightbulb', tone: 'tertiary' },
  '1-bug-report': { icon: 'bug', tone: 'error' },
  '2-experience-report': { icon: 'description', tone: 'secondary' },
  '3-outage-report': { icon: 'report', tone: 'error' },
  '4-security-report': { icon: 'lock', tone: 'primary' },
  __blank__: { icon: 'edit', tone: 'primary' },
};

async function loadTemplates(force = false) {
  if (!App.templatesCache || force) {
    App.templatesCache = await api('/api/templates');
  }
  return App.templatesCache;
}

function requireLoginHint() {
  if (App.user) return true;
  toast('请先登录后再操作', 'warn');
  LoginUI.open();
  return false;
}

// ==================== 提交页 ====================

async function renderNewPage(el) {
  const cfg = App.config;
  const tplData = await loadTemplates();

  const cards = tplData.templates
    .map((t) => {
      const meta = TPL_META[t.key] || { icon: 'pin', tone: 'primary' };
      return `
      <div class="tpl-card" data-key="${esc(t.key)}" role="button" tabindex="0">
        <span class="tpl-check">${ico('check')}</span>
        <div class="tpl-ico tone-${meta.tone}">${ico(meta.icon)}</div>
        <h3>${esc(t.name)}</h3>
        <p>${esc(t.description || '')}</p>
      </div>`;
    })
    .join('');

  const blankCard = tplData.blankIssuesEnabled
    ? `
      <div class="tpl-card" data-key="__blank__" role="button" tabindex="0">
        <span class="tpl-check">${ico('check')}</span>
        <div class="tpl-ico">${ico(TPL_META.__blank__.icon)}</div>
        <h3>自由提交</h3>
        <p>不套用模板，直接描述你的问题或建议</p>
      </div>`
    : '';

  el.innerHTML = `
    <section class="hero">
      <h1>向 <em>${esc(cfg.siteName)}</em> 提交 Issue</h1>
      <p>选择一个分类，按模板填写即可提交到 <a href="${esc(cfg.repoUrl)}" target="_blank" rel="noopener">${esc(cfg.repo)}</a>；登录后可随时查看进展与回复。</p>
    </section>
    <div class="tpl-grid" id="tpl-grid">${cards}${blankCard}</div>
    <div id="tpl-form"></div>`;

  const grid = document.getElementById('tpl-grid');
  const selectTpl = async (key) => {
    grid.querySelectorAll('.tpl-card').forEach((c) => c.classList.toggle('selected', c.dataset.key === key));
    await renderTemplateForm(key);
  };
  const firstCard = grid.querySelector('.tpl-card');
  if (firstCard) firstCard.classList.add('selected');
  grid.querySelectorAll('.tpl-card').forEach((card) => {
    card.onclick = () => selectTpl(card.dataset.key);
    card.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') selectTpl(card.dataset.key);
    };
  });

  await renderTemplateForm(tplData.templates[0]?.key ?? '__blank__');
}

async function renderTemplateForm(key) {
  const formEl = document.getElementById('tpl-form');
  formEl.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';
  const tplData = await loadTemplates();
  const tpl =
    key === '__blank__'
      ? { key: '__blank__', name: '自由提交', body: [] }
      : tplData.templates.find((t) => t.key === key);
  if (!tpl) {
    formEl.innerHTML = '<div class="empty">模板加载失败，请刷新重试</div>';
    return;
  }
  const meta = TPL_META[tpl.key] || { icon: 'pin', tone: 'primary' };

  const fieldsHtml = tpl.body
    .map((f) => {
      if (f.type === 'markdown') {
        return `<div class="md-note">${renderMarkdown(f.attributes?.value || '')}</div>`;
      }
      if (f.type !== 'input' && f.type !== 'textarea') return '';
      const a = f.attributes || {};
      const required = f.validations?.required === true;
      const label = `${esc(a.label || '')}${required ? '<span class="req">*</span>' : ''}`;
      const desc = a.description ? `<p class="field-desc">${esc(a.description)}</p>` : '';
      const ph = a.placeholder ? a.placeholder.replace(/\n/g, '&#10;') : '';
      const field = f.type === 'textarea'
        ? `<textarea name="${esc(f.id)}" data-required="${required}" placeholder="${ph}"></textarea>`
        : `<input type="text" name="${esc(f.id)}" data-required="${required}" placeholder="${esc(a.placeholder || '')}" />`;
      return `<div class="form-field"><label>${label}</label>${desc}${field}</div>`;
    })
    .join('');

  formEl.innerHTML = `
    <form class="issue-form" id="issue-form">
      <h2>${ico(meta.icon, 'h2-ico')} ${esc(tpl.name)}</h2>
      <p class="form-desc">带 <span style="color:var(--md-error)">*</span> 为必填项。提交后会自动带上模板对应的标签，Issue 将创建在 ${esc(App.config.repo)} 仓库。</p>
      <div class="form-field">
        <label>标题 <span class="req">*</span></label>
        <input type="text" id="issue-title" placeholder="用一句话概括你的问题或建议（2-255 字）" maxlength="255" />
      </div>
      ${fieldsHtml}
      <div class="form-actions">
        <button type="submit" class="btn btn-primary btn-lg" id="issue-submit">提交 Issue</button>
        <span class="form-hint">${App.user ? `将以「${esc(App.user.nickname)}」的身份提交` : '提交前需要先登录（邮箱验证码）'}</span>
      </div>
    </form>`;

  document.getElementById('issue-form').onsubmit = async (e) => {
    e.preventDefault();
    if (!requireLoginHint()) return;

    const form = e.target;
    const title = document.getElementById('issue-title').value.trim();
    const titleInput = document.getElementById('issue-title');
    titleInput.classList.toggle('invalid', title.length < 2);
    if (title.length < 2) {
      toast('请填写标题（至少 2 个字符）', 'error');
      titleInput.focus();
      return;
    }

    const fields = {};
    let missing = null;
    form.querySelectorAll('input[type="text"], textarea').forEach((input) => {
      if (input.id === 'issue-title') return;
      const val = input.value.trim();
      fields[input.name] = val;
      const req = input.dataset.required === 'true';
      input.classList.toggle('invalid', req && !val);
      if (req && !val && !missing) missing = input;
    });
    if (missing) {
      toast('还有必填项没有填写', 'error');
      missing.focus();
      return;
    }

    const btn = document.getElementById('issue-submit');
    btn.disabled = true;
    btn.textContent = '提交中…';
    try {
      const r = await api('/api/issues', { method: 'POST', body: { template: tpl.key, title, fields } });
      toast(`Issue #${r.number} 提交成功！`);
      location.hash = `#/issue/${r.number}`;
    } catch (err) {
      if (err.status === 401) {
        toast('登录状态已过期，请重新登录', 'warn');
        LoginUI.open();
      } else {
        toast(err.message, 'error', 5000);
      }
      btn.disabled = false;
      btn.textContent = '提交 Issue';
    }
  };
}

// ==================== 列表页 ====================

async function renderListPage(el, _tab, _page) {
  el.innerHTML = `
    <div class="list-head">
      <div class="tabs" id="state-tabs">
        <button data-state="open">进行中</button>
        <button data-state="closed">已关闭</button>
        <button data-state="all">全部</button>
      </div>
      <div class="search-box">${ico('search')}<input type="text" id="issue-search" placeholder="搜索标题或内容…" /></div>
    </div>
    <div class="issue-list" id="issue-list"><div class="page-loading"><div class="spinner"></div></div></div>
    <div class="pager" id="pager"></div>`;

  let state = 'open';
  let page = 1;
  let keyword = '';

  async function fetchList() {
    const listEl = document.getElementById('issue-list');
    listEl.innerHTML = '<div class="page-loading"><div class="spinner"></div></div>';
    document.getElementById('pager').innerHTML = '';
    try {
      const qs = new URLSearchParams({ state, page: String(page), page_size: '15' });
      if (keyword) qs.set('keyword', keyword);
      const r = await api(`/api/issues?${qs}`);
      if (!r.issues.length) {
        listEl.innerHTML = `<div class="empty"><div class="empty-ico">${ico('inbox')}</div><p>这里还没有 Issue</p><a href="#/new"><button class="btn btn-primary">去提交一个</button></a></div>`;
        return;
      }
      listEl.innerHTML = r.issues
        .map(
          (i) => `
          <a class="issue-row" href="#/issue/${i.number}">
            <span class="issue-state-icon ${i.state === 'open' ? 'is-open' : ''}">${ico(i.state === 'open' ? 'circle' : 'check_circle')}</span>
            <div class="issue-main">
              <div class="issue-title">${esc(i.title)}</div>
              <div class="issue-meta">
                <span class="badge state-${esc(i.state)}">${i.state === 'open' ? '进行中' : '已关闭'}</span>
                ${i.labels.map((l) => `<span class="badge">${esc(l)}</span>`).join('')}
                ${i.isMine ? '<span class="badge mine">我提交的</span>' : ''}
                <span>#${i.number}</span>
                <span>${esc(i.author)}</span>
                <span>${fmtTime(i.lastActedAt || i.createdAt)} 更新</span>
              </div>
            </div>
            <span class="issue-side">${ico('chat')}${i.commentCount}</span>
          </a>`,
        )
        .join('');

      const pager = document.getElementById('pager');
      if (r.page > 1 || r.hasMore) {
        pager.innerHTML = `
          <button class="btn btn-outline" id="prev-page" ${r.page <= 1 ? 'disabled' : ''}>${ico('arrow_back', 'inline-ico')} 上一页</button>
          <span class="muted" style="align-self:center">第 ${r.page} 页</span>
          <button class="btn btn-outline" id="next-page" ${r.hasMore ? '' : 'disabled'}>下一页 ${ico('arrow_forward', 'inline-ico')}</button>`;
        document.getElementById('prev-page').onclick = () => { page -= 1; fetchList(); window.scrollTo({ top: 0 }); };
        document.getElementById('next-page').onclick = () => { page += 1; fetchList(); window.scrollTo({ top: 0 }); };
      }
    } catch (e) {
      listEl.innerHTML = `<div class="empty"><div class="empty-ico">${ico('error')}</div><p>${esc(e.message)}</p></div>`;
    }
  }

  document.getElementById('state-tabs').onclick = (e) => {
    if (e.target.tagName !== 'BUTTON') return;
    document.querySelectorAll('#state-tabs button').forEach((b) => b.classList.toggle('active', b === e.target));
    state = e.target.dataset.state;
    page = 1;
    fetchList();
  };

  let searchTimer;
  document.getElementById('issue-search').oninput = (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      keyword = e.target.value.trim();
      page = 1;
      fetchList();
    }, 500);
  };

  document.querySelector(`#state-tabs button[data-state="${state}"]`).classList.add('active');
  await fetchList();
}

// ==================== 详情页 ====================

async function renderDetailPage(el, number) {
  if (!/^\d+$/.test(number || '')) {
    el.innerHTML = `<div class="empty"><div class="empty-ico">${ico('error')}</div><p>无效的 Issue 地址</p></div>`;
    return;
  }

  const [detail, comments] = await Promise.all([
    api(`/api/issues/${number}`),
    api(`/api/issues/${number}/comments`).catch(() => ({ comments: [] })),
  ]);
  const i = detail.issue;

  el.innerHTML = `
    <div class="crumbs"><a href="#/issues">Issue 列表</a> / #${i.number}</div>
    <div class="detail-card">
      <div class="detail-head">
        <div class="detail-meta">
          <span class="badge state-${esc(i.state)}">${i.state === 'open' ? '进行中' : '已关闭'}</span>
          ${i.labels.map((l) => `<span class="badge">${esc(l)}</span>`).join('')}
          ${detail.isMine ? '<span class="badge mine">我提交的</span>' : ''}
          <span>由 <strong>${esc(i.author)}</strong> 创建于 ${fmtTime(i.createdAt)}</span>
          <a href="${esc(App.config.repoUrl)}/issues/${i.number}" target="_blank" rel="noopener">在 CNB 上查看 ${ico('open_in_new', 'inline-ico')}</a>
        </div>
        <h1>${esc(i.title)}</h1>
      </div>
      <div class="markdown-body">${renderMarkdown(i.body)}</div>
    </div>

    <section class="comments-section">
      <h2>${ico('forum', 'h2-ico')} ${i.commentCount || comments.comments.length || 0} 条回复</h2>
      <div id="comment-list">${renderComments(comments.comments)}</div>
      ${renderReplyEditor(i)}
    </section>`;

  bindReplyEditor(number);
}

function renderComments(comments) {
  if (!comments.length) {
    return `<div class="empty" style="padding:30px 0"><div class="empty-ico">${ico('forum')}</div><p>还没有回复，来抢沙发</p></div>`;
  }
  return comments
    .map((cm) => {
      const initial = (cm.author || '?').slice(0, 1).toUpperCase();
      return `
      <div class="comment-card ${cm.isMine ? 'mine-card' : ''}" id="c-${esc(cm.id)}">
        <div class="comment-head">
          <span class="comment-avatar">${esc(initial)}</span>
          <span class="comment-author">${esc(cm.author)}</span>
          ${cm.isMine ? '<span class="badge mine">我回复的</span>' : ''}
          <span style="margin-left:auto">${fmtTime(cm.createdAt)}</span>
        </div>
        <div class="markdown-body">${renderMarkdown(cm.body)}</div>
      </div>`;
    })
    .join('');
}

function renderReplyEditor(issue) {
  if (!App.user) {
    return `
      <div class="reply-editor" style="text-align:center;color:var(--md-on-surface-variant)">
        <p style="margin:0 0 12px">登录后即可回复这个 Issue</p>
        <button class="btn btn-primary" onclick="LoginUI.open()">使用邮箱验证码登录</button>
      </div>`;
  }
  if (issue.state === 'closed') {
    return `<div class="reply-editor" style="text-align:center;color:var(--md-on-surface-variant)">该 Issue 已关闭，无法继续回复</div>`;
  }
  return `
    <div class="reply-editor">
      <div class="form-field" style="margin-bottom:12px">
        <label>写下你的回复 <span class="muted">（将以「${esc(App.user.nickname)}」发布，支持 Markdown）</span></label>
        <textarea id="reply-body" style="min-height:96px" placeholder="补充信息、说明复现步骤或表达你的看法…"></textarea>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" id="btn-reply">发布回复</button>
      </div>
    </div>`;
}

function bindReplyEditor(number) {
  const btn = document.getElementById('btn-reply');
  if (!btn) return;
  btn.onclick = async () => {
    const bodyEl = document.getElementById('reply-body');
    const text = bodyEl.value.trim();
    if (!text) {
      toast('回复内容不能为空', 'error');
      return;
    }
    btn.disabled = true;
    btn.textContent = '发布中…';
    try {
      await api(`/api/issues/${number}/comments`, { method: 'POST', body: { body: text } });
      toast('回复成功！');
      await renderDetailPage(document.getElementById('app'), number);
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    } catch (e) {
      if (e.status === 401) {
        toast('登录状态已过期，请重新登录', 'warn');
        LoginUI.open();
      } else {
        toast(e.message, 'error', 5000);
      }
      btn.disabled = false;
      btn.textContent = '发布回复';
    }
  };
}

// ==================== 我的提交 ====================

async function renderMinePage(el) {
  if (!App.user) {
    el.innerHTML = `
      <div class="empty">
        <div class="empty-ico">${ico('lock')}</div>
        <p>登录后可以查看你提交的 Issue 与回复</p>
        <button class="btn btn-primary btn-lg" onclick="LoginUI.open()">使用邮箱验证码登录</button>
      </div>`;
    return;
  }

  el.innerHTML = `
    <div class="profile-card">
      <div class="profile-avatar">${esc((App.user.nickname || '?').slice(0, 1).toUpperCase())}</div>
      <div class="profile-info">
        <h2>${esc(App.user.nickname)}</h2>
        <p>${esc(App.user.email)} · 邮箱已验证</p>
      </div>
      <div class="nickname-edit">
        <input type="text" id="nickname-input" maxlength="24" placeholder="新的昵称" value="${esc(App.user.nickname)}" />
        <button class="btn btn-outline" id="btn-nickname">修改昵称</button>
        <button class="btn btn-danger" id="btn-logout">退出登录</button>
      </div>
    </div>
    <h2 class="section-title">${ico('assignment', 'h2-ico')} 我提交的 Issue</h2>
    <div class="issue-list" id="my-list"><div class="page-loading"><div class="spinner"></div></div></div>`;

  document.getElementById('btn-logout').onclick = logout;
  document.getElementById('btn-nickname').onclick = async () => {
    const nickname = document.getElementById('nickname-input').value.trim();
    if (!nickname) {
      toast('昵称不能为空', 'error');
      return;
    }
    try {
      const r = await api('/api/me', { method: 'PUT', body: { nickname } });
      App.user = r.user;
      renderHeaderUser();
      toast('昵称已更新，之后提交的 Issue 将使用新昵称');
    } catch (e) {
      toast(e.message, 'error');
    }
  };

  const listEl = document.getElementById('my-list');
  try {
    const r = await api('/api/my/issues');
    if (!r.issues.length) {
      listEl.innerHTML = `<div class="empty"><div class="empty-ico">${ico('send')}</div><p>你还没有提交过 Issue</p><a href="#/new"><button class="btn btn-primary">提交第一个</button></a></div>`;
      return;
    }
    listEl.innerHTML = r.issues
      .map(
        (i) => `
        <a class="issue-row" href="#/issue/${i.number}">
          <span class="issue-state-icon ${i.state === 'open' ? 'is-open' : ''}">${ico(i.state === 'open' ? 'circle' : 'check_circle')}</span>
          <div class="issue-main">
            <div class="issue-title">${esc(i.title)}</div>
            <div class="issue-meta">
              <span class="badge state-${esc(i.state)}">${i.state === 'open' ? '进行中' : '已关闭'}</span>
              ${i.labels.map((l) => `<span class="badge">${esc(l)}</span>`).join('')}
              <span>#${i.number}</span>
              <span>${fmtTime(i.createdAt)} 提交</span>
            </div>
          </div>
          <span class="issue-side">${ico('chat')}${i.commentCount}</span>
        </a>`,
      )
      .join('');
  } catch (e) {
    listEl.innerHTML = `<div class="empty"><div class="empty-ico">${ico('error')}</div><p>${esc(e.message)}</p></div>`;
  }
}
