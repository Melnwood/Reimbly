/* Reimbly front-end. Vanilla JS, no build step. */
(() => {
  'use strict';

  const state = {
    config: null,
    token: null, // Google ID token (Bearer)
    me: null, // { email, name, role, canApprove }
    view: 'submit',
    loaded: { mine: false, approvals: false, audit: false, dashboard: false, archive: false },
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
    receiptCamera: $('#f-camera'),
    receiptName: $('#receipt-name'),
    mineList: $('#mine-list'),
    approvalsList: $('#approvals-list'),
    auditSummary: $('#audit-summary'),
    auditList: $('#audit-list'),
    dashTiles: $('#dash-tiles'),
    dashAccounts: $('#dash-accounts'),
    dashStatus: $('#dash-status'),
    dashHistory: $('#dash-history'),
    archiveReadyWrap: $('#archive-ready-wrap'),
    archiveReady: $('#archive-ready'),
    archivePaid: $('#archive-paid'),
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
    state.loaded = { mine: false, approvals: false, audit: false, dashboard: false };
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
    $('.tab[data-view="dashboard"]').hidden = !state.me.canApprove;
    $('.tab[data-view="archive"]').hidden = !state.me.canApprove;

    // Default the date field to today.
    const dateInput = $('#f-date');
    if (dateInput && !dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);

    loadOptions();
    switchView('submit');
  }

  // Per-person account usage, kept on this device — the app "learns" which
  // accounts you use most and floats them to the top of the picker.
  function usageKey() {
    return `reimbly.accts.${(state.me && state.me.email) || 'anon'}`;
  }
  function accountUsage() {
    try { return JSON.parse(localStorage.getItem(usageKey()) || '{}') || {}; } catch { return {}; }
  }
  function bumpAccountUsage(code) {
    if (!code) return;
    try {
      const u = accountUsage();
      u[code] = (u[code] || 0) + 1;
      localStorage.setItem(usageKey(), JSON.stringify(u));
    } catch { /* private mode — no history, that's fine */ }
  }

  function populateAccounts() {
    const sel = $('#f-account');
    if (!state.accounts.length) return;
    const usage = accountUsage();
    const opt = (a) => `<option value="${escapeHtml(a.code)}">${escapeHtml(a.code)} – ${escapeHtml(a.name)}</option>`;

    const frequent = state.accounts
      .filter((a) => usage[a.code] > 0)
      .sort((a, b) => usage[b.code] - usage[a.code] || a.code.localeCompare(b.code))
      .slice(0, 6);

    let html = '<option value="">Choose an account…</option>';
    if (frequent.length) html += `<optgroup label="Your accounts">${frequent.map(opt).join('')}</optgroup>`;
    html += `<optgroup label="All accounts">${state.accounts.map(opt).join('')}</optgroup>`;
    sel.innerHTML = html;
  }

  async function loadOptions() {
    try {
      const data = await api('options');
      state.accounts = (data && data.accounts) || [];
      populateAccounts();
    } catch (e) {
      $('#f-account').innerHTML = '<option value="">Couldn’t load accounts — refresh</option>';
    }
  }

  function switchView(view) {
    state.view = view;
    $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
    $$('.view').forEach((v) => { v.hidden = v.dataset.view !== view; });

    if (view === 'mine' && !state.loaded.mine) loadMine();
    if (view === 'approvals' && !state.loaded.approvals) loadApprovals();
    if (view === 'audit' && !state.loaded.audit) loadAudit();
    if (view === 'dashboard' && !state.loaded.dashboard) loadDashboard();
    if (view === 'archive' && !state.loaded.archive) loadArchive();
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
    if (s.merchant) $('#f-business').value = s.merchant;
    if (s.description || s.merchant) $('#f-description').value = s.description || s.merchant;
  }

  function currentReceipt() {
    return el.receiptInput.files[0] || el.receiptCamera.files[0];
  }

  async function onReceiptChange(event) {
    const input = event.target;
    const file = input.files && input.files[0];
    // keep only the input the file came from populated
    (input === el.receiptCamera ? el.receiptInput : el.receiptCamera).value = '';
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
    const merchant = $('#f-business').value.trim();
    const file = currentReceipt();

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

      const body = { amount, currency, account, date, description, merchant, receipt };
      if (editing) body.id = state.editingId;

      const result = await api(editing ? 'update-expense' : 'submit-expense', { method: 'POST', body });

      bumpAccountUsage(account); // learn this person's go-to accounts
      cancelEdit(); // resets form, date, labels, banner, editingId
      populateAccounts(); // re-sort with the freshly used account near the top

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
    $('#f-business').value = e.merchant || '';
    $('#f-description').value = e.description || '';
    el.receiptInput.value = '';
    el.receiptCamera.value = '';
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

  // Business name is the headline; the description drops to the meta line.
  function cardTitle(e) {
    return escapeHtml(e.merchant || e.description || '(no description)');
  }
  function cardMeta(e, tail) {
    const parts = [];
    if (e.merchant && e.description) parts.push(e.description);
    (tail || []).forEach((t) => { if (t) parts.push(t); });
    return parts.map(escapeHtml).join(' · ');
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
            <div class="expense-desc">${cardTitle(e)}</div>
            <div class="expense-meta">${cardMeta(e, [e.account || e.category, fmtDate(e.date)])}</div>
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

  // Group each person's pending expenses into one "report" the upline approves
  // together.
  function groupBySubmitter(expenses) {
    const groups = new Map();
    for (const e of expenses) {
      const key = e.submitterId || e.submitterEmail || 'unknown';
      if (!groups.has(key)) {
        groups.set(key, { key, name: e.submitterName || e.submitterEmail || 'Someone', items: [], total: 0 });
      }
      const g = groups.get(key);
      g.items.push(e);
      g.total += Number(e.amountUsd) || 0;
    }
    return [...groups.values()];
  }

  function renderApprovals(expenses) {
    if (!expenses.length) {
      el.approvalsList.innerHTML = `<div class="state"><span class="emoji">✅</span>All caught up — nothing waiting.</div>`;
      return;
    }
    el.approvalsList.innerHTML = groupBySubmitter(expenses).map((g) => `
      <div class="report" data-group="${escapeHtml(g.key)}">
        <div class="report-head">
          <div class="report-who">
            <div class="report-name">${escapeHtml(g.name)}</div>
            <div class="report-sub">${g.items.length} expense${g.items.length === 1 ? '' : 's'} · ${escapeHtml(money(g.total, 'USD'))}</div>
          </div>
          <button class="btn primary small" data-act="approve-all">Approve all</button>
        </div>
        <div class="report-items">
          ${g.items.map((e) => `
            <article class="expense" data-id="${escapeHtml(e.id)}">
              <div class="expense-top">
                <div class="expense-main">
                  <div class="expense-desc">${cardTitle(e)}</div>
                  <div class="expense-meta">${cardMeta(e, [e.account || e.category, fmtDate(e.date)])}</div>
                </div>
                ${amountBlock(e)}
              </div>
              <div class="expense-actions">
                ${receiptLink(e)}
                <button class="btn ghost small" data-act="sendback-toggle">Send back</button>
              </div>
              <div class="sendback-row">
                <input type="text" placeholder="What needs fixing?" data-role="note" maxlength="200" />
                <button class="btn primary small" data-act="sendback-confirm">Send</button>
              </div>
            </article>`).join('')}
        </div>
      </div>
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

  function afterApprovalsChange() {
    state.loaded.mine = false;
    state.loaded.dashboard = false;
    state.loaded.archive = false; // approved items now show up under "Ready to pay"
  }

  // Remove a card (and its now-empty report) with a little animation.
  function removeApprovalCard(card) {
    const group = card.closest('.report');
    card.style.transition = 'opacity .25s, transform .25s';
    card.style.opacity = '0';
    card.style.transform = 'translateX(12px)';
    setTimeout(() => {
      card.remove();
      if (group && !$$('.expense', group).length) group.remove();
      if (!$$('.report', el.approvalsList).length) renderApprovals([]);
    }, 240);
  }

  async function sendBack(card, note) {
    const buttons = $$('button', card);
    buttons.forEach((b) => (b.disabled = true));
    try {
      await api('decision', { method: 'POST', body: { id: card.dataset.id, decision: 'sendback', note } });
      removeApprovalCard(card);
      afterApprovalsChange();
      toast('Sent back ↩︎', 'good');
    } catch (e) {
      buttons.forEach((b) => (b.disabled = false));
      toast(e.message, 'bad');
    }
  }

  async function approveAll(group) {
    const ids = $$('.expense', group).map((c) => c.dataset.id);
    const buttons = $$('button', group);
    buttons.forEach((b) => (b.disabled = true));
    try {
      const res = await api('decide-batch', { method: 'POST', body: { ids, decision: 'approve' } });
      group.style.transition = 'opacity .25s';
      group.style.opacity = '0';
      setTimeout(() => {
        group.remove();
        if (!$$('.report', el.approvalsList).length) renderApprovals([]);
      }, 240);
      afterApprovalsChange();
      toast(`Approved ${res.approved} expense${res.approved === 1 ? '' : 's'} ✅`, 'good');
    } catch (e) {
      buttons.forEach((b) => (b.disabled = false));
      toast(e.message, 'bad');
    }
  }

  function onApprovalsClick(event) {
    const btn = event.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;

    if (act === 'approve-all') {
      const group = event.target.closest('.report');
      if (group) approveAll(group);
      return;
    }

    const card = event.target.closest('.expense');
    if (!card) return;
    if (act === 'sendback-toggle') {
      const row = $('.sendback-row', card);
      row.classList.toggle('open');
      if (row.classList.contains('open')) $('input[data-role="note"]', row).focus();
    } else if (act === 'sendback-confirm') {
      const note = $('input[data-role="note"]', card).value.trim();
      if (!note) return toast('Add a short note so they know what to fix.', 'bad');
      sendBack(card, note);
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
            <div class="expense-desc">${cardTitle(e)}</div>
            <div class="expense-meta">${cardMeta(e, [e.submitterName || e.submitterEmail || '—', e.account || '—', fmtDate(e.date) || '—'])}</div>
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

  // ---------- Dashboard ----------

  function tile(label, value) {
    return `<div class="tile"><div class="tile-val">${escapeHtml(value)}</div><div class="tile-label">${escapeHtml(label)}</div></div>`;
  }

  function renderDashboard(d) {
    el.dashTiles.innerHTML = [
      tile('Total spent', money(d.totals.usd, 'USD')),
      tile('Expenses', String(d.totals.count)),
      tile('This month', money(d.thisMonthUsd, 'USD')),
    ].join('');

    const max = (d.byAccount[0] && d.byAccount[0].usd) || 1;
    el.dashAccounts.innerHTML = d.byAccount.length
      ? d.byAccount.map((a) => `
        <div class="bar-row">
          <div class="bar-top"><span class="bar-label">${escapeHtml(a.account)}</span><span class="bar-val">${escapeHtml(money(a.usd, 'USD'))}</span></div>
          <div class="bar-track"><div class="bar-fill" style="width:${Math.max(3, (a.usd / max) * 100)}%"></div></div>
        </div>`).join('')
      : `<div class="state">No spend yet.</div>`;

    el.dashStatus.innerHTML = d.byStatus.map((s) => {
      const key = String(s.status).toLowerCase().replace(/[^a-z]/g, '');
      const cls = ['draft', 'submitted', 'approved', 'rejected', 'reimbursed'].includes(key) ? key : 'submitted';
      return `<span class="badge ${cls}">${escapeHtml(s.status)} · ${s.count} · ${escapeHtml(money(s.usd, 'USD'))}</span>`;
    }).join('');

    el.dashHistory.innerHTML = (d.history || []).length
      ? d.history.map((e) => `
        <article class="expense">
          <div class="expense-top">
            <div class="expense-main">
              <div class="expense-desc">${cardTitle(e)}</div>
              <div class="expense-meta">${cardMeta(e, [e.submitterName || e.submitterEmail, e.account, fmtDate(e.date)])}</div>
            </div>
            ${amountBlock(e)}
          </div>
          <div class="expense-actions">${statusBadge(e.status)}${receiptLink(e)}</div>
        </article>`).join('')
      : `<div class="state">No history yet.</div>`;
  }

  async function loadDashboard() {
    el.dashTiles.innerHTML = '';
    el.dashAccounts.innerHTML = '';
    el.dashStatus.innerHTML = '';
    el.dashHistory.innerHTML = `<div class="state">Loading…</div>`;
    try {
      const d = await api('dashboard');
      state.loaded.dashboard = true;
      renderDashboard(d);
    } catch (e) {
      el.dashHistory.innerHTML = `<div class="state">${escapeHtml(e.message)}</div>`;
    }
  }

  // ---------- Paid / archive ----------

  // A read-only expense card (used in the paid history).
  function paidCard(e) {
    return `
      <article class="expense">
        <div class="expense-top">
          <div class="expense-main">
            <div class="expense-desc">${cardTitle(e)}</div>
            <div class="expense-meta">${cardMeta(e, [e.submitterName || e.submitterEmail, e.account, fmtDate(e.date)])}</div>
          </div>
          ${amountBlock(e)}
        </div>
        <div class="expense-actions">
          ${statusBadge(e.status)}
          ${e.paidOn ? `<span class="paid-on">Paid ${escapeHtml(fmtDate(e.paidOn))}</span>` : ''}
          ${receiptLink(e)}
        </div>
      </article>`;
  }

  function renderArchive(data) {
    const ready = data.ready || [];
    const paid = data.paid || [];

    // "Ready to pay" — grouped by person, Finance marks a whole report paid.
    if (data.role === 'Finance') {
      el.archiveReadyWrap.hidden = false;
      el.archiveReady.innerHTML = ready.length
        ? groupBySubmitter(ready).map((g) => `
          <div class="report" data-group="${escapeHtml(g.key)}">
            <div class="report-head">
              <div class="report-who">
                <div class="report-name">${escapeHtml(g.name)}</div>
                <div class="report-sub">${g.items.length} expense${g.items.length === 1 ? '' : 's'} · ${escapeHtml(money(g.total, 'USD'))}</div>
              </div>
              <button class="btn primary small" data-act="mark-paid">Mark paid</button>
            </div>
            <div class="report-items">
              ${g.items.map((e) => `
                <article class="expense" data-id="${escapeHtml(e.id)}">
                  <div class="expense-top">
                    <div class="expense-main">
                      <div class="expense-desc">${cardTitle(e)}</div>
                      <div class="expense-meta">${cardMeta(e, [e.account || e.category, fmtDate(e.date)])}</div>
                    </div>
                    ${amountBlock(e)}
                  </div>
                  <div class="expense-actions">${receiptLink(e)}</div>
                </article>`).join('')}
            </div>
          </div>`).join('')
        : `<div class="state"><span class="emoji">💸</span>Nothing waiting — every approved expense has been paid.</div>`;
    } else {
      el.archiveReadyWrap.hidden = true;
    }

    el.archivePaid.innerHTML = paid.length
      ? paid.map(paidCard).join('')
      : `<div class="state"><span class="emoji">🗂️</span>No paid expenses yet.</div>`;
  }

  async function markPaid(group) {
    const ids = $$('.expense', group).map((c) => c.dataset.id);
    const buttons = $$('button', group);
    buttons.forEach((b) => (b.disabled = true));
    try {
      const res = await api('mark-paid', { method: 'POST', body: { ids } });
      group.style.transition = 'opacity .25s';
      group.style.opacity = '0';
      setTimeout(() => {
        group.remove();
        if (!$$('.report', el.archiveReady).length) {
          el.archiveReady.innerHTML = `<div class="state"><span class="emoji">💸</span>Nothing waiting — every approved expense has been paid.</div>`;
        }
      }, 240);
      state.loaded.dashboard = false; // status counts changed
      state.loaded.archive = false; // paid history changed
      toast(`Marked ${res.paid} expense${res.paid === 1 ? '' : 's'} paid 💸`, 'good');
    } catch (e) {
      buttons.forEach((b) => (b.disabled = false));
      toast(e.message, 'bad');
    }
  }

  function onArchiveClick(event) {
    const btn = event.target.closest('button[data-act="mark-paid"]');
    if (!btn) return;
    const group = event.target.closest('.report');
    if (group) markPaid(group);
  }

  async function loadArchive() {
    el.archiveReadyWrap.hidden = true;
    el.archivePaid.innerHTML = `<div class="state">Loading…</div>`;
    try {
      const data = await api('archive');
      state.loaded.archive = true;
      renderArchive(data);
    } catch (e) {
      el.archivePaid.innerHTML = `<div class="state">${escapeHtml(e.message)}</div>`;
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
    el.receiptCamera.addEventListener('change', onReceiptChange);
    $('#btn-choose').addEventListener('click', () => el.receiptInput.click());
    $('#btn-camera').addEventListener('click', () => el.receiptCamera.click());
    el.mineList.addEventListener('click', onMineClick);
    el.approvalsList.addEventListener('click', onApprovalsClick);
    el.auditList.addEventListener('click', onAuditClick);
    el.archiveReady.addEventListener('click', onArchiveClick);
    const refreshers = { mine: loadMine, approvals: loadApprovals, audit: loadAudit, dashboard: loadDashboard, archive: loadArchive };
    $$('[data-refresh]').forEach((b) =>
      b.addEventListener('click', () => (refreshers[b.dataset.refresh] || (() => {}))())
    );
  }

  bind();
  boot();
})();
