/* Reimbly front-end. Vanilla JS, no build step. */
(() => {
  'use strict';

  const state = {
    config: null,
    token: null, // Google ID token (Bearer)
    me: null, // { email, name, role, canApprove }
    view: 'submit',
    loaded: { mine: false, approvals: false, audit: false },
    accounts: [],
    mineExpenses: [],
    editingId: null,
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const el = {
    boot: $('#boot'),
    signin: $('#signin'),
    app: $('#app'),
    googleBtn: $('#google-btn'),
    signinHint: $('#signin-hint'),
    whoName: $('#who-name'),
    whoRole: $('#who-role'),
    tabs: $('#tabs'),
    form: $('#expense-form'),
    submitBtn: $('#submit-btn'),
    receiptInput: $('#f-receipt'),
    receiptName: $('#receipt-name'),
    mineList: $('#mine-list'),
    approvalsList: $('#approvals-list'),
    auditSummary: $('#audit-summary'),
    auditList: $('#audit-list'),
    toast: $('#toast'),
  };

  // ---------- Helpers ----------

  function money(n, currency) {
    if (n == null || isNaN(n)) return '—';
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency || 'USD',
        currencyDisplay: 'narrowSymbol',
      }).format(n);
    } catch {
      return `${Number(n).toFixed(2)} ${currency || ''}`.trim();
    }
  }

  function fmtDate(value) {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d)) return String(value);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  let toastTimer;
  function toast(message, kind = '') {
    clearTimeout(toastTimer);
    el.toast.textContent = message;
    el.toast.className = `toast show ${kind}`;
    el.toast.hidden = false;
    toastTimer = setTimeout(() => {
      el.toast.className = 'toast';
      setTimeout(() => { el.toast.hidden = true; }, 200);
    }, 3200);
  }

  async function api(path, { method = 'GET', body, auth = true } = {}) {
    const headers = {};
    if (auth) {
      if (!state.token) throw new Error('Please sign in again.');
      headers.Authorization = `Bearer ${state.token}`;
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await fetch(`/api/${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    let data = null;
    try { data = await res.json(); } catch { /* non-JSON */ }

    if (res.status === 401) {
      // Token expired or invalid — bounce back to sign-in.
      signOut('Your session expired. Please sign in again.');
      throw new Error((data && data.error) || 'Session expired.');
    }
    if (!res.ok) {
      throw new Error((data && data.error) || `Request failed (${res.status}).`);
    }
    return data;
  }

  // ---------- Auth ----------

  async function boot() {
    try {
      state.config = await api('config', { auth: false });
    } catch (e) {
      el.boot.innerHTML = `<p>Reimbly isn't configured yet.<br /><small>${escapeHtml(e.message)}</small></p>`;
      return;
    }
    initGoogle();
    el.boot.hidden = true;
    el.signin.hidden = false;
  }

  function initGoogle() {
    const start = () => {
      if (!window.google || !window.google.accounts || !window.google.accounts.id) {
        return setTimeout(start, 120);
      }
      window.google.accounts.id.initialize({
        client_id: state.config.googleClientId,
        callback: onCredential,
        auto_select: false,
        cancel_on_tap_outside: true,
        hd: state.config.allowedDomain || undefined,
      });
      window.google.accounts.id.renderButton(el.googleBtn, {
        theme: 'filled_black',
        size: 'large',
        shape: 'pill',
        text: 'signin_with',
        logo_alignment: 'left',
      });
      window.google.accounts.id.prompt();
    };
    start();
  }

  async function onCredential(response) {
    state.token = response.credential;
    el.signinHint.className = 'hint';
    el.signinHint.textContent = 'Signing you in…';
    try {
      state.me = await api('me');
      enterApp();
    } catch (e) {
      state.token = null;
      el.signinHint.className = 'hint error';
      el.signinHint.textContent = e.message;
    }
  }

  function signOut(message) {
    state.token = null;
    state.me = null;
    state.loaded = { mine: false, approvals: false, audit: false };
    try { window.google?.accounts?.id?.disableAutoSelect(); } catch { /* noop */ }
    el.app.hidden = true;
    el.signin.hidden = false;
    if (message) {
      el.signinHint.className = 'hint';
      el.signinHint.textContent = message;
    }
  }

  // ---------- App ----------

  function enterApp() {
    el.signin.hidden = true;
    el.app.hidden = false;
    el.whoName.textContent = state.me.name;
    el.whoRole.textContent = state.me.role;

    $('.tab[data-view="approvals"]').hidden = !state.me.canApprove;
    $('.tab[data-view="audit"]').hidden = !state.me.canApprove;

    // Default the date field to today.
    const dateInput = $('#f-date');
    if (dateInput && !dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);

    loadOptions();
    switchView('submit');
  }

  async function loadOptions() {
    const sel = $('#f-account');
    try {
      const data = await api('options');
      state.accounts = (data && data.accounts) || [];
      const opts = ['<option value="">Choose an account…</option>'];
      for (const a of state.accounts) {
        opts.push(`<option value="${escapeHtml(a.code)}">${escapeHtml(a.code)} – ${escapeHtml(a.name)}</option>`);
      }
      sel.innerHTML = opts.join('');
    } catch (e) {
      sel.innerHTML = '<option value="">Couldn’t load accounts — refresh</option>';
    }
  }

  function switchView(view) {
    state.view = view;
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
    $$('.view').forEach((v) => { v.hidden = v.dataset.view !== view; });

    if (view === 'mine' && !state.loaded.mine) loadMine();
    if (view === 'approvals' && !state.loaded.approvals) loadApprovals();
    if (view === 'audit' && !state.loaded.audit) loadAudit();
  }

  // ---------- Submit ----------

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const comma = result.indexOf(',');
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.onerror = () => reject(new Error('Could not read that file.'));
      reader.readAsDataURL(file);
    });
  }

  // ---------- Receipt scan (auto-fill) ----------

  function hasOption(sel, value) {
    return Array.from($(sel).options).some((o) => o.value === value);
  }

  function applyScan(s) {
    if (s.amount != null) $('#f-amount').value = s.amount;
    if (s.currency && hasOption('#f-currency', s.currency)) $('#f-currency').value = s.currency;
    if (s.date) $('#f-date').value = s.date; // receipt date beats today's default
    if (s.account && hasOption('#f-account', s.account)) $('#f-account').value = s.account;
    const desc = s.description || s.merchant;
    if (desc) $('#f-description').value = desc;
  }

  async function onReceiptChange() {
    const file = el.receiptInput.files[0];
    el.receiptName.textContent = file ? file.name : '';
    if (!file) return;

    if (state.editingId) return; // during an edit, just attach — don't re-scan/overwrite fields

    const type = (file.type || '').toLowerCase();
    if (!type.startsWith('image/') && type !== 'application/pdf') return; // can't scan it — fine

    el.receiptName.textContent = `${file.name} · reading…`;
    el.submitBtn.disabled = true;
    try {
      const base64 = await readFileAsBase64(file);
      const result = await api('scan-receipt', {
        method: 'POST',
        body: { receipt: { filename: file.name, contentType: file.type || 'application/octet-stream', base64 } },
      });
      if (result && result.scan) {
        applyScan(result.scan);
        el.receiptName.textContent = `${file.name} · filled from receipt ✨`;
        toast('Filled from your receipt — please double-check.', 'good');
      } else {
        el.receiptName.textContent = file.name;
      }
    } catch (e) {
      el.receiptName.textContent = file.name; // scanning is best-effort; never block
    } finally {
      el.submitBtn.disabled = false;
    }
  }

  async function onSubmit(event) {
    event.preventDefault();
    const form = el.form;

    const amount = parseFloat($('#f-amount').value);
    const currency = $('#f-currency').value;
    const account = $('#f-account').value;
    const date = $('#f-date').value;
    const description = $('#f-description').value.trim();
    const file = el.receiptInput.files[0];

    if (!description) return toast('Add a short description.', 'bad');
    if (!(amount > 0)) return toast('Amount must be greater than zero.', 'bad');
    if (!date) return toast('Pick the date of the expense.', 'bad');
    if (!account) return toast('Choose the account to charge this to.', 'bad');

    const editing = !!state.editingId;
    el.submitBtn.disabled = true;
    el.submitBtn.textContent = editing ? 'Saving…' : 'Submitting…';

    try {
      let receipt = null;
      if (file) {
        receipt = {
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          base64: await readFileAsBase64(file),
        };
      }

      const body = { amount, currency, account, date, description, receipt };
      if (editing) body.id = state.editingId;

      const result = await api(editing ? 'update-expense' : 'submit-expense', { method: 'POST', body });

      cancelEdit(); // resets form, date, labels, banner, editingId

      if (editing) {
        toast(result.resubmitted ? 'Saved and resubmitted for approval.' : 'Changes saved.', 'good');
      } else if (result.warning) {
        toast(result.warning, 'bad');
      } else {
        toast('Expense submitted 🎉', 'good');
      }

      state.loaded.mine = false;
      state.loaded.audit = false;
      switchView('mine');
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      el.submitBtn.disabled = false;
      el.submitBtn.textContent = state.editingId ? 'Save changes' : 'Submit expense';
    }
  }

  // ---------- Edit / delete ----------

  function startEdit(id) {
    const e = state.mineExpenses.find((x) => x.id === id);
    if (!e) return;
    state.editingId = id;
    $('#f-amount').value = e.amount != null ? e.amount : '';
    if (e.currency && hasOption('#f-currency', e.currency)) $('#f-currency').value = e.currency;
    if (e.accountCode && hasOption('#f-account', e.accountCode)) $('#f-account').value = e.accountCode;
    $('#f-date').value = e.date || '';
    $('#f-description').value = e.description || '';
    el.receiptInput.value = '';
    el.receiptName.textContent = e.receipt ? `Keeping current receipt (${e.receipt.filename || 'attached'})` : '';
    $('#submit-title').textContent = 'Edit expense';
    el.submitBtn.textContent = 'Save changes';
    $('#edit-banner').hidden = false;
    switchView('submit');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    state.editingId = null;
    el.form.reset();
    $('#f-date').value = new Date().toISOString().slice(0, 10);
    el.receiptName.textContent = '';
    $('#submit-title').textContent = 'New expense';
    el.submitBtn.textContent = 'Submit expense';
    $('#edit-banner').hidden = true;
  }

  async function deleteExpense(id, onDone) {
    if (!window.confirm('Delete this expense? This can’t be undone.')) return;
    try {
      await api('delete-expense', { method: 'POST', body: { id } });
      toast('Expense deleted.', 'good');
      if (onDone) onDone();
    } catch (e) {
      toast(e.message, 'bad');
    }
  }

  function onMineClick(event) {
    const btn = event.target.closest('button[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (btn.dataset.act === 'edit') startEdit(id);
    else if (btn.dataset.act === 'delete') {
      deleteExpense(id, () => { state.loaded.mine = false; state.loaded.audit = false; loadMine(); });
    }
  }

  // ---------- My expenses ----------

  function statusBadge(status) {
    const key = String(status || '').toLowerCase().replace(/[^a-z]/g, '');
    const known = ['draft', 'submitted', 'approved', 'rejected', 'reimbursed'];
    const cls = known.includes(key) ? key : 'submitted';
    return `<span class="badge ${cls}">${escapeHtml(status || 'Submitted')}</span>`;
  }

  function receiptLink(expense) {
    if (!expense.receipt || !expense.receipt.url) return '';
    return `<a class="receipt-link" href="${escapeHtml(expense.receipt.url)}" target="_blank" rel="noopener">📎 Receipt</a>`;
  }

  function amountBlock(expense) {
    const primary = expense.amountUsd != null ? money(expense.amountUsd, 'USD') : money(expense.amount, expense.currency);
    const showOriginal = expense.currency && expense.currency !== 'USD' && expense.amount != null;
    const sub = showOriginal ? `<small>${escapeHtml(money(expense.amount, expense.currency))}</small>` : '';
    return `<div class="expense-amt">${escapeHtml(primary)}${sub}</div>`;
  }

  const EDITABLE = ['Submitted', 'Rejected', 'Draft'];

  function renderMine(expenses) {
    if (!expenses.length) {
      el.mineList.innerHTML = `<div class="state"><span class="emoji">🌱</span>No expenses yet. Submit your first one above!</div>`;
      return;
    }
    el.mineList.innerHTML = expenses.map((e) => {
      const editable = EDITABLE.includes(e.status);
      return `
      <article class="expense">
        <div class="expense-top">
          <div class="expense-main">
            <div class="expense-desc">${escapeHtml(e.description)}</div>
            <div class="expense-meta">${escapeHtml(e.account || e.category)} · ${escapeHtml(fmtDate(e.date))}</div>
          </div>
          ${amountBlock(e)}
        </div>
        <div class="expense-actions">
          ${statusBadge(e.status)}
          ${receiptLink(e)}
          ${editable ? `<button class="link-btn" data-act="edit" data-id="${escapeHtml(e.id)}">Edit</button>` : ''}
          ${editable ? `<button class="link-btn danger" data-act="delete" data-id="${escapeHtml(e.id)}">Delete</button>` : ''}
        </div>
        ${e.status === 'Rejected' && e.notes ? `<div class="expense-note">↩︎ ${escapeHtml(e.notes)}</div>` : ''}
      </article>`;
    }).join('');
  }

  async function loadMine() {
    el.mineList.innerHTML = `<div class="state">Loading…</div>`;
    try {
      const data = await api('my-expenses');
      state.loaded.mine = true;
      state.mineExpenses = data.expenses || [];
      renderMine(state.mineExpenses);
    } catch (e) {
      el.mineList.innerHTML = `<div class="state">${escapeHtml(e.message)}</div>`;
    }
  }

  // ---------- Approvals ----------

  function renderApprovals(expenses) {
    if (!expenses.length) {
      el.approvalsList.innerHTML = `<div class="state"><span class="emoji">✅</span>All caught up — nothing waiting.</div>`;
      return;
    }
    el.approvalsList.innerHTML = expenses.map((e) => `
      <article class="expense" data-id="${escapeHtml(e.id)}">
        <div class="expense-top">
          <div class="expense-main">
            <div class="expense-desc">${escapeHtml(e.description)}</div>
            <div class="expense-meta">${escapeHtml(e.submitterName || e.submitterEmail)} · ${escapeHtml(e.account || e.category)} · ${escapeHtml(fmtDate(e.date))}</div>
          </div>
          ${amountBlock(e)}
        </div>
        <div class="expense-actions">
          ${receiptLink(e)}
          <button class="btn ghost small" data-act="sendback-toggle">Send back</button>
          <button class="btn primary small" data-act="approve">Approve</button>
        </div>
        <div class="sendback-row">
          <input type="text" placeholder="What needs fixing?" data-role="note" maxlength="200" />
          <button class="btn primary small" data-act="sendback-confirm">Send</button>
        </div>
      </article>
    `).join('');
  }

  async function loadApprovals() {
    el.approvalsList.innerHTML = `<div class="state">Loading…</div>`;
    try {
      const data = await api('approvals');
      state.loaded.approvals = true;
      renderApprovals(data.expenses || []);
    } catch (e) {
      el.approvalsList.innerHTML = `<div class="state">${escapeHtml(e.message)}</div>`;
    }
  }

  async function decide(card, decision, note) {
    const id = card.dataset.id;
    const buttons = $$('button', card);
    buttons.forEach((b) => (b.disabled = true));
    try {
      await api('decision', { method: 'POST', body: { id, decision, note } });
      card.style.transition = 'opacity .25s, transform .25s';
      card.style.opacity = '0';
      card.style.transform = 'translateX(12px)';
      setTimeout(() => {
        card.remove();
        if (!$$('.expense', el.approvalsList).length) renderApprovals([]);
      }, 240);
      state.loaded.mine = false; // my list may change too
      toast(decision === 'approve' ? 'Approved ✅' : 'Sent back ↩︎', 'good');
    } catch (e) {
      buttons.forEach((b) => (b.disabled = false));
      toast(e.message, 'bad');
    }
  }

  function onApprovalsClick(event) {
    const btn = event.target.closest('button[data-act]');
    if (!btn) return;
    const card = event.target.closest('.expense');
    if (!card) return;
    const act = btn.dataset.act;

    if (act === 'approve') {
      decide(card, 'approve', '');
    } else if (act === 'sendback-toggle') {
      const row = $('.sendback-row', card);
      row.classList.toggle('open');
      if (row.classList.contains('open')) $('input[data-role="note"]', row).focus();
    } else if (act === 'sendback-confirm') {
      const note = $('input[data-role="note"]', card).value.trim();
      if (!note) return toast('Add a short note so they know what to fix.', 'bad');
      decide(card, 'sendback', note);
    }
  }

  // ---------- Audit ----------

  function renderAudit(data) {
    const c = data.counts || { total: 0, ready: 0, needsAttention: 0 };
    if (c.needsAttention === 0) {
      el.auditSummary.className = 'audit-summary good';
      el.auditSummary.textContent = c.total
        ? `✓ All ${c.total} expense${c.total === 1 ? '' : 's'} are complete and ready for Cedarstone.`
        : 'Nothing to check yet — no submitted or approved expenses.';
      el.auditList.innerHTML = '';
      return;
    }
    el.auditSummary.className = 'audit-summary warn';
    el.auditSummary.textContent = `⚠ ${c.needsAttention} of ${c.total} need attention · ${c.ready} ready.`;

    el.auditList.innerHTML = (data.items || []).map((e) => `
      <article class="expense">
        <div class="expense-top">
          <div class="expense-main">
            <div class="expense-desc">${escapeHtml(e.description || '(no description)')}</div>
            <div class="expense-meta">${escapeHtml(e.submitterName || e.submitterEmail || '—')} · ${escapeHtml(e.account || '—')} · ${escapeHtml(fmtDate(e.date)) || '—'}</div>
          </div>
          ${amountBlock(e)}
        </div>
        <div class="issues">
          ${e.issues.map((i) => `<span class="issue">${escapeHtml(i)}</span>`).join('')}
        </div>
        <div class="expense-actions">
          ${statusBadge(e.status)}
          ${receiptLink(e)}
          ${e.recordUrl ? `<a class="receipt-link" href="${escapeHtml(e.recordUrl)}" target="_blank" rel="noopener">Open in Airtable ↗</a>` : ''}
          <button class="link-btn danger" data-act="delete" data-id="${escapeHtml(e.id)}">Delete</button>
        </div>
      </article>
    `).join('');
  }

  function onAuditClick(event) {
    const btn = event.target.closest('button[data-act="delete"]');
    if (!btn) return;
    deleteExpense(btn.dataset.id, () => { state.loaded.audit = false; state.loaded.mine = false; loadAudit(); });
  }

  async function loadAudit() {
    el.auditSummary.className = 'audit-summary';
    el.auditSummary.textContent = '';
    el.auditList.innerHTML = `<div class="state">Checking…</div>`;
    try {
      const data = await api('audit');
      state.loaded.audit = true;
      renderAudit(data);
    } catch (e) {
      el.auditList.innerHTML = `<div class="state">${escapeHtml(e.message)}</div>`;
    }
  }

  // ---------- Wire up ----------

  function bind() {
    el.tabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.tab');
      if (tab && !tab.hidden) switchView(tab.dataset.view);
    });
    $('#signout').addEventListener('click', () => signOut('Signed out. See you soon!'));
    $('#cancel-edit').addEventListener('click', cancelEdit);
    el.form.addEventListener('submit', onSubmit);
    el.receiptInput.addEventListener('change', onReceiptChange);
    el.mineList.addEventListener('click', onMineClick);
    el.approvalsList.addEventListener('click', onApprovalsClick);
    el.auditList.addEventListener('click', onAuditClick);
    const refreshers = { mine: loadMine, approvals: loadApprovals, audit: loadAudit };
    $$('[data-refresh]').forEach((b) =>
      b.addEventListener('click', () => (refreshers[b.dataset.refresh] || (() => {}))())
    );
  }

  bind();
  boot();
})();
