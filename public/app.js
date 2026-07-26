/* Reimbly front-end. Vanilla JS, no build step. */
(() => {
  'use strict';

  const state = {
    config: null,
    token: null, // Google ID token (Bearer)
    me: null, // { email, name, role, canApprove }
    view: 'submit',
    loaded: { mine: false, approvals: false, audit: false, dashboard: false, archive: false, rates: false, people: false },
    accounts: [],
    mileageRates: [],
    rates: [], // full list (Finance management screen)
    expenseType: 'receipt', // 'receipt' | 'mileage'
    mineExpenses: [],
    editingId: null,
    importRows: [],
    importMode: 'add', // 'add' | 'reconcile'
    sortKey: 'date', // 'date' | 'desc' | 'amt'
    sortDir: 'desc', // 'asc' | 'desc'
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const el = {
    boot: $('#boot'),
    signin: $('#signin'),
    lock: $('#lock'),
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
    approvalsList: $('#approvals-list'),
    auditSummary: $('#audit-summary'),
    auditList: $('#audit-list'),
    addList: $('#add-list'),
    reportsList: $('#reports-list'),
    dashboard: $('#view-dashboard'),
    archiveReadyWrap: $('#archive-ready-wrap'),
    archiveReady: $('#archive-ready'),
    archivePaid: $('#archive-paid'),
    importFile: $('#import-file'),
    importName: $('#import-name'),
    importSummary: $('#import-summary'),
    importPreview: $('#import-preview'),
    importActions: $('#import-actions'),
    ratesList: $('#rates-list'),
    peopleFile: $('#people-file'),
    peopleName: $('#people-name'),
    peopleSummary: $('#people-summary'),
    peopleList: $('#people-list'),
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

  function fmtDateShort(value) {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d)) return String(value);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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
      el.boot.innerHTML = `<p>Rembly isn't configured yet.<br /><small>${escapeHtml(e.message)}</small></p>`;
      return;
    }
    initGoogle();
    el.boot.hidden = true;
    // If this device has Face ID set up for the last person, lock instead of
    // showing the sign-in button.
    const last = (safeGet(LS.last) || '').toLowerCase();
    if (webauthnOK() && last && faceIdEnrolled(last)) {
      el.lock.hidden = false;
      setTimeout(unlockWithFaceId, 350); // auto-prompt Face ID
    } else {
      el.signin.hidden = false;
    }
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
    state.loaded = { mine: false, approvals: false, audit: false, dashboard: false, archive: false, rates: false, people: false };
    clearSession(); // full log-out: don't auto-unlock back in until they sign in again
    try { window.google?.accounts?.id?.disableAutoSelect(); } catch { /* noop */ }
    el.app.hidden = true;
    el.lock.hidden = true;
    el.signin.hidden = false;
    if (message) {
      el.signinHint.className = 'hint';
      el.signinHint.textContent = message;
    }
  }

  // ---------- Face ID (device unlock via WebAuthn) ----------
  // A convenience lock on top of Google sign-in: the phone's Face ID / passcode
  // reveals the already-signed-in session on this device. Google stays the
  // identity; nothing here weakens the server-side check on every request.

  const LS = {
    cred: (email) => `rembly.faceid.${String(email || '').toLowerCase()}`,
    session: 'rembly.session',
    last: 'rembly.lastuser',
  };
  const webauthnOK = () => !!(window.PublicKeyCredential && navigator.credentials && navigator.credentials.create);
  const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
  const safeDel = (k) => { try { localStorage.removeItem(k); } catch { /* noop */ } };

  function rand(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return a; }
  function b64u(buf) { const b = new Uint8Array(buf); let s = ''; b.forEach((x) => { s += String.fromCharCode(x); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function unb64u(str) { let s = str.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const bin = atob(s); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i += 1) a[i] = bin.charCodeAt(i); return a; }
  function jwtExpMs(token) { try { const p = JSON.parse(atob(String(token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); return (p.exp || 0) * 1000; } catch { return 0; } }

  function saveSession() {
    if (!state.token) return;
    safeSet(LS.session, JSON.stringify({ token: state.token, exp: jwtExpMs(state.token), me: state.me }));
    safeSet(LS.last, (state.me && state.me.email) || '');
  }
  function loadSession() { try { return JSON.parse(safeGet(LS.session) || 'null'); } catch { return null; } }
  function clearSession() { safeDel(LS.session); safeDel(LS.last); }
  const faceIdEnrolled = (email) => !!safeGet(LS.cred(email));

  function showSignin() {
    el.lock.hidden = true;
    el.signin.hidden = false;
  }

  async function enrollFaceId() {
    if (!webauthnOK() || !state.me) return;
    try {
      const cred = await navigator.credentials.create({ publicKey: {
        challenge: rand(16),
        rp: { name: 'Rembly', id: location.hostname },
        user: { id: new TextEncoder().encode(state.me.email), name: state.me.email, displayName: state.me.name || state.me.email },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
        timeout: 60000,
      } });
      safeSet(LS.cred(state.me.email), b64u(cred.rawId));
      saveSession();
      updateFaceIdToggle();
      toast('Face ID is on for this device.', 'good');
    } catch (e) {
      toast('Couldn’t turn on Face ID on this device.', 'bad');
    }
  }

  function disableFaceId() {
    if (state.me) safeDel(LS.cred(state.me.email));
    updateFaceIdToggle();
    toast('Face ID turned off.', 'good');
  }

  function updateFaceIdToggle() {
    const btn = $('#faceid-toggle');
    if (!btn) return;
    if (!webauthnOK()) { btn.hidden = true; return; }
    const on = state.me && faceIdEnrolled(state.me.email);
    btn.hidden = false;
    btn.textContent = on ? '🔒 Face ID on' : 'Turn on Face ID';
    btn.onclick = on ? disableFaceId : enrollFaceId;
  }

  // ---------- Push notifications (iPhone / browser alerts) ----------
  // Works on Android/desktop browsers and on iOS 16.4+ once Rembly is added to
  // the Home Screen. Feature-flagged by the server's VAPID public key.

  let swReg = null;
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const pushConfigured = () => !!(state.config && state.config.vapidPublicKey);

  function urlB64ToUint8Array(base64) {
    const padding = '='.repeat((4 - (base64.length % 4)) % 4);
    const b = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function registerSW() {
    if (!pushSupported()) return null;
    if (swReg) return swReg;
    try { swReg = await navigator.serviceWorker.register('/sw.js'); } catch { swReg = null; }
    return swReg;
  }

  async function enablePush() {
    if (!pushSupported() || !pushConfigured()) return;
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { toast('Notifications are blocked for this app in your settings.', 'bad'); return; }
      const reg = await registerSW();
      if (!reg) throw new Error('no sw');
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(state.config.vapidPublicKey),
      });
      await api('save-push-subscription', { method: 'POST', body: { subscription: sub.toJSON() } });
      toast('Alerts are on for this device.', 'good');
    } catch (e) {
      toast('Couldn’t turn on alerts on this device.', 'bad');
    }
    updatePushToggle();
  }

  async function disablePush() {
    try {
      const reg = await registerSW();
      const sub = reg && (await reg.pushManager.getSubscription());
      if (sub) {
        await api('save-push-subscription', { method: 'POST', body: { unsubscribe: sub.endpoint } }).catch(() => {});
        await sub.unsubscribe().catch(() => {});
      }
      toast('Alerts turned off.', 'good');
    } catch { /* best-effort */ }
    updatePushToggle();
  }

  async function updatePushToggle() {
    const btn = $('#push-toggle');
    if (!btn) return;
    if (!pushSupported() || !pushConfigured()) { btn.hidden = true; return; }
    let on = false;
    try {
      const reg = await registerSW();
      on = !!(reg && (await reg.pushManager.getSubscription())) && Notification.permission === 'granted';
    } catch { on = false; }
    btn.hidden = false;
    btn.textContent = on ? '🔔 Alerts on' : 'Turn on alerts';
    btn.onclick = on ? disablePush : enablePush;
  }

  async function unlockWithFaceId() {
    const email = (safeGet(LS.last) || '').toLowerCase();
    const credId = email && safeGet(LS.cred(email));
    if (!credId) return showSignin();
    const hint = $('#lock-hint');
    hint.textContent = 'Reading your face…';
    try {
      await navigator.credentials.get({ publicKey: {
        challenge: rand(16),
        rpId: location.hostname,
        allowCredentials: [{ type: 'public-key', id: unb64u(credId) }],
        userVerification: 'required',
        timeout: 60000,
      } });
    } catch (e) {
      hint.textContent = 'Face ID didn’t match. Try again, or use Google.';
      return;
    }
    // Biometric passed — restore the session if the Google token is still valid.
    const s = loadSession();
    if (s && s.token && s.exp > Date.now() + 30000) {
      state.token = s.token;
      try {
        state.me = s.me || await api('me');
        el.lock.hidden = true;
        enterApp();
        return;
      } catch { /* token rejected — fall through to Google */ }
    }
    hint.textContent = 'Unlocked — just refresh your sign-in below.';
    showSignin();
  }

  // ---------- App ----------

  // Measure the sticky top bar so floating headers (the sort bar) can sit right
  // under it. It re-wraps by width, so re-measure whenever the window changes.
  function updateTopbarVar() {
    const tb = document.querySelector('.topbar');
    if (tb) document.documentElement.style.setProperty('--topbar-h', `${Math.round(tb.getBoundingClientRect().height)}px`);
  }

  function enterApp() {
    el.signin.hidden = true;
    el.lock.hidden = true;
    el.app.hidden = false;
    saveSession(); // remember this session so Face ID can restore it
    updateFaceIdToggle();
    updatePushToggle();
    updateTopbarVar();
    el.whoName.textContent = state.me.name;
    el.whoRole.textContent = state.me.role;

    // Everyone sees the everyday tabs (Add expense, My reports, Dashboard). The
    // admin screens live under a single "Management" menu shown only to
    // approvers/Finance — so you see exactly what everyone else sees, plus that
    // extra menu. Mileage rates + People are Finance-only within it.
    $('#mgmt-menu').hidden = !state.me.canApprove;
    $$('.mgmt-finance').forEach((b) => { b.hidden = state.me.role !== 'Finance'; });

    // Default the date field to today.
    const dateInput = $('#f-date');
    if (dateInput && !dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);

    loadOptions();
    updateDescribeBtn();
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

  function populateRates() {
    const sel = $('#f-rate');
    if (!sel) return;
    if (!state.mileageRates.length) {
      sel.innerHTML = '<option value="">No rates set up yet</option>';
      return;
    }
    sel.innerHTML = state.mileageRates
      .map((r) => `<option value="${escapeHtml(r.id)}" data-rate="${escapeHtml(String(r.rate))}" data-unit="${escapeHtml(r.unit)}" data-currency="${escapeHtml(r.currency)}">${escapeHtml(r.name)} — ${escapeHtml(money(r.rate, r.currency))}/${escapeHtml(r.unit === 'miles' ? 'mi' : 'km')}</option>`)
      .join('');
    updateMileageCalc();
  }

  async function loadOptions() {
    try {
      const data = await api('options');
      state.accounts = (data && data.accounts) || [];
      state.mileageRates = (data && data.mileageRates) || [];
      populateAccounts();
      populateRates();
    } catch (e) {
      $('#f-account').innerHTML = '<option value="">Couldn’t load accounts — refresh</option>';
    }
  }

  // ---------- Expense type: receipt vs mileage ----------

  function selectedRate() {
    const sel = $('#f-rate');
    const opt = sel && sel.options[sel.selectedIndex];
    if (!opt || !opt.value) return null;
    return { id: opt.value, rate: Number(opt.dataset.rate), unit: opt.dataset.unit, currency: opt.dataset.currency };
  }

  function updateMileageCalc() {
    const box = $('#mileage-calc');
    if (!box) return;
    const rate = selectedRate();
    const distance = parseFloat($('#f-distance').value);
    if (rate && distance > 0) {
      const amount = Math.round(distance * rate.rate * 100) / 100;
      box.innerHTML = `${distance} ${escapeHtml(rate.unit)} × ${escapeHtml(money(rate.rate, rate.currency))} = <strong>${escapeHtml(money(amount, rate.currency))}</strong>`;
      box.hidden = false;
    } else {
      box.hidden = true;
    }
  }

  function setExpenseType(type) {
    state.expenseType = type;
    $$('.type-btn').forEach((b) => b.classList.toggle('active', b.dataset.type === type));
    const mileage = type === 'mileage';
    $('#receipt-hero').hidden = mileage;
    $$('.mode-receipt').forEach((n) => { n.hidden = mileage; });
    $$('.mode-mileage').forEach((n) => { n.hidden = !mileage; });
    $$('.mode-mileage-hint').forEach((n) => { n.hidden = !mileage; });
    $('#f-description').placeholder = mileage
      ? 'e.g. trip from Frýdlant to Ostrava (optional)'
      : 'e.g. Team dinner after camp planning';
    if (mileage) updateMileageCalc();
    const box = $('#describe-options');
    if (box) { box.hidden = true; box.innerHTML = ''; }
    updateDescribeBtn();
  }

  const MGMT_VIEWS = ['approvals', 'audit', 'archive', 'timing', 'rates', 'people'];

  function switchView(view) {
    state.view = view;
    $$('.tab[data-view]').forEach((t) => t.classList.toggle('active', t.dataset.view === view));
    $$('#mgmt-list .menu-item').forEach((m) => m.classList.toggle('active', m.dataset.view === view));
    // The "Management" button lights up while any admin screen is open.
    const mgmtBtn = $('#mgmt-btn');
    if (mgmtBtn) mgmtBtn.classList.toggle('active', MGMT_VIEWS.includes(view));
    closeMgmtMenu();
    $$('.view').forEach((v) => { v.hidden = v.dataset.view !== view; });

    if (view === 'submit') showAddExpense();
    if (view === 'mine') showReports();
    if (view === 'approvals' && !state.loaded.approvals) loadApprovals();
    if (view === 'audit' && !state.loaded.audit) loadAudit();
    if (view === 'dashboard' && !state.loaded.dashboard) loadDashboard();
    if (view === 'archive' && !state.loaded.archive) loadArchive();
    if (view === 'timing' && !state.loaded.timing) loadTiming();
    if (view === 'rates' && !state.loaded.rates) loadRates();
    if (view === 'people' && !state.loaded.people) loadPeople();
  }

  // The "Management" dropdown that holds the admin screens.
  function toggleMgmtMenu() {
    const list = $('#mgmt-list');
    const btn = $('#mgmt-btn');
    if (!list || !btn) return;
    const open = list.hidden;
    if (open) {
      // The tab bar scrolls, so anchor the menu with fixed coords to escape it.
      const r = btn.getBoundingClientRect();
      list.style.top = `${Math.round(r.bottom + 6)}px`;
      list.style.left = `${Math.round(Math.min(r.left, window.innerWidth - 220))}px`;
    }
    list.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  }
  function closeMgmtMenu() {
    const list = $('#mgmt-list');
    if (list && !list.hidden) {
      list.hidden = true;
      const btn = $('#mgmt-btn');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    }
  }

  // The account menu behind the person's name — Face ID, alerts, sign out.
  function toggleAcctMenu() {
    const list = $('#acct-list');
    const btn = $('#acct-btn');
    if (!list || !btn) return;
    const open = list.hidden;
    if (open) {
      const r = btn.getBoundingClientRect();
      list.style.top = `${Math.round(r.bottom + 6)}px`;
      // Right-align to the button so it never runs off the edge.
      list.style.left = `${Math.round(Math.max(8, r.right - 220))}px`;
    }
    list.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  }
  function closeAcctMenu() {
    const list = $('#acct-list');
    if (list && !list.hidden) {
      list.hidden = true;
      const btn = $('#acct-btn');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    }
  }

  // The "Re-read receipt dates" tool lives in a closed window, opened from
  // Management. It's a maintenance tool, so it stays out of the everyday view.
  async function openRescanModal() {
    const wrap = $('#rescan-modal');
    if (!wrap) return;
    const note = $('#rescan-note');
    if (note) { note.hidden = true; note.textContent = ''; }
    wrap.hidden = false;
    document.body.classList.add('modal-open');
    // It reads your expenses' receipts — make sure they're loaded.
    try { await ensureReportsData(); } catch (e) { /* the tool will just say none */ }
  }
  function closeRescanModal() {
    const wrap = $('#rescan-modal');
    if (wrap && !wrap.hidden) {
      wrap.hidden = true;
      document.body.classList.remove('modal-open');
    }
  }

  // ----- Bulk receipt upload: read a batch of photos and auto-connect them -----
  async function onBulkReceipts(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    const statusEl = $('#bulk-receipts-status');
    const setStatus = (html, done) => {
      statusEl.hidden = false;
      statusEl.classList.toggle('all-done', !!done);
      statusEl.innerHTML = html;
    };
    setStatus(`<span class="rs-icon">🧾</span><span>Reading ${files.length} receipt${files.length === 1 ? '' : 's'}…</span>`);
    let matched = 0; let created = 0; let failed = 0; let done = 0;
    const BATCH = 6; // keep each request comfortably under the size limit
    try {
      for (let i = 0; i < files.length; i += BATCH) {
        const chunk = files.slice(i, i + BATCH);
        const prepared = await Promise.all(chunk.map((f) => prepareReceipt(f).catch(() => null)));
        const receipts = prepared.filter(Boolean);
        failed += chunk.length - receipts.length;
        if (receipts.length) {
          const res = await api('bulk-receipts', { method: 'POST', body: { receipts } });
          matched += res.matched || 0; created += res.created || 0; failed += res.failed || 0;
        }
        done += chunk.length;
        setStatus(`<span class="rs-icon">🧾</span><span>Reading… ${Math.min(done, files.length)} of ${files.length}</span>`);
      }
      const parts = [];
      if (matched) parts.push(`<strong class="rs-have">${matched}</strong> connected to an expense`);
      if (created) parts.push(`<strong>${created}</strong> added as new`);
      if (failed) parts.push(`<strong class="rs-need">${failed}</strong> couldn’t be read`);
      setStatus(`<span class="rs-icon">✅</span><span>Done — ${parts.join(' · ') || 'nothing to do'}.</span>`, failed === 0);
      await refreshExpenseViews();
    } catch (e) {
      setStatus(`<span class="rs-icon">⚠️</span><span>${escapeHtml(e.message)}</span>`);
    }
  }

  // ----- Missing-receipt affidavit window -----
  function openAffidavitModal(id) {
    const e = (state.mineExpenses || []).find((x) => x.id === id);
    if (!e) { toast('Open the expense, then try again.', 'bad'); return; }
    state.affidavitFor = id;
    const amt = e.amountUsd != null ? money(e.amountUsd, 'USD') : money(e.amount, e.currency);
    $('#aff-summary').innerHTML = [
      ['What', e.merchant || e.description || '(no description)'],
      ['Amount', amt],
      ['Date', fmtDate(e.date) || '—'],
      ['Account', e.account || '—'],
    ].map(([k, v]) => `<div class="aff-sum-row"><span>${k}</span><strong>${escapeHtml(v)}</strong></div>`).join('');
    $('#aff-reason').value = e.affidavitReason || '';
    const name = (state.me && state.me.name) || 'me';
    $('#aff-statement').innerHTML = `This will be signed by <strong>${escapeHtml(name)}</strong> on <strong>${escapeHtml(fmtDate(new Date().toISOString().slice(0, 10)))}</strong>.`;
    $('#aff-agree').checked = false;
    $('#affidavit-modal').hidden = false;
    document.body.classList.add('modal-open');
  }
  function closeAffidavitModal() {
    const w = $('#affidavit-modal');
    if (w && !w.hidden) { w.hidden = true; document.body.classList.remove('modal-open'); }
  }
  async function submitAffidavit() {
    const id = state.affidavitFor;
    if (!id) return;
    const reason = $('#aff-reason').value.trim();
    if (!reason) { toast('Please say why there’s no receipt.', 'bad'); return; }
    if (!$('#aff-agree').checked) { toast('Please check the box to sign.', 'bad'); return; }
    const btn = $('#aff-submit');
    btn.disabled = true;
    try {
      await api('missing-receipt', { method: 'POST', body: { id, reason, agree: true } });
      toast('Declaration signed — your approver will sign off on it.', 'good');
      closeAffidavitModal();
      await refreshExpenseViews();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- Receipt inbox (held email receipts) ----------

  async function loadInbox() {
    const panel = $('#inbox-panel');
    const list = $('#inbox-list');
    if (!panel || !list) return;
    try {
      // Make sure the person's reports are loaded so the "file into a report"
      // picker on each receipt is populated.
      await ensureReportsData();
      const data = await api('receipt-inbox');
      const receipts = data.receipts || [];
      if (!receipts.length) { panel.hidden = true; return; }
      panel.hidden = false;
      list.innerHTML = receipts.map(inboxRowHtml).join('');
      list.querySelectorAll('[data-discard]').forEach((btn) => {
        btn.onclick = () => discardHeld(btn.getAttribute('data-discard'));
      });
      list.querySelectorAll('select[data-role="inbox-file"]').forEach((sel) => {
        sel.onchange = () => fileHeldReceipt(sel.getAttribute('data-id'), sel.value, sel);
      });
    } catch (e) {
      panel.hidden = true;
    }
  }

  // The "file into a report" picker shown on each waiting receipt.
  function inboxReportSelectHtml(id) {
    const opts = ['<option value="">File into a report…</option>']
      .concat((state.reports || []).map((r) => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)}</option>`))
      .concat('<option value="__new__">＋ New report…</option>');
    return `<select class="report-pick" data-role="inbox-file" data-id="${escapeHtml(id)}">${opts.join('')}</select>`;
  }

  function inboxRowHtml(r) {
    const title = r.merchant || r.description || 'Receipt';
    const amt = r.amount != null ? money(r.amount, r.currency) : '—';
    const thumb = r.receipt && (r.receipt.thumb || r.receipt.url)
      ? `<a class="inbox-thumb" href="${escapeHtml(r.receipt.url)}" target="_blank" rel="noopener"><img src="${escapeHtml(r.receipt.thumb || r.receipt.url)}" alt="receipt" /></a>` : '';
    return `
      <div class="import-row">
        ${thumb}
        <div class="ir-main">
          <div class="ir-top"><strong>${escapeHtml(title)}</strong><span class="ir-amt">${escapeHtml(amt)}</span></div>
          <div class="ir-meta">${escapeHtml([fmtDate(r.date) || 'no date', 'from email'].filter(Boolean).join(' · '))}</div>
          <div class="ir-file">${inboxReportSelectHtml(r.id)}</div>
        </div>
        <button type="button" class="link-btn" data-discard="${escapeHtml(r.id)}">Discard</button>
      </div>`;
  }

  // File a held email receipt into a report — it becomes a normal Unsubmitted
  // expense in that report (editable in "Your expenses" below) and leaves the inbox.
  async function fileHeldReceipt(id, value, sel) {
    if (!value) return;
    if (sel) sel.disabled = true;
    try {
      let reportId = value;
      if (value === '__new__') {
        const name = (window.prompt('Name the new report (e.g. “General Fund – July”):') || '').trim();
        if (!name) { if (sel) { sel.disabled = false; sel.value = ''; } return; }
        const made = await api('reports', { method: 'POST', body: { action: 'create', name } });
        reportId = made.report.id;
      }
      const res = await api('reports', { method: 'POST', body: { action: 'file', expenseId: id, reportId } });
      toast(res.merged
        ? 'That charge was already here — attached the receipt to it (no duplicate).'
        : 'Receipt filed into the report — edit it below if you need to.', 'good');
      invalidateReports();
      await ensureReportsData(true);
      populateReportPicker();
      renderAddList();
      loadInbox();
    } catch (e) {
      toast(e.message, 'bad');
      if (sel) { sel.disabled = false; sel.value = ''; }
    }
  }

  async function discardHeld(id) {
    try {
      await api('receipt-inbox', { method: 'POST', body: { id, action: 'discard' } });
      toast('Receipt discarded.', 'good');
      loadInbox();
    } catch (e) {
      toast(e.message, 'bad');
    }
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

  // Turn a picked file into the {filename, contentType, base64} we upload.
  // Phone photos are big — a full-res camera shot, once base64-encoded, can blow
  // past the serverless request-size limit and make the whole save fail. So for
  // images we downscale to a sane size and re-encode as JPEG first (this also
  // quietly converts iPhone HEIC photos to something everything can open). PDFs
  // and anything non-image pass through untouched.
  async function prepareReceipt(file) {
    const raw = async () => ({
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      base64: await readFileAsBase64(file),
    });
    const type = (file.type || '').toLowerCase();
    if (!type.startsWith('image/')) return raw();
    try {
      const shrunk = await new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(url);
          const MAX = 1600;
          let w = img.naturalWidth || img.width;
          let h = img.naturalHeight || img.height;
          if (!w || !h) return reject(new Error('no dimensions'));
          if (Math.max(w, h) > MAX) {
            const s = MAX / Math.max(w, h);
            w = Math.round(w * s);
            h = Math.round(h * s);
          }
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) return reject(new Error('no canvas'));
          ctx.drawImage(img, 0, 0, w, h);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
          if (!dataUrl || dataUrl.indexOf(',') < 0) return reject(new Error('encode failed'));
          const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
          const name = `${file.name.replace(/\.[^.]+$/, '') || 'receipt'}.jpg`;
          resolve({ filename: name, contentType: 'image/jpeg', base64 });
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('load failed')); };
        img.src = url;
      });
      return shrunk;
    } catch (e) {
      // Anything odd (unsupported format, canvas blocked) — fall back to raw bytes.
      return raw();
    }
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
    state.scanTime = s.time || ''; // carried through to save, for repeat-charge matching
  }

  function currentReceipt() {
    return el.receiptInput.files[0] || el.receiptCamera.files[0];
  }

  // ---------- "Write it for me" (AI description helper) ----------
  // For hand-entered expenses with no receipt to read: Claude proposes three
  // short descriptions from whatever's filled in, and you tap the one you like.

  function updateDescribeBtn() {
    const btn = $('#describe-btn');
    if (!btn) return;
    const on = !!(state.config && state.config.aiEnabled) && state.expenseType !== 'mileage';
    btn.hidden = !on;
    if (!on) { const box = $('#describe-options'); if (box) { box.hidden = true; box.innerHTML = ''; } }
  }

  function accountLabel() {
    const sel = $('#f-account');
    const opt = sel && sel.options[sel.selectedIndex];
    return opt && opt.value ? opt.textContent : '';
  }

  function describeBody(extra) {
    return Object.assign({
      merchant: $('#f-business').value.trim(),
      amount: parseFloat($('#f-amount').value) || undefined,
      currency: $('#f-currency').value,
      account: accountLabel(),
      hint: $('#f-description').value.trim(),
      date: $('#f-date').value,
    }, extra || {});
  }

  function renderDescribeChips(remembered, options) {
    const box = $('#describe-options');
    if (!box) return;
    const chips = [];
    (remembered || []).forEach((o) => chips.push(`<button type="button" class="describe-chip remembered" data-desc="${escapeHtml(o)}">↺ ${escapeHtml(o)}</button>`));
    (options || []).forEach((o) => chips.push(`<button type="button" class="describe-chip" data-desc="${escapeHtml(o)}">✨ ${escapeHtml(o)}</button>`));
    if (!chips.length) { box.hidden = true; box.innerHTML = ''; return; }
    const cap = remembered && remembered.length
      ? (options && options.length ? 'You’ve used these here before — or try a new one:' : 'You’ve used these here before — tap one:')
      : 'Tap one to use it:';
    box.innerHTML = `<div class="describe-cap">${cap}</div>${chips.join('')}`;
    box.hidden = false;
  }

  // Tracks the latest description request so a slow background recall can't
  // overwrite a fuller result the person just asked for with the ✨ button.
  let describeSeq = 0;

  // Auto-memory: when the merchant is filled in, quietly bring back the
  // descriptions this person has used there before. No AI, no button.
  async function recallDescriptions() {
    if (state.editingId || state.expenseType === 'mileage') return;
    const merchant = $('#f-business').value.trim();
    if (!merchant || $('#f-description').value.trim()) return; // don't override what they typed
    const seq = ++describeSeq;
    try {
      const res = await api('suggest-description', { method: 'POST', body: describeBody({ recallOnly: true }) });
      if (seq !== describeSeq) return; // a newer request has taken over
      if (res && res.remembered && res.remembered.length) renderDescribeChips(res.remembered, []);
    } catch (e) { /* memory is a nicety — never interrupt */ }
  }

  // The ✨ button: memory first, then Claude fills in fresh ideas.
  async function suggestDescription() {
    const btn = $('#describe-btn');
    const body = describeBody();
    if (!body.merchant && !body.hint && !body.account) {
      return toast('Add where you spent it (or a couple of words) first.', 'bad');
    }
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = '✨ Thinking…';
    const seq = ++describeSeq;
    try {
      const res = await api('suggest-description', { method: 'POST', body });
      if (seq !== describeSeq) return; // superseded by a newer request
      const remembered = (res && res.remembered) || [];
      const options = (res && res.options) || [];
      if (!remembered.length && !options.length) { toast('Couldn’t think of one — try adding a bit more detail.', 'bad'); return; }
      renderDescribeChips(remembered, options);
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  function onDescribeOptionClick(event) {
    const chip = event.target.closest('.describe-chip');
    if (!chip) return;
    $('#f-description').value = chip.getAttribute('data-desc');
    const box = $('#describe-options');
    box.hidden = true;
    box.innerHTML = '';
    toast('Description filled in — tweak it if you like.', 'good');
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
      const result = await api('scan-receipt', {
        method: 'POST',
        body: { receipt: await prepareReceipt(file) },
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

    const editing = !!state.editingId;
    const mileageMode = !editing && state.expenseType === 'mileage';
    const account = $('#f-account').value;
    const date = $('#f-date').value;
    const description = $('#f-description').value.trim();
    const merchant = $('#f-business').value.trim();
    const file = currentReceipt();

    let body;
    if (mileageMode) {
      const rate = selectedRate();
      const distance = parseFloat($('#f-distance').value);
      if (!rate) return toast('Pick a mileage rate.', 'bad');
      if (!(distance > 0)) return toast('Enter the distance you drove.', 'bad');
      if (!date) return toast('Pick the date.', 'bad');
      if (!account) return toast('Choose the account to charge this to.', 'bad');
      body = { mileage: { distance, rateId: rate.id }, account, date, description, merchant };
    } else {
      const amount = parseFloat($('#f-amount').value);
      const currency = $('#f-currency').value;
      if (!description) return toast('Add a short description.', 'bad');
      if (!(amount > 0)) return toast('Amount must be greater than zero.', 'bad');
      if (!date) return toast('Pick the date of the expense.', 'bad');
      if (!account) return toast('Choose the account to charge this to.', 'bad');
      body = { amount, currency, account, date, description, merchant };
    }

    // A brand-new expense can go straight into a report (then it waits there,
    // Unsubmitted, until the report is submitted).
    const reportId = !editing ? ($('#f-report') && $('#f-report').value) : '';
    if (reportId && reportId !== '__new__') body.reportId = reportId;
    if (!editing && state.scanTime) body.time = state.scanTime; // time read off the photo

    el.submitBtn.disabled = true;
    el.submitBtn.textContent = editing ? 'Saving…' : 'Submitting…';

    try {
      if (file) {
        body.receipt = await prepareReceipt(file);
      }
      if (editing) body.id = state.editingId;

      const result = await api(editing ? 'update-expense' : 'submit-expense', { method: 'POST', body });

      bumpAccountUsage(account); // learn this person's go-to accounts
      cancelEdit(); // resets form, date, labels, banner, editingId
      populateAccounts(); // re-sort with the freshly used account near the top

      if (editing) {
        toast(result.resubmitted ? 'Saved and resubmitted for approval.' : 'Changes saved.', 'good');
      } else if (result.warning) {
        toast(result.warning, 'bad');
      } else if (body.reportId) {
        toast('Added to your report — submit the report when you’re ready.', 'good');
      } else {
        toast('Expense submitted 🎉', 'good');
      }

      state.loaded.mine = false;
      state.loaded.audit = false;
      state.loaded.approvals = false;
      // After adding, stay on Add expense so they can add more and see the list;
      // after an edit, go back to exactly where they started (the Add-expense
      // list, or Audit) — the saved expense drops back into its report there.
      const back = editing ? (state.editReturn || 'mine') : 'submit';
      state.editReturn = null;
      setAddFormOpen(false); // collapse back to the small header after saving
      switchView(back);
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      el.submitBtn.disabled = false;
      el.submitBtn.textContent = state.editingId ? 'Save changes' : 'Submit expense';
    }
  }

  // The "New expense" form is collapsed by default so the expense list shows
  // right below it; tapping the header opens it to add (or edit) one.
  function setAddFormOpen(open) {
    const body = $('#add-form-body');
    const toggle = $('#add-toggle');
    if (!body || !toggle) return;
    body.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.classList.toggle('open', open);
    toggle.classList.toggle('active', open);
    if (open) setImportOpen(false); // only one of the two panels open at a time
  }

  // The Import panel sits beside "New expense"; opening it folds the form away
  // (its contents are kept, not cleared) and vice-versa.
  function setImportOpen(open) {
    const body = $('#import-body');
    const toggle = $('#import-toggle');
    if (!body || !toggle) return;
    body.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.classList.toggle('open', open);
    toggle.classList.toggle('active', open);
    if (open) setAddFormOpen(false);
  }
  // Has the person typed anything into the new-expense form yet?
  function formHasAnyInput() {
    if ($('#f-amount').value.trim()) return true;
    if ($('#f-description').value.trim()) return true;
    if ($('#f-business').value.trim()) return true;
    if ($('#f-distance') && $('#f-distance').value.trim()) return true;
    if ($('#f-account').value) return true;
    if (currentReceipt()) return true;
    return false;
  }

  function submitForm() {
    if (el.form.requestSubmit) el.form.requestSubmit();
    else el.form.dispatchEvent(new Event('submit', { cancelable: true }));
  }

  // Tapping the header opens the form; tapping it while open "clicks out":
  //  - editing, or a new expense you've started → try to save it. onSubmit
  //    validates: if it's complete it saves and folds away; if something's
  //    still missing it STAYS OPEN and says what's needed — a started expense
  //    never just vanishes, it sits here until it's done.
  //  - a form you never touched → simply fold away.
  function toggleAddForm() {
    const body = $('#add-form-body');
    if (body && body.hidden) { setAddFormOpen(true); return; }
    if (state.editingId || formHasAnyInput()) { submitForm(); return; }
    setAddFormOpen(false);
  }

  // ---------- Edit / delete ----------

  function startEdit(id) {
    // Find the expense in whichever list we're looking at — your own, or (for
    // Finance/approvers) the Audit list — so anyone with rights can edit it.
    const e = (state.mineExpenses || []).find((x) => x.id === id)
      || (state.auditItems || []).find((x) => x.id === id);
    if (!e) return;
    state.editingId = id;
    state.editReturn = state.view; // come back to the screen you started from
    // Edits are always in receipt/amount mode (you adjust the amount directly),
    // even for a mileage expense. The type toggle is hidden while editing.
    setExpenseType('receipt');
    $('.type-toggle').hidden = true;
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
    setAddFormOpen(true); // editing always opens the form
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    state.editingId = null;
    state.scanTime = '';
    el.form.reset();
    $('#f-date').value = new Date().toISOString().slice(0, 10);
    el.receiptName.textContent = '';
    $('#submit-title').textContent = 'New expense';
    el.submitBtn.textContent = 'Submit expense';
    $('#edit-banner').hidden = true;
    $('.type-toggle').hidden = false;
    $('#mileage-calc').hidden = true;
    setExpenseType('receipt');
  }

  async function deleteExpense(id, onDone) {
    try {
      await api('delete-expense', { method: 'POST', body: { id } });
      toast('Expense deleted.', 'good');
      if (onDone) onDone();
    } catch (e) {
      toast(e.message, 'bad');
    }
  }

  // Ask "are you sure?" right where the Delete button is, instead of a browser
  // pop-up at the top of the screen. Swaps the button for a small confirm row.
  function requestDelete(btn, id, onDone) {
    if (!btn) return deleteExpense(id, onDone);
    const holder = document.createElement('span');
    holder.className = 'confirm-inline';
    holder.innerHTML = `<span class="confirm-q">Delete — sure?</span>`
      + `<button type="button" class="btn danger small" data-confirm="yes">Yes, delete</button>`
      + `<button type="button" class="link-btn" data-confirm="no">Keep it</button>`;
    btn.replaceWith(holder);
    holder.querySelector('[data-confirm="yes"]').addEventListener('click', () => deleteExpense(id, onDone));
    holder.querySelector('[data-confirm="no"]').addEventListener('click', () => holder.replaceWith(btn));
  }

  // Handle a click on an expense card (used by both the Add-expense list and the
  // expenses inside a report). Returns true if it handled the click.
  function onExpenseCardClick(event) {
    // Tapping a suggested-description chip in the inline editor fills it in.
    const chip = event.target.closest('.ie-describe-options .describe-chip');
    if (chip) {
      const details = chip.closest('.mini-details');
      const input = details && $('.ie-description', details);
      if (input) input.value = chip.getAttribute('data-desc');
      const box = chip.closest('.ie-describe-options');
      if (box) { box.hidden = true; box.innerHTML = ''; }
      return true;
    }
    const btn = event.target.closest('button[data-act]');
    if (!btn) return false;
    const act = btn.dataset.act;
    if (act === 'ie-receipt-choose' || act === 'ie-receipt-camera') {
      const details = btn.closest('.mini-details');
      const input = details && $('.ie-receipt-input', details);
      if (input) {
        // Same hidden input drives both buttons. "Take a picture" asks the phone
        // to open its camera; "Add a receipt" is the normal file/photo picker.
        if (act === 'ie-receipt-camera') {
          input.setAttribute('accept', 'image/*');
          input.setAttribute('capture', 'environment');
        } else {
          input.setAttribute('accept', 'image/*,application/pdf');
          input.removeAttribute('capture');
        }
        input.click();
      }
      return true;
    }
    if (act === 'toggle') {
      const card = btn.closest('.expense');
      if (!card) return false;
      const id = card.dataset.id;
      const details = $('.mini-details', card);
      if (details.hasAttribute('hidden')) {
        buildInlineEdit(details, id); // open straight into the editable fields
        details.removeAttribute('hidden');
        btn.setAttribute('aria-expanded', 'true');
        card.classList.add('open');
      } else {
        collapseInlineEdit(card, id, details, btn); // closing saves what changed
      }
      return true;
    }
    if (act === 'ie-save') {
      const card = btn.closest('.expense');
      if (!card) return false;
      collapseInlineEdit(card, card.dataset.id, $('.mini-details', card), $('.mini-row', card));
      return true;
    }
    if (act === 'delete') {
      requestDelete(btn, btn.dataset.id, () => refreshExpenseViews());
      return true;
    }
    if (act === 'ie-missing') {
      openAffidavitModal(btn.dataset.id);
      return true;
    }
    if (act === 'ie-receipt-remove') {
      removeReceipt(btn.dataset.id);
      return true;
    }
    return false;
  }

  // Take the (wrong) receipt off an expense, keeping the editor open so the
  // right one can be added straight away.
  async function removeReceipt(id) {
    try {
      await api('update-expense', { method: 'POST', body: { id, removeReceipt: true } });
      const e = (state.mineExpenses || []).find((x) => x.id === id);
      if (e) { e.receipt = null; e.originalAmount = null; e.originalCurrency = ''; }
      toast('Receipt removed — add the right one below.', 'good');
      const card = document.querySelector(`.expense[data-id="${id}"]`);
      const details = card && $('.mini-details', card);
      if (details && !details.hasAttribute('hidden')) buildInlineEdit(details, id);
    } catch (err) {
      toast(err.message, 'bad');
    }
  }

  function onAddListClick(event) { onExpenseCardClick(event); }

  // When you open an expense whose description is just the merchant name copied
  // over (common for imported rows), quietly offer better ones — the descriptions
  // you've used at that merchant before, or a few fresh AI suggestions if none.
  // No button: they just appear, and you tap the one you want.
  const normStr = (s) => String(s == null ? '' : s).trim().toLowerCase();
  async function maybeSuggestDescription(details, e) {
    if (!(state.config && state.config.aiEnabled)) return;
    const desc = normStr(e.description);
    const weak = !desc || desc === normStr(e.merchant) || (e.account && desc === normStr(e.account));
    if (!weak) return; // already has a real description — leave it alone
    const box = $('.ie-describe-options', details);
    if (!box) return;
    box.hidden = false;
    box.innerHTML = `<div class="describe-cap">💭 finding a better description…</div>`;
    try {
      const res = await api('suggest-description', { method: 'POST', body: {
        merchant: (e.merchant || '').trim(),
        amount: e.amount != null ? e.amount : undefined,
        currency: e.currency || 'USD',
        account: e.account || '',
        date: e.date || '',
      } });
      const remembered = (res && res.remembered) || [];
      const options = (res && res.options) || [];
      if (!remembered.length && !options.length) { box.hidden = true; box.innerHTML = ''; return; }
      const chips = [];
      remembered.forEach((o) => chips.push(`<button type="button" class="describe-chip remembered" data-desc="${escapeHtml(o)}">↺ ${escapeHtml(o)}</button>`));
      options.forEach((o) => chips.push(`<button type="button" class="describe-chip" data-desc="${escapeHtml(o)}">✨ ${escapeHtml(o)}</button>`));
      const cap = remembered.length ? 'You’ve used these here before — tap one:' : 'Pick a better description:';
      box.innerHTML = `<div class="describe-cap">${cap}</div>${chips.join('')}`;
    } catch (err) {
      box.hidden = true; box.innerHTML = '';
    }
  }

  // The only report-picker change we act on immediately is "＋ New report" —
  // it creates the report and selects it. Picking an existing report is saved
  // when the line is closed (together with any field edits), so nothing is lost.
  async function onAddListChange(event) {
    // A receipt was picked in the inline editor — show its name; it attaches on Save.
    const fileInput = event.target.closest('.ie-receipt-input');
    if (fileInput) {
      const details = fileInput.closest('.mini-details');
      const name = details && $('.ie-receipt-name', details);
      const f = fileInput.files && fileInput.files[0];
      if (name) name.textContent = f ? `${f.name} — attaches when you Save` : '';
      return;
    }
    const sel = event.target.closest('select[data-role="report-pick"]');
    if (!sel || sel.value !== '__new__') return;
    const name = (window.prompt('Name the new report (e.g. “General Fund – July”):') || '').trim();
    if (!name) { sel.value = ''; return; }
    try {
      const made = await api('reports', { method: 'POST', body: { action: 'create', name } });
      await ensureReportsData(true);
      populateReportPicker();
      const opt = document.createElement('option');
      opt.value = made.report.id;
      opt.textContent = made.report.name;
      sel.insertBefore(opt, sel.querySelector('option[value="__new__"]'));
      sel.value = made.report.id;
      toast('Report created — it’ll be filed here when you close this line.', 'good');
    } catch (e) { toast(e.message, 'bad'); sel.value = ''; }
  }

  async function createReportPrompt() {
    const name = (window.prompt('Name this report (e.g. “General Fund – July”):') || '').trim();
    if (!name) return;
    try {
      await api('reports', { method: 'POST', body: { action: 'create', name } });
      toast('Report created — now add expenses to it.', 'good');
      invalidateReports();
      await ensureReportsData(true);
      populateReportPicker();
      renderReports();
    } catch (e) { toast(e.message, 'bad'); }
  }

  // Clicks inside the "My reports" list.
  function onReportsClick(event) {
    if (onExpenseCardClick(event)) return; // an expense card inside a report
    const btn = event.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    if (act === 'report-toggle') {
      const card = btn.closest('.report-card');
      const body = $('.rc-body', card);
      const open = body.hasAttribute('hidden');
      body.toggleAttribute('hidden', !open);
      card.classList.toggle('open', open);
      return;
    }
    const id = btn.dataset.id;
    if (act === 'report-submit') submitReport(id, btn);
    else if (act === 'report-rename') renameReportUi(id);
    else if (act === 'report-delete') deleteReportUi(id);
  }

  async function submitReport(id, btn) {
    const roll = reportRollup(id);
    const n = roll.counts.unsubmitted;
    if (!n) return;
    if (!window.confirm(`Submit this report — ${n} expense${n === 1 ? '' : 's'} — for approval?`)) return;
    if (btn) btn.disabled = true;
    try {
      const res = await api('reports', { method: 'POST', body: { action: 'submit', id } });
      toast(`Submitted ${res.submitted} expense${res.submitted === 1 ? '' : 's'} for approval 🎉`, 'good');
      state.loaded.approvals = false; state.loaded.audit = false; state.loaded.dashboard = false;
      invalidateReports();
      await ensureReportsData(true);
      renderReports();
    } catch (e) {
      if (btn) btn.disabled = false;
      toast(e.message, 'bad');
    }
  }

  async function renameReportUi(id) {
    const rep = (state.reports || []).find((r) => r.id === id);
    const name = (window.prompt('Rename this report:', rep ? rep.name : '') || '').trim();
    if (!name) return;
    try {
      await api('reports', { method: 'POST', body: { action: 'rename', id, name } });
      invalidateReports();
      await ensureReportsData(true);
      populateReportPicker();
      renderReports();
    } catch (e) { toast(e.message, 'bad'); }
  }

  async function deleteReportUi(id) {
    if (!window.confirm('Delete this empty report?')) return;
    try {
      await api('reports', { method: 'POST', body: { action: 'delete', id } });
      toast('Report deleted.', 'good');
      invalidateReports();
      await ensureReportsData(true);
      populateReportPicker();
      renderReports();
    } catch (e) { toast(e.message, 'bad'); }
  }

  function invalidateReports() {
    state.loaded.mine = false;
    state.loaded.audit = false;
  }

  // ---------- My expenses ----------

  // The words people see for each stage. The stored status is unchanged — this
  // only relabels it, so the workflow keeps running exactly the same underneath.
  const STATUS_LABELS = {
    draft: 'Unsubmitted',
    submitted: 'Pending approval',
    approved: 'Pending payment',
    rejected: 'Denied',
    reimbursed: 'Paid',
  };
  function statusKey(status) {
    const key = String(status || '').toLowerCase().replace(/[^a-z]/g, '');
    return ['draft', 'submitted', 'approved', 'rejected', 'reimbursed'].includes(key) ? key : 'submitted';
  }
  function statusLabel(status) {
    return STATUS_LABELS[statusKey(status)];
  }

  function statusBadge(status) {
    const cls = statusKey(status);
    return `<span class="badge ${cls}">${escapeHtml(statusLabel(status))}</span>`;
  }

  function statusDot(status) {
    const cls = statusKey(status);
    return `<span class="dot ${cls}" title="${escapeHtml(statusLabel(status))}"></span>`;
  }

  // How the expense got into Rembly. The colored dot on each row means *source*
  // (where it came from) — that's what Mel reads at a glance. [emoji, words, colorKey]
  const SOURCE_META = {
    YNAB: ['📊', 'Imported from YNAB', 'ynab'],
    Email: ['📧', 'Imported from email', 'email'],
    Photo: ['📷', 'Taken by a picture', 'photo'],
    Manual: ['✍️', 'Entered by hand', 'manual'],
    CSV: ['📄', 'Imported from a file', 'csv'],
  };
  function sourceBadge(src) {
    const meta = SOURCE_META[src] || SOURCE_META.Manual;
    return `<span class="src-badge src-${meta[2]}">${meta[0]} ${escapeHtml(meta[1])}</span>`;
  }
  // The colored dot on a row: its color tells you the source.
  function sourceDot(src) {
    const meta = SOURCE_META[src] || SOURCE_META.Manual;
    return `<span class="dot src-${meta[2]}" title="${escapeHtml(meta[1])}"></span>`;
  }

  function receiptLink(expense) {
    if (!expense.receipt || !expense.receipt.url) return '';
    return `<a class="receipt-link" href="${escapeHtml(expense.receipt.url)}" target="_blank" rel="noopener">📎 Receipt</a>`;
  }

  // A "History" toggle for any expense card. The trail loads lazily on click.
  function historyBtn(id) {
    return `<button class="link-btn" data-act="history" data-id="${escapeHtml(id)}">History</button>`;
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

  // ----- Reports data (shared by the Add-expense list and My-reports view) -----

  async function ensureReportsData(force) {
    if (state.loaded.mine && !force) return;
    const [rep, mine] = await Promise.all([api('reports'), api('my-expenses')]);
    state.reports = rep.reports || [];
    state.mineExpenses = mine.expenses || [];
    state.loaded.mine = true;
  }

  // The "which report?" dropdown, shared by the form and each list row.
  function reportSelectHtml(currentId, dataAttrs) {
    const opts = ['<option value="">— Not in a report —</option>']
      .concat((state.reports || []).map((r) => `<option value="${escapeHtml(r.id)}"${r.id === currentId ? ' selected' : ''}>${escapeHtml(r.name)}</option>`))
      .concat('<option value="__new__">＋ New report…</option>');
    return `<select class="report-pick" ${dataAttrs || ''}>${opts.join('')}</select>`;
  }

  function populateReportPicker() {
    const sel = $('#f-report');
    if (!sel) return;
    const keep = sel.value;
    sel.innerHTML = reportSelectHtml(keep).replace(/^<select[^>]*>|<\/select>$/g, '');
  }

  // Choosing "＋ New report…" on the add form creates one on the spot.
  async function onFormReportChange(event) {
    const sel = event.target;
    if (sel.value !== '__new__') return;
    const name = (window.prompt('Name the new report (e.g. “General Fund – July”):') || '').trim();
    if (!name) { sel.value = ''; return; }
    try {
      const made = await api('reports', { method: 'POST', body: { action: 'create', name } });
      invalidateReports();
      await ensureReportsData(true);
      populateReportPicker();
      sel.value = made.report.id;
      renderAddList();
    } catch (e) { toast(e.message, 'bad'); sel.value = ''; }
  }

  // ----- Add-expense tab: expenses not yet filed into a report -----

  // The amount in US dollars, used for the "over $50" rule and cost sorting.
  const RECEIPT_THRESHOLD = 50;
  function usdAmount(e) {
    return Number(e.amountUsd != null ? e.amountUsd : e.amount) || 0;
  }

  // Foreign-currency breakdown for an expense, or null if it's plainly in USD.
  // Prefers the foreign amount read off the receipt (when the bank charged USD);
  // otherwise a manually-entered foreign expense uses its own amount/currency.
  // The rate is USD ÷ foreign — i.e. what your bank actually gave you.
  function fxInfo(e) {
    let amount = null;
    let currency = '';
    if (e.originalAmount != null && e.originalCurrency) {
      amount = Number(e.originalAmount); currency = String(e.originalCurrency);
    } else if (e.currency && e.currency.toUpperCase() !== 'USD' && e.amount != null) {
      amount = Number(e.amount); currency = e.currency;
    }
    if (!(amount > 0) || !currency || currency.toUpperCase() === 'USD') return null;
    const usd = e.amountUsd != null ? Number(e.amountUsd) : null;
    const rate = usd != null && usd > 0 ? usd / amount : null;
    return { amount, currency, usd, rate };
  }
  // In a pooled household, tag each row with the submitter's first name when it
  // isn't the person looking — so Mel can tell his expenses from Amy's.
  function firstNameOf(name) {
    return String(name || '').trim().split(/\s+/)[0] || '';
  }
  function submitterTag(e) {
    const meEmail = ((state.me && state.me.email) || '').toLowerCase();
    const who = (e.submitterEmail || '').toLowerCase();
    if (!who || who === meEmail || !e.submitterName) return '';
    return `<span class="mini-who-tag" title="${escapeHtml(e.submitterEmail)}">${escapeHtml(firstNameOf(e.submitterName))}</span>`;
  }

  // "1 PLN = $0.2463" — how many dollars one unit of the foreign currency cost.
  function fxRateText(fx) {
    if (!fx || fx.rate == null) return '';
    const digits = fx.rate < 0.1 ? 4 : (fx.rate < 1 ? 3 : 2);
    return `1 ${fx.currency.toUpperCase()} = $${fx.rate.toFixed(digits)}`;
  }

  // Missing-receipt affidavit: the signed declaration shown read-only in the editor.
  function affidavitStatusMeta(status) {
    const s = String(status || 'Pending');
    if (s === 'Approved') return ['ok', 'Approved'];
    if (s === 'Denied') return ['bad', 'Denied — please add a receipt'];
    return ['pending', 'Pending approval'];
  }
  function affidavitLine(e) {
    const [cls, label] = affidavitStatusMeta(e.affidavitStatus);
    const signed = e.affidavitSignedBy
      ? `Signed by ${escapeHtml(e.affidavitSignedBy)}${e.affidavitSignedOn ? ` on ${escapeHtml(fmtDate(e.affidavitSignedOn))}` : ''}. `
      : '';
    return `<div class="ie-affidavit aff-${cls}">
      <span class="aff-title">🖊️ No-receipt declaration · ${escapeHtml(label)}</span>
      <span class="aff-body">${signed}${e.affidavitReason ? `“${escapeHtml(e.affidavitReason)}”` : ''}</span>
    </div>`;
  }

  // One collapsed expense row that opens into the inline editor. Shared by the
  // Add-expense list and the expenses inside each report card. Expenses over $50
  // are highlighted (those are the ones that need a receipt); if one over $50 is
  // still missing its receipt, it's flagged harder.
  function expenseRowHtml(e) {
    const who = e.merchant || e.description || '(no description)';
    const amt = e.amountUsd != null ? money(e.amountUsd, 'USD') : money(e.amount, e.currency);
    const over = usdAmount(e) >= RECEIPT_THRESHOLD;
    const needsReceipt = over && !e.receipt && !e.missingReceipt;
    const cls = `expense mini${over ? ' over50' : ''}${needsReceipt ? ' needs-receipt' : ''}`;
    // For a foreign expense, stack the bank USD over the original amount + rate.
    const fx = fxInfo(e);
    const amtCell = fx
      ? `<span class="mini-amt has-fx"><span class="ma-usd">${escapeHtml(fx.usd != null ? money(fx.usd, 'USD') : money(fx.amount, fx.currency))}</span><span class="ma-fx">${escapeHtml(money(fx.amount, fx.currency))}${fx.rate != null ? ` · ${escapeHtml(fxRateText(fx))}` : ''}</span></span>`
      : `<span class="mini-amt">${escapeHtml(amt)}</span>`;
    return `
      <article class="${cls}" data-id="${escapeHtml(e.id)}">
        <button type="button" class="mini-row" data-act="toggle" aria-expanded="false">
          <span class="mini-date">${escapeHtml(fmtDateShort(e.date))}</span>
          <span class="mini-who">${escapeHtml(who)}</span>
          ${submitterTag(e)}
          ${amtCell}
          ${e.receipt ? '<span class="mini-clip" title="Has a receipt">📎</span>' : ''}
          ${e.missingReceipt ? `<span class="mini-clip" title="No-receipt declaration (${escapeHtml(e.affidavitStatus || 'Pending')})">🖊️</span>` : ''}
          ${needsReceipt ? '<span class="mini-need" title="Over $50 and no receipt yet">needs receipt</span>' : ''}
          ${sourceDot(e.source)}
          <span class="mini-caret" aria-hidden="true">▾</span>
        </button>
        <div class="mini-details" hidden></div>
      </article>`;
  }

  // Sort a list of expenses by the chosen column (date / description / cost),
  // ascending, then flip it if the direction is descending. Used by the "Not in
  // a report yet" list and the expenses inside each report.
  const SORT_LABELS = { date: 'Date', desc: 'Description', amt: 'Cost' };
  function sortExpenses(list) {
    const arr = list.slice();
    const who = (e) => (e.merchant || e.description || '').toLowerCase();
    const amt = (e) => Number(e.amountUsd != null ? e.amountUsd : e.amount) || 0;
    const date = (e) => String(e.date || '');
    let cmp;
    if (state.sortKey === 'desc') cmp = (a, b) => who(a).localeCompare(who(b));
    else if (state.sortKey === 'amt') cmp = (a, b) => amt(a) - amt(b);
    else cmp = (a, b) => date(a).localeCompare(date(b));
    arr.sort(cmp);
    if (state.sortDir === 'desc') arr.reverse();
    return arr;
  }

  // Reflect the current sort on the Date / Description / Cost headers (which is
  // active, and an ↑/↓ arrow for the direction).
  function updateSortHeader() {
    $$('#add-sort .sort-col').forEach((b) => {
      const key = b.dataset.sort;
      const active = key === state.sortKey;
      b.classList.toggle('active', active);
      b.textContent = SORT_LABELS[key] + (active ? (state.sortDir === 'asc' ? ' ↑' : ' ↓') : '');
    });
  }

  // Clicking a header sorts by it (A→Z); clicking the active one flips A→Z / Z→A.
  function onSortClick(event) {
    const col = event.target.closest('.sort-col');
    if (!col) return;
    const key = col.dataset.sort;
    if (key === state.sortKey) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    else { state.sortKey = key; state.sortDir = 'asc'; }
    updateSortHeader();
    renderAddList();
    renderReports();
  }

  function renderAddList() {
    const box = el.addList;
    if (!box) return;
    // Only expenses not yet in a report — once you file one it moves to that
    // report (and shows under "My reports").
    const unfiled = sortExpenses((state.mineExpenses || []).filter((e) => !e.reportId));
    renderReceiptSummary(unfiled);
    if (!unfiled.length) {
      box.innerHTML = `<div class="state"><span class="emoji">✅</span>Nothing loose here — every expense is filed into a report. Add a new one above, or see them under “My reports.”</div>`;
      return;
    }
    box.innerHTML = unfiled.map(expenseRowHtml).join('');
  }

  // A little scoreboard for the expenses that actually need a receipt (over $50):
  // how many have one and how many still don't.
  function renderReceiptSummary(list) {
    const box = $('#over50-summary');
    if (!box) return;
    const over = list.filter((e) => usdAmount(e) >= RECEIPT_THRESHOLD);
    if (!over.length) { box.hidden = true; box.innerHTML = ''; return; }
    // "Covered" means it has a receipt OR a signed no-receipt declaration.
    const withR = over.filter((e) => e.receipt || e.missingReceipt).length;
    const without = over.length - withR;
    box.hidden = false;
    box.classList.toggle('all-done', without === 0);
    if (without === 0) {
      box.innerHTML = `<span class="rs-icon">🎉</span><span>All <strong>${over.length}</strong> expense${over.length === 1 ? '' : 's'} over $${RECEIPT_THRESHOLD} are covered.</span>`;
    } else {
      box.innerHTML = `<span class="rs-icon">🧾</span><span>Over $${RECEIPT_THRESHOLD}: <strong class="rs-have">${withR}</strong> covered · <strong class="rs-need">${without}</strong> still ${without === 1 ? 'needs a receipt' : 'need a receipt'}.</span>`;
    }
  }

  // Reload the expense data and re-render both places it shows (the Add-expense
  // list and the report cards) plus the duplicates panel, so everything stays
  // in step after an edit, a report change, or a delete.
  async function refreshExpenseViews() {
    invalidateReports();
    try { await ensureReportsData(true); } catch (e) { /* keep going */ }
    populateReportPicker();
    renderAddList();
    renderReports();
    loadDuplicates();
  }

  // Currencies offered in the inline editor (kept in step with the form).
  const CURRENCIES = ['USD', 'EUR', 'CZK', 'PLN', 'GBP', 'RON', 'HUF', 'BGN', 'RSD', 'UAH'];

  function ieAccountOptions(selected) {
    const opt = (a) => `<option value="${escapeHtml(a.code)}"${a.code === selected ? ' selected' : ''}>${escapeHtml(a.code)} – ${escapeHtml(a.name)}</option>`;
    return `<option value="">Choose account…</option>${(state.accounts || []).map(opt).join('')}`;
  }
  function ieCurrencyOptions(selected) {
    return CURRENCIES.map((c) => `<option${c === (selected || 'USD') ? ' selected' : ''}>${c}</option>`).join('');
  }

  // Tapping an expense opens it straight into editable fields — no extra "Edit"
  // step. Closing the line saves whatever changed.
  function inlineEditHtml(e) {
    const fx = fxInfo(e);
    const fxLine = fx ? `
        <div class="ie-fx">
          <span class="ie-fx-title">Foreign currency</span>
          <span class="ie-fx-body">Receipt: <strong>${escapeHtml(money(fx.amount, fx.currency))}</strong>${fx.usd != null ? ` · Charged in USD: <strong>${escapeHtml(money(fx.usd, 'USD'))}</strong>` : ''}${fx.rate != null ? ` · Rate: <strong>${escapeHtml(fxRateText(fx))}</strong>` : ''}</span>
        </div>` : '';
    return `
      <div class="inline-edit">
        <div class="mini-badges">${statusBadge(e.status)}${sourceBadge(e.source)}</div>
        ${fxLine}
        <div class="ie-row">
          <label class="ie-f"><span>Amount</span><input class="ie-amount" type="number" inputmode="decimal" step="0.01" min="0" value="${e.amount != null ? e.amount : ''}" /></label>
          <label class="ie-f ie-cur"><span>Currency</span><select class="ie-currency">${ieCurrencyOptions(e.currency)}</select></label>
        </div>
        <label class="ie-f"><span>Account</span><select class="ie-account">${ieAccountOptions(e.accountCode)}</select></label>
        <label class="ie-f"><span>Date</span><input class="ie-date" type="date" value="${escapeHtml(e.date || '')}" /></label>
        <label class="ie-f"><span>Where (business)</span><input class="ie-business" type="text" maxlength="80" value="${escapeHtml(e.merchant || '')}" /></label>
        <label class="ie-f">
          <span>Description</span>
          <input class="ie-description" type="text" maxlength="120" value="${escapeHtml(e.description || '')}" />
          <div class="ie-describe-options describe-options" hidden></div>
        </label>
        <label class="report-row"><span>Report</span>${reportSelectHtml(e.reportId, `data-role="report-pick" data-id="${escapeHtml(e.id)}"`)}</label>
        <div class="ie-f">
          <span>Receipt</span>
          <div class="ie-receipt">
            ${e.receipt && e.receipt.url
              ? `<a class="receipt-link" href="${escapeHtml(e.receipt.url)}" target="_blank" rel="noopener">📎 View receipt</a>
                 <button type="button" class="btn ghost small ie-remove" data-act="ie-receipt-remove" data-id="${escapeHtml(e.id)}">🗑️ Remove receipt</button>`
              : (e.missingReceipt ? '' : '<span class="ie-noreceipt">No receipt yet</span>')}
            <button type="button" class="btn ghost small" data-act="ie-receipt-camera">📷 ${e.receipt ? 'Replace with a picture' : 'Take a picture'}</button>
            <button type="button" class="btn ghost small" data-act="ie-receipt-choose">📎 ${e.receipt ? 'Replace with a file' : 'Add a receipt'}</button>
            ${!e.receipt ? `<button type="button" class="btn ghost small" data-act="ie-missing" data-id="${escapeHtml(e.id)}">🖊️ ${e.missingReceipt ? 'Re-sign declaration' : 'No receipt? Declare it'}</button>` : ''}
            <input type="file" class="ie-receipt-input" accept="image/*,application/pdf" hidden />
            <span class="ie-receipt-name file-hint"></span>
          </div>
          ${e.missingReceipt ? affidavitLine(e) : ''}
        </div>
        <div class="expense-actions">
          <button class="btn primary small" data-act="ie-save" data-id="${escapeHtml(e.id)}">Save</button>
          ${historyBtn(e.id)}
          <button class="link-btn danger" data-act="delete" data-id="${escapeHtml(e.id)}">Delete</button>
        </div>
        ${e.status === 'Rejected' && e.notes ? `<div class="expense-note">↩︎ ${escapeHtml(e.notes)}</div>` : ''}
        <div class="ie-hint">Save files it into the report you picked and closes it. (Tapping the line above closes it too.)</div>
      </div>`;
  }

  // Read-only details for an expense that can no longer be edited (approved/paid).
  function readOnlyDetailsHtml(e) {
    return `
      <div class="mini-badges">${statusBadge(e.status)}${sourceBadge(e.source)}</div>
      <div class="mini-desc">${cardTitle(e)}</div>
      <div class="expense-meta">${cardMeta(e, [e.account || e.category, fmtDate(e.date)])}</div>
      ${e.reportName ? `<div class="expense-meta">🗂️ ${escapeHtml(e.reportName)}</div>` : ''}
      <div class="expense-actions">${receiptLink(e)}${historyBtn(e.id)}</div>`;
  }

  function buildInlineEdit(details, id) {
    const e = (state.mineExpenses || []).find((x) => x.id === id);
    if (!e) { details.innerHTML = ''; return; }
    if (EDITABLE.includes(e.status)) {
      details.innerHTML = inlineEditHtml(e);
      maybeSuggestDescription(details, e); // auto-offer a better description if it's weak
    } else {
      details.innerHTML = readOnlyDetailsHtml(e);
    }
  }

  // Save the inline edits for one expense. Returns 'saved', 'unchanged', or false
  // (kept open because something required is missing).
  async function commitInlineEdit(id, details) {
    const amtInput = details.querySelector('.ie-amount');
    if (!amtInput) return 'unchanged'; // read-only row, nothing to save
    const e = (state.mineExpenses || []).find((x) => x.id === id);
    if (!e) return 'unchanged';
    const amount = parseFloat(amtInput.value);
    const currency = details.querySelector('.ie-currency').value;
    const account = details.querySelector('.ie-account').value;
    const date = details.querySelector('.ie-date').value;
    const merchant = details.querySelector('.ie-business').value.trim();
    const description = details.querySelector('.ie-description').value.trim();

    // The report picker is saved together with the fields — so choosing a report
    // and closing the line files the expense into it (no separate step).
    const reportSel = details.querySelector('.report-pick');
    const reportVal = reportSel ? reportSel.value : undefined;
    const reportChanged = reportSel && reportVal !== '__new__' && reportVal !== (e.reportId || '');

    const fileInput = details.querySelector('.ie-receipt-input');
    const receiptFile = fileInput && fileInput.files && fileInput.files[0];

    const fieldsChanged = amount !== e.amount || currency !== (e.currency || 'USD')
      || account !== (e.accountCode || '') || date !== (e.date || '')
      || merchant !== (e.merchant || '') || description !== (e.description || '');
    if (!fieldsChanged && !reportChanged && !receiptFile) return 'unchanged';

    if (!description) { toast('Add a short description.', 'bad'); return false; }
    if (!(amount > 0)) { toast('Amount must be greater than zero.', 'bad'); return false; }
    if (!date) { toast('Pick the date.', 'bad'); return false; }
    if (!account) { toast('Choose an account.', 'bad'); return false; }

    const body = { id, amount, currency, account, date, description, merchant };
    if (reportChanged) body.reportId = reportVal; // '' removes from its report
    if (receiptFile) {
      body.receipt = await prepareReceipt(receiptFile);
    }

    try {
      const res = await api('update-expense', { method: 'POST', body });
      bumpAccountUsage(account);
      if (res && res.warning) toast(res.warning, 'bad');
      else toast(receiptFile ? 'Saved with your receipt.' : (reportChanged && reportVal ? 'Saved and filed into the report.' : 'Saved.'), 'good');
      return 'saved';
    } catch (err) {
      toast(err.message, 'bad');
      return false;
    }
  }

  async function collapseInlineEdit(card, id, details, btn) {
    const result = await commitInlineEdit(id, details);
    if (result === false) return; // missing something — keep it open
    details.setAttribute('hidden', '');
    btn.setAttribute('aria-expanded', 'false');
    card.classList.remove('open');
    if (result === 'saved') refreshExpenseViews();
  }

  async function showAddExpense() {
    if (el.addList) el.addList.innerHTML = `<div class="state">Loading…</div>`;
    loadInbox(); // held email receipts now live on this tab too
    loadDuplicates(); // flag any likely duplicate expenses
    try {
      await ensureReportsData();
      populateReportPicker();
      renderAddList();
    } catch (e) {
      if (el.addList) el.addList.innerHTML = `<div class="state">${escapeHtml(e.message)}</div>`;
    }
  }

  // ----- Possible duplicates -----

  async function loadDuplicates() {
    const panel = $('#dupes-panel');
    const list = $('#dupes-list');
    if (!panel || !list) return;
    try {
      const data = await api('duplicates');
      const groups = data.groups || [];
      if (!groups.length) { panel.hidden = true; return; }
      panel.hidden = false;
      list.innerHTML = groups.map(dupGroupHtml).join('');
    } catch (e) {
      panel.hidden = true;
    }
  }

  function dupItemHtml(e) {
    const amt = e.amountUsd != null ? money(e.amountUsd, 'USD') : money(e.amount, e.currency);
    const who = e.merchant || e.description || '(no description)';
    return `
      <div class="dup-item" data-id="${escapeHtml(e.id)}">
        <div class="dup-item-main">
          <div class="dup-item-top"><strong>${escapeHtml(who)}</strong><span class="dup-item-amt">${escapeHtml(amt)}</span></div>
          <div class="dup-item-meta">${cardMeta(e, [fmtDate(e.date), e.account || e.category])}</div>
          <div class="dup-item-tags">${statusBadge(e.status)}${sourceBadge(e.source)}${e.reportName ? `<span class="src-badge">🗂️ ${escapeHtml(e.reportName)}</span>` : ''}${receiptLink(e)}</div>
        </div>
        <button type="button" class="btn ghost small" data-act="dup-delete" data-id="${escapeHtml(e.id)}">Delete this one</button>
      </div>`;
  }

  function dupGroupHtml(g) {
    const ids = g.items.map((e) => e.id).join(',');
    return `
      <div class="dup-group" data-ids="${escapeHtml(ids)}">
        <div class="dup-reason">💡 Why flagged: ${escapeHtml(g.reason)}</div>
        ${g.items.map(dupItemHtml).join('')}
        <div class="dup-actions">
          <button type="button" class="btn ghost small" data-act="dup-keep">✓ Not a duplicate — keep both</button>
        </div>
      </div>`;
  }

  async function onDuplicatesClick(event) {
    const keep = event.target.closest('button[data-act="dup-keep"]');
    if (keep) {
      const group = keep.closest('.dup-group');
      const ids = (group && group.dataset.ids ? group.dataset.ids.split(',') : []).filter(Boolean);
      if (ids.length < 2) return;
      keep.disabled = true;
      try {
        await api('dismiss-duplicate', { method: 'POST', body: { ids } });
        toast('Got it — kept both. Won’t flag these again.', 'good');
        loadDuplicates();
      } catch (e) { toast(e.message, 'bad'); keep.disabled = false; }
      return;
    }
    const btn = event.target.closest('button[data-act="dup-delete"]');
    if (!btn) return;
    const id = btn.dataset.id;
    requestDelete(btn, id, () => { invalidateReports(); loadDuplicates(); showAddExpense(); });
  }

  // ----- My-reports tab: report cards with status + Submit -----

  // Roll a report's member expenses into a count, total, and one overall status
  // (the least-advanced meaningful stage, so "still needs submitting" wins).
  function reportRollup(reportId) {
    const items = (state.mineExpenses || []).filter((e) => e.reportId === reportId);
    const counts = { unsubmitted: 0, pending: 0, approved: 0, paid: 0 };
    let total = 0;
    items.forEach((e) => {
      total += Number(e.amountUsd) || 0;
      if (e.status === 'Draft' || e.status === 'Rejected') counts.unsubmitted += 1;
      else if (e.status === 'Submitted') counts.pending += 1;
      else if (e.status === 'Approved') counts.approved += 1;
      else if (e.status === 'Reimbursed') counts.paid += 1;
    });
    let status = 'Empty';
    if (items.length) {
      if (counts.unsubmitted) status = 'Draft';
      else if (counts.pending) status = 'Submitted';
      else if (counts.approved) status = 'Approved';
      else status = 'Reimbursed';
    }
    return { items, counts, total, status };
  }

  function memberRowHtml(e) {
    const who = e.merchant || e.description || '(no description)';
    const amt = e.amountUsd != null ? money(e.amountUsd, 'USD') : money(e.amount, e.currency);
    return `
      <div class="rc-item">
        <span class="mini-date">${escapeHtml(fmtDateShort(e.date))}</span>
        <span class="mini-who">${escapeHtml(who)}</span>
        <span class="mini-amt">${escapeHtml(amt)}</span>
        ${statusDot(e.status)}
      </div>`;
  }

  function reportCardHtml(r) {
    const { items, total, counts, status } = reportRollup(r.id);
    const badge = status === 'Empty' ? '<span class="badge empty">Empty</span>' : statusBadge(status);
    const canSubmit = counts.unsubmitted > 0;
    return `
      <div class="report-card" data-report="${escapeHtml(r.id)}">
        <button type="button" class="rc-head" data-act="report-toggle">
          <div class="rc-main">
            <div class="rc-name">${escapeHtml(r.name)}${r.ownerName && firstNameOf(r.ownerName).toLowerCase() !== firstNameOf((state.me && state.me.name) || '').toLowerCase() ? `<span class="mini-who-tag">${escapeHtml(firstNameOf(r.ownerName))}</span>` : ''}</div>
            <div class="rc-sub">${items.length} expense${items.length === 1 ? '' : 's'} · ${escapeHtml(money(total, 'USD'))}</div>
          </div>
          ${badge}
          <span class="mini-caret" aria-hidden="true">▾</span>
        </button>
        <div class="rc-body" hidden>
          ${items.length ? sortExpenses(items).map(expenseRowHtml).join('') : '<div class="state small">No expenses yet — add some on the “Add expense” tab, then pick this report.</div>'}
          <div class="rc-actions">
            ${canSubmit ? `<button class="btn primary small" data-act="report-submit" data-id="${escapeHtml(r.id)}">Submit report for approval</button>` : ''}
            <button class="link-btn" data-act="report-rename" data-id="${escapeHtml(r.id)}">Rename</button>
            ${!items.length ? `<button class="link-btn danger" data-act="report-delete" data-id="${escapeHtml(r.id)}">Delete</button>` : ''}
          </div>
        </div>
      </div>`;
  }

  function renderReports() {
    const box = el.reportsList;
    if (!box) return;
    const reports = state.reports || [];
    const unfiled = (state.mineExpenses || []).filter((e) => !e.reportId).length;
    let html = '';
    if (!reports.length) {
      html += `<div class="state"><span class="emoji">🗂️</span>No reports yet. Tap “＋ New report”, then file expenses into it from the “Add expense” tab.</div>`;
    } else {
      html += reports.map(reportCardHtml).join('');
    }
    if (unfiled) {
      html += `<p class="import-note">You still have ${unfiled} expense${unfiled === 1 ? '' : 's'} not in a report — file ${unfiled === 1 ? 'it' : 'them'} on the “Add expense” tab.</p>`;
    }
    box.innerHTML = html;
  }

  async function showReports() {
    if (el.reportsList) el.reportsList.innerHTML = `<div class="state">Loading…</div>`;
    try {
      await ensureReportsData();
      renderReports();
    } catch (e) {
      if (el.reportsList) el.reportsList.innerHTML = `<div class="state">${escapeHtml(e.message)}</div>`;
    }
  }

  // Re-read the date off each receipt image with the current reader and fix any
  // that changed. One at a time so it never times out; shows progress + a summary
  // of what it corrected.
  async function rescanDates() {
    const items = (state.mineExpenses || []).filter((e) => e.receipt && e.receipt.url);
    const note = $('#rescan-note');
    const btn = $('#rescan-dates');
    if (!items.length) { toast('No receipts to re-read here.', 'bad'); return; }
    if (!window.confirm(`Re-read the date on ${items.length} receipt${items.length === 1 ? '' : 's'} from the images? Only dates are changed.`)) return;

    btn.disabled = true;
    note.hidden = false;
    const changes = [];
    let done = 0;
    for (const e of items) {
      note.textContent = `🔁 Re-reading receipts… ${done + 1}/${items.length}`;
      try {
        const res = await api('rescan-date', { method: 'POST', body: { id: e.id } });
        if (res.changed) changes.push(res);
      } catch (err) { /* skip this one, keep going */ }
      done += 1;
    }
    btn.disabled = false;
    if (changes.length) {
      note.innerHTML = `✅ Corrected ${changes.length} date${changes.length === 1 ? '' : 's'}: ` +
        changes.map((c) => `<strong>${escapeHtml(c.merchant || 'receipt')}</strong> ${escapeHtml(c.old || '—')} → ${escapeHtml(c.date)}`).join('; ');
      toast(`Fixed ${changes.length} date${changes.length === 1 ? '' : 's'} from the receipts.`, 'good');
      state.loaded.mine = false;
      showAddExpense();
    } else {
      note.textContent = '✅ Re-read every receipt — all the dates already matched. Nothing to change.';
      toast('All receipt dates already matched.', 'good');
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
              ${e.missingReceipt ? affidavitLine(e) : ''}
              <div class="expense-actions">
                ${sourceBadge(e.source)}
                ${receiptLink(e)}
                ${historyBtn(e.id)}
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
          ${sourceBadge(e.source)}
          ${receiptLink(e)}
          <button class="link-btn" data-act="edit" data-id="${escapeHtml(e.id)}">Edit</button>
          ${historyBtn(e.id)}
          <button class="link-btn danger" data-act="delete" data-id="${escapeHtml(e.id)}">Delete</button>
        </div>
      </article>
    `).join('');
  }

  function onAuditClick(event) {
    const btn = event.target.closest('button[data-act]');
    if (!btn) return;
    const { act, id } = btn.dataset;
    if (act === 'edit') return startEdit(id);
    if (act === 'delete') return requestDelete(btn, id, () => { state.loaded.audit = false; state.loaded.mine = false; loadAudit(); });
    // "history" is handled by the global history handler.
  }

  async function loadAudit() {
    el.auditSummary.className = 'audit-summary';
    el.auditSummary.textContent = '';
    el.auditList.innerHTML = `<div class="state">Checking…</div>`;
    try {
      const data = await api('audit');
      state.loaded.audit = true;
      state.auditItems = data.items || [];
      renderAudit(data);
    } catch (e) {
      el.auditList.innerHTML = `<div class="state">${escapeHtml(e.message)}</div>`;
    }
  }

  // ---------- Dashboard (spending breakdown) ----------
  // A donut of where the money went, with a month stepper, an all-time / custom
  // range, and click-to-drill-in. All the slice math happens here in the browser
  // over the expenses the server hands back, so stepping months is instant.

  const DONUT_COLORS = [
    '#4f46e5', '#22c55e', '#f59e0b', '#ef4444', '#a78bfa', '#84cc16',
    '#06b6d4', '#ec4899', '#f97316', '#14b8a6', '#8b5cf6', '#eab308',
  ];
  const EVERYTHING_ELSE = '#c7cbe0';
  const MAX_SLICES = 9; // top N, then everything else rolls up

  const dash = {
    raw: [],
    mode: 'month', // month | year | all | custom
    ym: new Date().toISOString().slice(0, 7), // 'YYYY-MM' for month mode
    year: new Date().getFullYear(),
    from: '', to: '',
    dim: 'account', // account | category | status
    scope: 'mine',
    active: null, // drilled-in bucket key
  };

  // A dashboard expense counts as "spend" unless it was denied.
  const isSpend = (e) => e.status !== 'Rejected';

  function dashLabel(e) {
    if (dash.dim === 'account') return e.account || 'Unassigned';
    if (dash.dim === 'category') return e.category || 'Uncategorised';
    return statusLabel(e.status);
  }

  function inPeriod(e) {
    const d = String(e.date || '').slice(0, 10);
    if (!d) return dash.mode === 'all';
    if (dash.mode === 'month') return d.slice(0, 7) === dash.ym;
    if (dash.mode === 'year') return d.slice(0, 4) === String(dash.year);
    if (dash.mode === 'custom') {
      if (dash.from && d < dash.from) return false;
      if (dash.to && d > dash.to) return false;
      return true;
    }
    return true; // all
  }

  function periodLabelText() {
    if (dash.mode === 'all') return 'All time';
    if (dash.mode === 'year') return String(dash.year);
    if (dash.mode === 'custom') {
      if (!dash.from && !dash.to) return 'Custom range';
      return `${dash.from ? fmtDate(dash.from) : '…'} – ${dash.to ? fmtDate(dash.to) : '…'}`;
    }
    const d = new Date(`${dash.ym}-01T00:00:00`);
    return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  function stepPeriod(delta) {
    if (dash.mode === 'month') {
      const d = new Date(`${dash.ym}-01T00:00:00`);
      d.setMonth(d.getMonth() + delta);
      dash.ym = d.toISOString().slice(0, 7);
    } else if (dash.mode === 'year') {
      dash.year += delta;
    } else {
      return; // no stepping for all / custom
    }
    dash.active = null;
    renderDashboard();
  }

  // Sum the in-period spend into buckets by the current dimension.
  function buildBuckets() {
    const map = new Map();
    let total = 0;
    for (const e of dash.raw) {
      if (!isSpend(e) || !inPeriod(e)) continue;
      const usd = Number(e.amountUsd);
      if (!isFinite(usd) || usd <= 0) continue;
      const key = dashLabel(e);
      const b = map.get(key) || { key, usd: 0, count: 0 };
      b.usd += usd; b.count += 1;
      map.set(key, b);
      total += usd;
    }
    const all = [...map.values()].sort((a, b) => b.usd - a.usd);
    // Roll the long tail into one "Everything else" slice.
    let slices = all;
    if (all.length > MAX_SLICES + 1) {
      const head = all.slice(0, MAX_SLICES);
      const tail = all.slice(MAX_SLICES);
      const rest = tail.reduce((s, x) => s + x.usd, 0);
      const restC = tail.reduce((s, x) => s + x.count, 0);
      slices = [...head, { key: 'Everything else', usd: rest, count: restC, rollup: tail.map((x) => x.key) }];
    }
    slices.forEach((s, i) => { s.color = s.key === 'Everything else' ? EVERYTHING_ELSE : DONUT_COLORS[i % DONUT_COLORS.length]; });
    return { slices, total, allCount: all.length };
  }

  // SVG annular-sector path for one slice.
  function arcPath(cx, cy, rOut, rIn, a0, a1) {
    const p = (r, a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const [x0, y0] = p(rOut, a0);
    const [x1, y1] = p(rOut, a1);
    const [x2, y2] = p(rIn, a1);
    const [x3, y3] = p(rIn, a0);
    return `M${x0} ${y0}A${rOut} ${rOut} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${rIn} ${rIn} 0 ${large} 0 ${x3} ${y3}Z`;
  }

  function renderDonut(slices, total) {
    const box = $('#donut');
    if (!box) return;
    if (!total) { box.innerHTML = `<div class="donut-empty">Nothing spent in this period.</div>`; return; }
    const W = 480, H = 300, cx = W / 2, cy = H / 2, rOut = 96, rIn = 62, gap = 0.012;
    const LABEL_MIN = 0.035; // only name slices worth at least this share, so labels don't pile up

    let a = -Math.PI / 2; // start at 12 o'clock
    const arcs = [];
    const labels = [];
    slices.forEach((s) => {
      const frac = s.usd / total;
      const a0 = a + gap;
      const a1 = a + frac * 2 * Math.PI;
      const mid = (a0 + a1) / 2;
      a = a1;
      const dimmed = dash.active && dash.active !== s.key;
      arcs.push(`<path d="${arcPath(cx, cy, rOut, rIn, a0, Math.max(a1 - gap, a0 + 0.001))}" fill="${s.color}" opacity="${dimmed ? 0.28 : 1}" class="donut-slice" data-key="${escapeHtml(s.key)}"><title>${escapeHtml(s.key)} — ${escapeHtml(money(s.usd, 'USD'))}</title></path>`);
      if (frac >= LABEL_MIN) labels.push({ key: s.key, mid, frac, color: s.color, usd: s.usd, dimmed });
    });

    // Lay the labels out around the ring, nudging apart any that would overlap on
    // the same side so the names stay readable.
    const right = [], left = [];
    labels.forEach((l) => {
      l.cos = Math.cos(l.mid); l.sin = Math.sin(l.mid);
      l.x0 = cx + rOut * l.cos; l.y0 = cy + rOut * l.sin;    // point on the ring
      l.x1 = cx + (rOut + 10) * l.cos; l.y1 = cy + (rOut + 10) * l.sin; // elbow
      l.y = l.y1;
      (l.cos >= 0 ? right : left).push(l);
    });
    const spread = (arr) => {
      arr.sort((p, q) => p.y - q.y);
      const gapY = 26;
      for (let i = 1; i < arr.length; i += 1) { if (arr[i].y - arr[i - 1].y < gapY) arr[i].y = arr[i - 1].y + gapY; }
      for (let i = arr.length - 2; i >= 0; i -= 1) { if (arr[i + 1].y - arr[i].y < gapY) arr[i].y = arr[i + 1].y - gapY; }
      arr.forEach((l) => { l.y = Math.max(14, Math.min(H - 14, l.y)); });
    };
    spread(right); spread(left);

    const short = (s) => (s.length > 20 ? `${s.slice(0, 19)}…` : s);
    const labelSvg = labels.map((l) => {
      const rightSide = l.cos >= 0;
      const tx = rightSide ? W - 6 : 6;
      const anchor = rightSide ? 'end' : 'start';
      const kneeX = rightSide ? W - 74 : 74;
      const op = l.dimmed ? 0.3 : 1;
      return `<g opacity="${op}" class="donut-label" data-key="${escapeHtml(l.key)}">
        <polyline points="${l.x0.toFixed(1)},${l.y0.toFixed(1)} ${l.x1.toFixed(1)},${l.y1.toFixed(1)} ${kneeX},${l.y.toFixed(1)} ${tx},${l.y.toFixed(1)}" fill="none" stroke="${l.color}" stroke-width="1.4" />
        <text x="${tx}" y="${(l.y - 2).toFixed(1)}" text-anchor="${anchor}" class="dl-name">${escapeHtml(short(l.key))}</text>
        <text x="${tx}" y="${(l.y + 11).toFixed(1)}" text-anchor="${anchor}" class="dl-sub">${escapeHtml(money(l.usd, 'USD'))} · ${Math.round(l.frac * 100)}%</text>
      </g>`;
    }).join('');

    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" role="img" aria-label="Spending breakdown donut">${arcs.join('')}${labelSvg}</svg>`;
  }

  function renderRank(slices, total) {
    const list = $('#dash-rank');
    if (!list) return;
    if (!slices.length) { list.innerHTML = `<div class="state">No spend in this period.</div>`; return; }
    list.innerHTML = slices.map((s) => {
      const pct = total ? Math.round((s.usd / total) * 100) : 0;
      const on = dash.active === s.key;
      return `
        <button type="button" class="rank-row ${on ? 'on' : ''}" data-key="${escapeHtml(s.key)}">
          <span class="rank-name">${escapeHtml(s.key)}</span>
          <span class="rank-amt">${escapeHtml(money(s.usd, 'USD'))}</span>
          <span class="rank-bar"><span class="rank-fill" style="width:${Math.max(2, pct)}%;background:${s.color}"></span></span>
          <span class="rank-pct">${pct}%</span>
        </button>`;
    }).join('');
  }

  function renderDetail(slices) {
    const wrap = $('#dash-modal');
    const listEl = $('#dash-detail-list');
    if (!wrap || !listEl) return;
    if (!dash.active) { wrap.hidden = true; document.body.classList.remove('modal-open'); return; }
    const slice = slices.find((s) => s.key === dash.active);
    const keys = slice && slice.rollup ? new Set(slice.rollup) : new Set([dash.active]);
    const items = dash.raw
      .filter((e) => isSpend(e) && inPeriod(e) && keys.has(dashLabel(e)) && Number(e.amountUsd) > 0)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    $('#detail-title').textContent = `${dash.active} · ${items.length} expense${items.length === 1 ? '' : 's'}`;
    listEl.innerHTML = items.length ? items.map((e) => `
      <article class="expense">
        <div class="expense-top">
          <div class="expense-main">
            <div class="expense-desc">${cardTitle(e)}</div>
            <div class="expense-meta">${cardMeta(e, [dash.scope === 'all' ? (e.submitterName || e.submitterEmail) : '', e.account, fmtDate(e.date)])}</div>
          </div>
          ${amountBlock(e)}
        </div>
        <div class="expense-actions">${statusBadge(e.status)}${sourceBadge(e.source)}${receiptLink(e)}</div>
      </article>`).join('') : `<div class="state">No expenses here.</div>`;
    wrap.hidden = false;
    document.body.classList.add('modal-open');
    listEl.scrollTop = 0;
  }

  function renderDashboard() {
    $('#period-label').textContent = periodLabelText();
    const stepper = dash.mode === 'month' || dash.mode === 'year';
    $('#period-prev').style.visibility = stepper ? 'visible' : 'hidden';
    $('#period-next').style.visibility = stepper ? 'visible' : 'hidden';
    $('#rank-dim-label').textContent = dash.dim === 'account' ? 'Accounts' : dash.dim === 'category' ? 'Categories' : 'Status';

    const { slices, total } = buildBuckets();
    $('#donut-total').textContent = money(total, 'USD');
    renderDonut(slices, total);
    renderRank(slices, total);
    renderDetail(slices);
  }

  function setActiveBucket(key) {
    dash.active = dash.active === key ? null : key;
    renderDashboard();
  }

  function exportDashboard() {
    const rows = [['Date', 'Merchant', 'Description', 'Account', 'Category', 'Amount (USD)', 'Currency', 'Amount', 'Status']];
    dash.raw
      .filter((e) => isSpend(e) && inPeriod(e))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .forEach((e) => rows.push([
        e.date || '', e.merchant || '', e.description || '', e.account || '', e.category || '',
        e.amountUsd != null ? e.amountUsd : '', e.currency || '', e.amount != null ? e.amount : '', statusLabel(e.status),
      ]));
    const csv = rows.map((r) => r.map((c) => {
      const s = String(c == null ? '' : c);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rembly-spending-${dash.mode === 'month' ? dash.ym : dash.mode === 'year' ? dash.year : 'range'}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function loadDashboard() {
    $('#dash-rank').innerHTML = `<div class="state">Loading…</div>`;
    $('#donut').innerHTML = '';
    try {
      const d = await api(`dashboard?scope=${dash.scope}`);
      state.loaded.dashboard = true;
      dash.raw = d.expenses || [];
      const scopeSel = $('#dash-scope');
      if (scopeSel) scopeSel.hidden = !d.canSeeAll;
      renderDashboard();
    } catch (e) {
      $('#dash-rank').innerHTML = `<div class="state">${escapeHtml(e.message)}</div>`;
    }
  }

  // ---------- Timing / turnaround ----------

  async function loadTiming() {
    const body = $('#timing-body');
    if (body) body.innerHTML = `<div class="state">Loading…</div>`;
    try {
      const d = await api('timing');
      state.loaded.timing = true;
      renderTiming(d);
    } catch (e) {
      if (body) body.innerHTML = `<div class="state">${escapeHtml(e.message)}</div>`;
    }
  }

  // "2.3" → "2.3 days", null → an em dash. Small helper for the metric numbers.
  function days1(n) {
    return n == null ? '—' : `${n}`;
  }

  // A month-by-month bar chart of average days. `accent` is 'approve' or 'pay'.
  function timingBars(trend, accent) {
    const vals = trend.map((t) => t.d).filter((n) => n != null);
    if (!vals.length) {
      return `<div class="state">No data yet — numbers will appear here as reports are ${accent === 'pay' ? 'paid' : 'approved'}.</div>`;
    }
    const max = Math.max(...vals) * 1.15 || 1;
    return `<div class="timing-bars ${accent === 'pay' ? 'pay' : ''}">${trend.map((t, i) => {
      const now = i === trend.length - 1;
      const h = t.d == null ? 0 : Math.max(4, Math.round((t.d / max) * 100));
      const val = t.d == null ? '·' : t.d.toFixed(1);
      return `<div class="timing-bar ${now ? 'now' : ''}" title="${escapeHtml(t.m)}: ${t.count} report${t.count === 1 ? '' : 's'}">
        <span class="tb-val">${val}</span>
        <div class="tb-col" style="height:${h}%"></div>
        <span class="tb-lab">${escapeHtml(t.m)}</span>
      </div>`;
    }).join('')}</div>`;
  }

  // The delta line under a metric ("0.8 day faster than last month").
  function timingDelta(thisAvg, prevAvg, lowerIsBetter = true) {
    if (thisAvg == null || prevAvg == null) return `<div class="metric-delta muted">Not enough history yet to compare</div>`;
    const diff = Math.round((prevAvg - thisAvg) * 10) / 10; // + means quicker this month
    if (diff === 0) return `<div class="metric-delta muted">Same as last month</div>`;
    const quicker = diff > 0;
    const good = lowerIsBetter ? quicker : !quicker;
    const word = quicker ? 'faster' : 'slower';
    return `<div class="metric-delta ${good ? 'good' : 'bad'}">${quicker ? '▼' : '▲'} ${Math.abs(diff)} day ${word} than last month</div>`;
  }

  function renderTiming(d) {
    const body = $('#timing-body');
    if (!body) return;
    const a = d.approve || {}, p = d.pay || {}, w = d.awaiting || {};

    const payMetric = d.paidTrackedInApp
      ? `<div class="metric-big tnum">${days1(p.avgDays)}<span> days avg</span></div>
         ${timingDelta(p.thisMonthAvg, p.prevMonthAvg)}`
      : `<div class="metric-big muted">Not tracked yet</div>
         <div class="metric-delta muted">No reimbursements have been marked paid in Rembly</div>`;

    const oldestWarn = w.oldestDays >= 14;

    body.innerHTML = `
      <div class="timing-metrics">
        <div class="metric-card approve">
          <span class="metric-rail"></span>
          <div class="metric-cap">Time to approve</div>
          <div class="metric-stage">submitted → approved</div>
          <div class="metric-big tnum">${days1(a.avgDays)}<span> days avg</span></div>
          ${timingDelta(a.thisMonthAvg, a.prevMonthAvg)}
          <div class="metric-foot">${a.count} report${a.count === 1 ? '' : 's'} measured</div>
        </div>
        <div class="metric-card pay">
          <span class="metric-rail"></span>
          <div class="metric-cap">Time to reimburse</div>
          <div class="metric-stage">approved → paid</div>
          ${payMetric}
          <div class="metric-foot">${p.count} report${p.count === 1 ? '' : 's'} measured</div>
        </div>
      </div>

      <div class="timing-strip">
        <div class="ts"><span class="ts-k">Approved this month</span><span class="ts-v tnum">${d.approvedThisMonth}</span></div>
        <div class="ts-div"></div>
        <div class="ts"><span class="ts-k">Awaiting payment</span><span class="ts-v tnum">${w.count}</span></div>
        <div class="ts"><span class="ts-k">…worth</span><span class="ts-v tnum">${escapeHtml(money(w.usd, 'USD'))}</span></div>
        <div class="ts-div"></div>
        <div class="ts"><span class="ts-k">Oldest unpaid</span><span class="ts-v tnum ${oldestWarn ? 'warn' : ''}">${w.oldestDays} day${w.oldestDays === 1 ? '' : 's'}</span></div>
      </div>

      <div class="timing-charts">
        <div class="timing-chart">
          <div class="tc-head"><h3>Time to approve</h3><span class="tc-sub">avg days · last 6 months</span></div>
          ${timingBars(d.trend.approve, 'approve')}
        </div>
        <div class="timing-chart">
          <div class="tc-head"><h3>Approved → paid</h3><span class="tc-sub">avg days · last 6 months</span></div>
          ${timingBars(d.trend.pay, 'pay')}
        </div>
      </div>

      ${d.paidTrackedInApp ? '' : `<div class="timing-note">To see the <strong>approved → paid</strong> clock, reimbursements need to be marked paid in Rembly — Finance can do that on the <strong>Paid</strong> screen (it also emails the person they've been reimbursed). Until then, that half stays blank.</div>`}`;
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
          ${historyBtn(e.id)}
        </div>
      </article>`;
  }

  function renderArchive(data) {
    const ready = data.ready || [];
    const paid = data.paid || [];

    // "Waiting to be paid" — approved reports grouped by person. Finance exports
    // the CSV (their hand-off), then bulk-selects (or all) and marks them paid.
    if (data.role === 'Finance') {
      el.archiveReadyWrap.hidden = false;
      state.archiveReady = ready; // stash for the CSV export
      if (!ready.length) {
        el.archiveReady.innerHTML = `<div class="state"><span class="emoji">💸</span>Nothing waiting — every approved expense has been paid.</div>`;
      } else {
        const groups = groupBySubmitter(ready);
        const totalUsd = ready.reduce((s, e) => s + (Number(e.amountUsd) || 0), 0);
        const toolbar = `
          <div class="pay-toolbar">
            <label class="pay-selall"><input type="checkbox" data-act="select-all" /> Select all</label>
            <span class="pay-count">${groups.length} report${groups.length === 1 ? '' : 's'} · ${escapeHtml(money(totalUsd, 'USD'))} waiting</span>
            <span class="grow"></span>
            <button class="btn ghost small" data-act="export-csv">⤓ Export CSV</button>
            <button class="btn primary small" data-act="mark-selected" disabled>Mark selected paid</button>
          </div>`;
        el.archiveReady.innerHTML = toolbar + groups.map((g) => `
          <div class="report" data-group="${escapeHtml(g.key)}" data-total="${g.total}" data-count="${g.items.length}">
            <div class="report-head">
              <label class="pay-check"><input type="checkbox" data-act="select-group" aria-label="Select ${escapeHtml(g.name)}" /></label>
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
                  <div class="expense-actions">
                    ${receiptLink(e)}
                    ${historyBtn(e.id)}
                    <button class="btn ghost small" data-act="kickback-toggle">Kick back</button>
                  </div>
                  <div class="sendback-row">
                    <input type="text" placeholder="What needs fixing?" data-role="note" maxlength="200" />
                    <button class="btn primary small" data-act="kickback-confirm">Send back</button>
                  </div>
                </article>`).join('')}
            </div>
          </div>`).join('');
      }
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
      state.loaded.timing = false; // approved→paid clock changed
      toast(`Marked ${res.paid} expense${res.paid === 1 ? '' : 's'} paid 💸`, 'good');
    } catch (e) {
      buttons.forEach((b) => (b.disabled = false));
      toast(e.message, 'bad');
    }
  }

  // ---- "Waiting to be paid" queue: CSV export + bulk mark-paid ----

  // Quote a CSV cell only when it needs it (comma, quote, or newline).
  function csvCell(v) {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  // Download every approved (waiting-to-be-paid) expense as a CSV — CedarStone's
  // hand-off into their own payment process. Exports all of them, not just the
  // selected ones, so it's the full batch.
  function exportApprovedCsv() {
    const rows = state.archiveReady || [];
    if (!rows.length) return toast('Nothing approved to export.', 'bad');
    const headers = ['Report', 'Person', 'Email', 'Date', 'Description', 'Merchant',
      'Category', 'Account', 'GL code', 'Amount', 'Currency', 'Amount (USD)', 'Approved on'];
    const lines = [headers.join(',')];
    for (const e of rows) {
      lines.push([
        e.reportName || '', e.submitterName || '', e.submitterEmail || '', e.date || '',
        e.description || '', e.merchant || '', e.category || '', e.account || '', e.accountCode || '',
        e.amount != null ? e.amount : '', e.currency || '', e.amountUsd != null ? e.amountUsd : '',
        e.decidedOn || '',
      ].map(csvCell).join(','));
    }
    // Prepend a BOM so Excel opens UTF-8 (Czech/Polish names) correctly.
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `approved-expenses-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Exported ${rows.length} approved expense${rows.length === 1 ? '' : 's'} ⤓`, 'good');
  }

  // Reflect the current checkbox selection in the toolbar (count, total, button).
  function updatePaySelection() {
    const groups = $$('.report', el.archiveReady);
    const checked = groups.filter((g) => {
      const c = $('input[data-act="select-group"]', g);
      return c && c.checked;
    });
    const count = checked.reduce((s, g) => s + (parseInt(g.dataset.count, 10) || 0), 0);
    const total = checked.reduce((s, g) => s + (parseFloat(g.dataset.total) || 0), 0);
    const btn = $('button[data-act="mark-selected"]', el.archiveReady);
    if (btn) {
      btn.disabled = checked.length === 0;
      btn.textContent = checked.length ? `Mark ${count} paid · ${money(total, 'USD')}` : 'Mark selected paid';
    }
    const all = $('input[data-act="select-all"]', el.archiveReady);
    if (all) {
      all.checked = groups.length > 0 && checked.length === groups.length;
      all.indeterminate = checked.length > 0 && checked.length < groups.length;
    }
  }

  // Mark every expense in the selected reports paid, in one call.
  async function markSelectedPaid() {
    const groups = $$('.report', el.archiveReady).filter((g) => {
      const c = $('input[data-act="select-group"]', g);
      return c && c.checked;
    });
    if (!groups.length) return;
    const ids = groups.flatMap((g) => $$('.expense', g).map((c) => c.dataset.id));
    const btn = $('button[data-act="mark-selected"]', el.archiveReady);
    if (btn) btn.disabled = true;
    try {
      const res = await api('mark-paid', { method: 'POST', body: { ids } });
      groups.forEach((g) => {
        g.style.transition = 'opacity .25s';
        g.style.opacity = '0';
        setTimeout(() => g.remove(), 240);
      });
      setTimeout(() => {
        if (!$$('.report', el.archiveReady).length) {
          el.archiveReady.innerHTML = `<div class="state"><span class="emoji">💸</span>Nothing waiting — every approved expense has been paid.</div>`;
        }
        updatePaySelection();
      }, 260);
      state.loaded.dashboard = false;
      state.loaded.archive = false;
      state.loaded.timing = false;
      toast(`Marked ${res.paid} expense${res.paid === 1 ? '' : 's'} paid 💸`, 'good');
    } catch (e) {
      if (btn) btn.disabled = false;
      toast(e.message, 'bad');
    }
  }

  // Checkbox changes in the waiting-to-be-paid queue (select-all / per-report).
  function onArchiveChange(event) {
    const t = event.target;
    if (t.matches('input[data-act="select-all"]')) {
      const on = t.checked;
      $$('.report input[data-act="select-group"]', el.archiveReady).forEach((c) => { c.checked = on; });
      updatePaySelection();
    } else if (t.matches('input[data-act="select-group"]')) {
      updatePaySelection();
    }
  }

  function removeReadyCard(card) {
    const group = card.closest('.report');
    card.style.transition = 'opacity .25s, transform .25s';
    card.style.opacity = '0';
    card.style.transform = 'translateX(12px)';
    setTimeout(() => {
      card.remove();
      if (group && !$$('.expense', group).length) group.remove();
      if (!$$('.report', el.archiveReady).length) {
        el.archiveReady.innerHTML = `<div class="state"><span class="emoji">💸</span>Nothing waiting — every approved expense has been paid.</div>`;
      }
    }, 240);
  }

  async function kickBack(card, note) {
    const buttons = $$('button', card);
    buttons.forEach((b) => (b.disabled = true));
    try {
      await api('kick-back', { method: 'POST', body: { id: card.dataset.id, note } });
      removeReadyCard(card);
      state.loaded.mine = false; // submitter now sees it as sent back
      state.loaded.dashboard = false;
      toast('Kicked back to the submitter ↩︎', 'good');
    } catch (e) {
      buttons.forEach((b) => (b.disabled = false));
      toast(e.message, 'bad');
    }
  }

  function onArchiveClick(event) {
    const btn = event.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;

    if (act === 'export-csv') { exportApprovedCsv(); return; }
    if (act === 'mark-selected') { markSelectedPaid(); return; }

    if (act === 'mark-paid') {
      const group = event.target.closest('.report');
      if (group) markPaid(group);
      return;
    }

    const card = event.target.closest('.expense');
    if (!card) return;
    if (act === 'kickback-toggle') {
      const row = $('.sendback-row', card);
      row.classList.toggle('open');
      if (row.classList.contains('open')) $('input[data-role="note"]', row).focus();
    } else if (act === 'kickback-confirm') {
      const note = $('input[data-role="note"]', card).value.trim();
      if (!note) return toast('Add a short note so they know what to fix.', 'bad');
      kickBack(card, note);
    }
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

  // ---------- Import from spreadsheet ----------

  const IMPORT_TEMPLATE =
    'Date,Amount,Currency,Merchant,Description,Account\n' +
    '2026-07-01,12.50,USD,Uber,Airport ride to camp,8395000\n' +
    '2026-07-03,1930,CZK,Restaurace Imrvére,Team dinner,8147000\n' +
    '2026-07-05,9.99,USD,Adobe,Design software subscription,\n';

  const IMPORT_INSTRUCTIONS = [
    'Build me a spreadsheet (CSV) of my expenses with ONE row per expense and a header row using exactly these columns:',
    '',
    'Date, Amount, Currency, Merchant, Description, Account',
    '',
    '- Date: format as YYYY-MM-DD (e.g. 2026-07-01).',
    '- Amount: the number only, in the original currency (no currency symbols).',
    '- Currency: one of USD, EUR, CZK, PLN, GBP, RON, HUF, BGN, RSD, UAH. If unknown, use USD.',
    '- Merchant: where the money was spent.',
    '- Description: a short note on what it was for.',
    '- Account: the JV GL code (e.g. 8147000) if you know it; otherwise leave it blank.',
    '',
    'One expense per row. Do not merge cells or add totals. Output plain CSV.',
  ].join('\n');

  function downloadTemplate() {
    const blob = new Blob([IMPORT_TEMPLATE], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rembly-import-template.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copyImportInstructions() {
    try {
      await navigator.clipboard.writeText(IMPORT_INSTRUCTIONS);
      toast('Instructions copied — paste them wherever you build your file.', 'good');
    } catch {
      // Clipboard blocked (e.g. insecure context) — show them to copy by hand.
      window.prompt('Copy these instructions:', IMPORT_INSTRUCTIONS);
    }
  }

  function accountOptionsHtml(selected) {
    const opt = (a) => `<option value="${escapeHtml(a.code)}"${a.code === selected ? ' selected' : ''}>${escapeHtml(a.code)} – ${escapeHtml(a.name)}</option>`;
    return `<option value="">Choose account…</option>${state.accounts.map(opt).join('')}`;
  }

  function clearImport() {
    state.importRows = [];
    el.importFile.value = '';
    el.importName.textContent = '';
    el.importSummary.innerHTML = '';
    el.importPreview.innerHTML = '';
    el.importActions.hidden = true;
  }

  function renderImportPreview(data) {
    state.importRows = data.rows || [];
    state.importFormat = data.format || 'csv';
    const s = data.summary || { total: 0, duplicates: 0, ready: 0 };
    const bits = [`${s.total} row${s.total === 1 ? '' : 's'}`];
    if (s.duplicates) bits.push(`${s.duplicates} possible duplicate${s.duplicates === 1 ? '' : 's'}`);
    bits.push(`${s.ready} ready`);
    let summary = `<div class="import-summary-line">${escapeHtml(bits.join(' · '))}</div>`;
    if (data.dateOrder) {
      const dmy = data.dateOrder === 'dmy';
      summary += `<div class="import-note">📅 Dates read <strong>${dmy ? 'day-first (European)' : 'month-first (US)'}</strong> — e.g. 12/07 = ${dmy ? '12 July' : 'December 7'}. Check a couple below to be sure.</div>`;
    }
    if (s.withReceipt) {
      summary += `<div class="import-note">🧾 ${s.withReceipt} of these will arrive with a receipt already attached from your email.</div>`;
    }
    if (s.receiptsUnmatched) {
      summary += `<div class="import-note">${s.receiptsUnmatched} held receipt${s.receiptsUnmatched === 1 ? '' : 's'} didn’t match a row — they stay in your inbox above.</div>`;
    }
    if (data.unmatched && data.unmatched.length) {
      summary += `<div class="import-note">Columns not used: ${escapeHtml(data.unmatched.join(', '))}</div>`;
    }
    el.importSummary.innerHTML = summary;

    if (!state.importRows.length) {
      el.importPreview.innerHTML = `<div class="state">No rows to import.</div>`;
      el.importActions.hidden = true;
      return;
    }

    el.importPreview.innerHTML = state.importRows.map(importRowHtml).join('');
    $('#import-commit-btn').textContent = 'Import selected';
    el.importActions.hidden = false;

    // Fill in a best-guess account for rows that came in without one — quietly,
    // in the background, so the preview shows instantly and the accounts appear a
    // moment later for you to review.
    autoSuggestAccounts();
  }

  // Ask Claude to code the uncoded rows from their text, in small batches, and
  // drop each suggestion into that row's account picker. Best-effort: if it's
  // off or errors, rows just stay blank for you to choose by hand.
  async function autoSuggestAccounts() {
    const rows = state.importRows
      .filter((r) => r.importable && !r.duplicate && !r.accountCode)
      .map((r) => ({ line: r.line, merchant: r.merchant, description: r.description, amount: r.amount }));
    if (!rows.length) return;

    const note = document.createElement('div');
    note.className = 'import-note suggest-note';
    note.textContent = '✨ Suggesting accounts…';
    el.importSummary.appendChild(note);

    const CHUNK = 40;
    let filled = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      let res;
      try {
        res = await api('suggest-accounts', { method: 'POST', body: { rows: rows.slice(i, i + CHUNK) } });
      } catch (e) {
        note.remove();
        return; // best-effort — leave the rest for manual selection
      }
      (res.suggestions || []).forEach((s) => {
        const row = $(`.import-row[data-line="${s.line}"]`, el.importPreview);
        const sel = row && $('.ir-acct', row);
        if (sel && Array.from(sel.options).some((o) => o.value === s.code)) { sel.value = s.code; filled += 1; }
      });
      note.textContent = `✨ Suggesting accounts… ${Math.min(i + CHUNK, rows.length)}/${rows.length}`;
    }
    note.textContent = filled
      ? `✨ Suggested an account for ${filled} row${filled === 1 ? '' : 's'} — please double-check before importing.`
      : '';
  }

  // One selectable row (checkbox + details + account picker), shared by the
  // "add" preview and the reconcile "missing" list.
  function importRowHtml(r) {
    const bad = !r.importable;
    const checked = !bad && !r.duplicate;
    const flags = [];
    if (r.duplicate) flags.push(`<span class="badge rejected">Duplicate · ${escapeHtml(r.dupReason)}</span>`);
    if (r.receiptFound) flags.push(`<span class="badge approved">🧾 Receipt matched</span>`);
    (r.issues || []).forEach((i) => { if (i !== 'Currency') flags.push(`<span class="issue">Missing ${escapeHtml(i.toLowerCase())}</span>`); });
    const title = r.merchant || r.description || '(no merchant)';
    const amt = r.amount != null ? `${money(r.amount, r.currency)}` : '—';
    return `
      <div class="import-row ${bad ? 'bad' : ''} ${r.duplicate ? 'dup' : ''}" data-line="${escapeHtml(String(r.line))}">
        <input type="checkbox" class="ir-check" ${checked ? 'checked' : ''} ${bad ? 'disabled' : ''} />
        <div class="ir-main">
          <div class="ir-top"><strong>${escapeHtml(title)}</strong><span class="ir-amt">${escapeHtml(amt)}</span></div>
          <div class="ir-meta">${escapeHtml([fmtDate(r.date) || 'no date', r.merchant && r.description ? r.description : ''].filter(Boolean).join(' · '))}</div>
          ${flags.length ? `<div class="ir-flags">${flags.join(' ')}</div>` : ''}
        </div>
        <select class="ir-acct" ${bad ? 'disabled' : ''}>${accountOptionsHtml(r.accountCode)}</select>
      </div>`;
  }

  // A plain, read-only line (matched / extra lists in reconcile).
  function reconcileLine(r, tail) {
    const title = r.merchant || r.description || '(no merchant)';
    const amt = r.amount != null ? money(r.amount, r.currency) : '—';
    return `
      <div class="recon-line">
        <div class="recon-main">
          <div class="recon-title">${escapeHtml(title)}</div>
          <div class="expense-meta">${escapeHtml([fmtDate(r.date), tail].filter(Boolean).join(' · '))}</div>
        </div>
        <div class="recon-amt">${escapeHtml(amt)}</div>
      </div>`;
  }

  const IMPORT_HINTS = {
    add: 'Upload your budget export (YNAB works — Date, Payee, Outflow, Memo). Rembly turns each row into an Unsubmitted expense and automatically attaches the matching receipt from your email. It flags duplicates and lets you review before anything is added. Nothing goes to your approver until you review them under “My expenses” and hit Submit.',
    reconcile: 'Upload the list of reimbursable expenses from your budget app. Rembly checks each one against what you’ve already submitted and shows you exactly what’s still missing for the period.',
  };

  function setImportMode(mode) {
    state.importMode = mode;
    $$('.import-mode .type-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
    $('#import-mode-hint').textContent = IMPORT_HINTS[mode] || '';
    clearImport();
  }

  async function onImportFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reconciling = state.importMode === 'reconcile';
    el.importName.textContent = `${file.name} · reading…`;
    el.importPreview.innerHTML = `<div class="state">${reconciling ? 'Checking coverage…' : 'Reading your file…'}</div>`;
    el.importSummary.innerHTML = '';
    el.importActions.hidden = true;
    try {
      const base64 = await readFileAsBase64(file);
      const body = { file: { filename: file.name, contentType: file.type || 'text/csv', base64 } };
      const data = await api(reconciling ? 'reconcile' : 'import-parse', { method: 'POST', body });
      el.importName.textContent = file.name;
      if (reconciling) renderReconcile(data);
      else renderImportPreview(data);
    } catch (e) {
      el.importName.textContent = file.name;
      el.importPreview.innerHTML = `<div class="state">${escapeHtml(e.message)}</div>`;
    }
  }

  function renderReconcile(data) {
    const s = data.summary || { total: 0, matched: 0, missing: 0, extra: 0 };
    const matched = data.matched || [];
    const missing = data.missing || [];
    const extra = data.extra || [];
    // The missing rows become the selectable list (reusing the import commit path).
    state.importRows = missing;

    const period = s.from && s.to ? ` · ${escapeHtml(fmtDate(s.from))}–${escapeHtml(fmtDate(s.to))}` : '';
    const cls = s.missing === 0 ? 'good' : 'warn';
    el.importSummary.innerHTML = `
      <div class="recon-summary ${cls}">
        ${s.missing === 0
          ? `✓ All ${s.total} expense${s.total === 1 ? '' : 's'} from your budget file are already in Rembly${period}.`
          : `⚠ ${s.missing} of ${s.total} not in Rembly yet · ${s.matched} already captured${period}.`}
      </div>`;

    let html = '';
    if (missing.length) {
      html += `<h3 class="dash-h">Missing — not in Rembly yet (${missing.length})</h3>`;
      html += `<p class="import-note">Tick the ones to add. They come in <strong>Unsubmitted</strong> — review them under “My expenses,” then hit Submit to send them for approval.</p>`;
      html += missing.map(importRowHtml).join('');
    }
    if (matched.length) {
      html += `<details class="import-help"><summary>✓ Already captured (${matched.length})</summary>${
        matched.map((m) => reconcileLine(m, `matched to your “${escapeHtml(statusLabel(m.matchedTo.status || 'submitted').toLowerCase())}” expense`)).join('')
      }</details>`;
    }
    if (extra.length) {
      html += `<details class="import-help"><summary>In Rembly but not on your budget list (${extra.length})</summary>${
        extra.map((x) => reconcileLine(x, escapeHtml(statusLabel(x.status || 'submitted').toLowerCase()))).join('')
      }</details>`;
    }
    el.importPreview.innerHTML = html || `<div class="state">Nothing to reconcile.</div>`;

    if (missing.length) {
      $('#import-commit-btn').textContent = `Add the ${missing.length} missing`;
      el.importActions.hidden = false;
    } else {
      el.importActions.hidden = true;
    }
  }

  async function commitImport() {
    const rowsById = new Map(state.importRows.map((r) => [String(r.line), r]));
    const picked = [];
    $$('.import-row', el.importPreview).forEach((el2) => {
      const check = $('.ir-check', el2);
      if (!check || !check.checked || check.disabled) return;
      const r = rowsById.get(el2.dataset.line);
      if (!r) return;
      const account = ($('.ir-acct', el2) || {}).value || ''; // optional — code it later
      picked.push({ line: r.line, date: r.date, amount: r.amount, currency: r.currency, merchant: r.merchant, description: r.description || r.merchant, account });
    });

    if (!picked.length) return toast('Tick at least one row to import.', 'bad');

    const btn = $('#import-commit-btn');
    btn.disabled = true;
    const original = btn.textContent;
    const source = el.importName.textContent || 'spreadsheet';
    // Send in small batches so a big upload can't hit the per-request time limit.
    const CHUNK = 20;
    let created = 0;
    let attached = 0;
    const skipped = [];
    try {
      for (let i = 0; i < picked.length; i += CHUNK) {
        const batch = picked.slice(i, i + CHUNK);
        btn.textContent = `Importing… ${Math.min(i + CHUNK, picked.length)}/${picked.length}`;
        const res = await api('import-commit', { method: 'POST', body: { rows: batch, source, kind: state.importFormat } });
        created += res.created || 0;
        attached += res.attached || 0;
        if (res.skipped && res.skipped.length) skipped.push(...res.skipped);
      }
      const bits = [];
      if (skipped.length) bits.push(`${skipped.length} skipped`);
      if (attached) bits.push(`${attached} with a receipt from email`);
      const extra = bits.length ? ` · ${bits.join(' · ')}` : '';
      toast(`Imported ${created} expense${created === 1 ? '' : 's'}${extra} 🎉`, 'good');
      clearImport();
      setImportOpen(false);
      state.loaded.mine = false;
      state.loaded.audit = false;
      state.loaded.dashboard = false;
      showAddExpense(); // land back on the list so you can file the new expenses into reports
    } catch (e) {
      toast(`Imported ${created} so far, then hit an error: ${e.message}`, 'bad');
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  // ---------- Mileage rates (Finance management) ----------

  function renderRates(rates, currencies) {
    const cur = $('#rate-currency');
    if (cur && currencies && currencies.length && !cur.options.length) {
      cur.innerHTML = currencies.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    }
    if (!rates.length) {
      el.ratesList.innerHTML = `<div class="state">No rates yet — add one above.</div>`;
      return;
    }
    el.ratesList.innerHTML = rates.map((r) => `
      <article class="expense rate-row ${r.active ? '' : 'off'}" data-id="${escapeHtml(r.id)}">
        <div class="expense-top">
          <div class="expense-main">
            <div class="expense-desc">${escapeHtml(r.name)} ${r.active ? '' : '<span class="badge draft">Off</span>'}</div>
            <div class="expense-meta">${escapeHtml(money(r.rate, r.currency))} per ${escapeHtml(r.unit === 'miles' ? 'mile' : 'km')}</div>
          </div>
        </div>
        <div class="expense-actions">
          <button class="link-btn" data-act="rate-edit">Edit</button>
          <button class="link-btn" data-act="rate-toggle">${r.active ? 'Turn off' : 'Turn on'}</button>
          <button class="link-btn danger" data-act="rate-delete">Delete</button>
        </div>
      </article>`).join('');
  }

  async function loadRates() {
    el.ratesList.innerHTML = `<div class="state">Loading…</div>`;
    try {
      const data = await api('mileage-rates');
      state.loaded.rates = true;
      state.rates = data.rates || [];
      renderRates(state.rates, data.currencies || []);
    } catch (e) {
      el.ratesList.innerHTML = `<div class="state">${escapeHtml(e.message)}</div>`;
    }
  }

  function resetRateForm() {
    $('#rate-id').value = '';
    $('#rate-name').value = '';
    $('#rate-unit').value = 'miles';
    $('#rate-amount').value = '';
    $('#rate-active').checked = true;
    $('#rate-form-title').textContent = 'Add a rate';
    $('#rate-save').textContent = 'Add rate';
    $('#rate-cancel').hidden = true;
  }

  function editRate(id) {
    const r = state.rates.find((x) => x.id === id);
    if (!r) return;
    $('#rate-id').value = r.id;
    $('#rate-name').value = r.name;
    $('#rate-unit').value = r.unit;
    $('#rate-amount').value = r.rate != null ? r.rate : '';
    if (hasOption('#rate-currency', r.currency)) $('#rate-currency').value = r.currency;
    $('#rate-active').checked = r.active;
    $('#rate-form-title').textContent = 'Edit rate';
    $('#rate-save').textContent = 'Save rate';
    $('#rate-cancel').hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function afterRateChange() {
    state.loaded.rates = false;
    await loadRates();
    loadOptions(); // refresh the rate dropdown on the submit form too
  }

  async function saveRate(event) {
    event.preventDefault();
    const body = {
      id: $('#rate-id').value || undefined,
      name: $('#rate-name').value.trim(),
      unit: $('#rate-unit').value,
      rate: parseFloat($('#rate-amount').value),
      currency: $('#rate-currency').value,
      active: $('#rate-active').checked,
    };
    if (!body.name) return toast('Give the rate a name.', 'bad');
    if (!(body.rate > 0)) return toast('Rate must be greater than zero.', 'bad');
    if (!body.currency) return toast('Pick a currency.', 'bad');
    const btn = $('#rate-save');
    btn.disabled = true;
    try {
      await api('save-mileage-rate', { method: 'POST', body });
      toast(body.id ? 'Rate saved.' : 'Rate added.', 'good');
      resetRateForm();
      await afterRateChange();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      btn.disabled = false;
    }
  }

  async function deleteRate(id) {
    if (!window.confirm('Delete this rate? Past expenses keep the rate they used.')) return;
    try {
      await api('save-mileage-rate', { method: 'POST', body: { id, delete: true } });
      toast('Rate deleted.', 'good');
      await afterRateChange();
    } catch (e) {
      toast(e.message, 'bad');
    }
  }

  async function toggleRate(id) {
    const r = state.rates.find((x) => x.id === id);
    if (!r) return;
    try {
      await api('save-mileage-rate', {
        method: 'POST',
        body: { id: r.id, name: r.name, unit: r.unit, rate: r.rate, currency: r.currency, active: !r.active },
      });
      await afterRateChange();
    } catch (e) {
      toast(e.message, 'bad');
    }
  }

  function onRatesClick(event) {
    const btn = event.target.closest('button[data-act]');
    if (!btn) return;
    const card = event.target.closest('[data-id]');
    const id = card && card.dataset.id;
    if (!id) return;
    if (btn.dataset.act === 'rate-edit') editRate(id);
    else if (btn.dataset.act === 'rate-delete') deleteRate(id);
    else if (btn.dataset.act === 'rate-toggle') toggleRate(id);
  }

  // ---------- People & access (Finance management) ----------

  const PEOPLE_TEMPLATE =
    'Name,Email,Role,Upline,Accounts,Household\n' +
    'Dana Director,director@josiahventure.com,Finance,,,\n' +
    'Mel Ellenwood,mel@josiahventure.com,Approver,director@josiahventure.com,"9100000, 9200000",Mel & Amy Ellenwood\n' +
    'Amy Ellenwood,amy@josiahventure.com,Staff,director@josiahventure.com,,Mel & Amy Ellenwood\n' +
    'Jana Novak,jana@josiahventure.com,Staff,mel@josiahventure.com,,\n';

  const PEOPLE_INSTRUCTIONS = [
    'Build me a CSV of our people with ONE row per person and a header row using exactly these columns:',
    '',
    'Name, Email, Role, Upline, Accounts, Household',
    '',
    '- Name: the person’s full name.',
    '- Email: their Josiah Venture email (this is how people are matched).',
    '- Role: one of Staff, Approver, or Finance.',
    '- Upline: the email of the person who approves their expenses (leave blank for top-level people).',
    '- Accounts: only for people who may use restricted general-fund accounts — the GL codes separated by commas (e.g. "9100000, 9200000"). Leave blank for everyone else.',
    '- Household: a shared label for people whose expenses are pooled and reimbursed together, like a married couple. Give both people the SAME text. Make it UNIQUE to that couple — not just a surname if other families share it (e.g. "Mel & Amy Ellenwood", not "Ellenwood"). Leave blank for everyone who is on their own.',
    '',
    'One person per row. Output plain CSV.',
  ].join('\n');

  function roleBadge(role) {
    const key = String(role || 'Staff').toLowerCase();
    const cls = key === 'finance' ? 'reimbursed' : key === 'approver' ? 'approved' : 'draft';
    return `<span class="badge ${cls}">${escapeHtml(role || 'Staff')}</span>`;
  }

  function renderPeople(people) {
    if (!people.length) {
      el.peopleList.innerHTML = `<div class="state">No people yet — upload a file above.</div>`;
      return;
    }
    el.peopleList.innerHTML = people.map((p) => {
      const meta = [p.email];
      if (p.uplineName) meta.push(`upline: ${p.uplineName}`);
      if (p.accounts && p.accounts.length) meta.push(`funds: ${p.accounts.join(', ')}`);
      return `
        <article class="expense">
          <div class="expense-top">
            <div class="expense-main">
              <div class="expense-desc">${escapeHtml(p.name || p.email)} ${roleBadge(p.role)}</div>
              <div class="expense-meta">${escapeHtml(meta.join(' · '))}</div>
            </div>
          </div>
        </article>`;
    }).join('');
  }

  async function loadPeople() {
    el.peopleList.innerHTML = `<div class="state">Loading…</div>`;
    try {
      const data = await api('people');
      state.loaded.people = true;
      renderPeople(data.people || []);
    } catch (e) {
      el.peopleList.innerHTML = `<div class="state">${escapeHtml(e.message)}</div>`;
    }
  }

  async function onPeopleFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    el.peopleName.textContent = `${file.name} · reading…`;
    el.peopleSummary.innerHTML = '';
    try {
      const base64 = await readFileAsBase64(file);
      const data = await api('people-upload', {
        method: 'POST',
        body: { file: { filename: file.name, contentType: file.type || 'text/csv', base64 } },
      });
      el.peopleName.textContent = file.name;
      const warnHtml = (data.warnings || []).length
        ? `<details class="import-help"><summary>${data.warnings.length} note${data.warnings.length === 1 ? '' : 's'}</summary><ul>${data.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul></details>`
        : '';
      el.peopleSummary.innerHTML = `<div class="recon-summary good">✓ ${data.created} added · ${data.updated} updated</div>${warnHtml}`;
      renderPeople(data.people || []);
      el.peopleFile.value = '';
      loadOptions(); // the caller's own account picker may have changed
    } catch (e) {
      el.peopleName.textContent = file.name;
      el.peopleSummary.innerHTML = `<div class="recon-summary warn">${escapeHtml(e.message)}</div>`;
    }
  }

  function downloadPeopleTemplate() {
    const blob = new Blob([PEOPLE_TEMPLATE], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rembly-people-template.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copyPeopleInstructions() {
    try {
      await navigator.clipboard.writeText(PEOPLE_INSTRUCTIONS);
      toast('Instructions copied.', 'good');
    } catch {
      window.prompt('Copy these instructions:', PEOPLE_INSTRUCTIONS);
    }
  }

  // ---------- History / activity trail ----------

  const EVENT_ICON = {
    Imported: '📥', Submitted: '📝', Approved: '✅', 'Sent back': '↩︎', 'Kicked back': '↩︎',
    Resubmitted: '🔁', Edited: '✏️', Paid: '💸',
  };

  function fmtDateTime(value) {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d)) return String(value);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function renderTrail(items) {
    if (!items.length) return `<div class="trail-empty">No history recorded yet.</div>`;
    return `<ol class="trail">${items.map((a) => `
      <li class="trail-item">
        <span class="trail-icon">${EVENT_ICON[a.event] || '•'}</span>
        <div class="trail-body">
          <div class="trail-line"><strong>${escapeHtml(a.event)}</strong> by ${escapeHtml(a.actor || '—')}</div>
          <div class="trail-when">${escapeHtml(fmtDateTime(a.at))}</div>
          ${a.note ? `<div class="trail-note">“${escapeHtml(a.note)}”</div>` : ''}
        </div>
      </li>`).join('')}</ol>`;
  }

  async function toggleHistory(btn) {
    const card = btn.closest('.expense');
    if (!card) return;
    let box = $('.trail-box', card);
    if (box) { // already loaded — just toggle
      const show = box.hasAttribute('hidden');
      box.toggleAttribute('hidden', !show);
      btn.textContent = show ? 'Hide history' : 'History';
      return;
    }
    box = document.createElement('div');
    box.className = 'trail-box';
    box.innerHTML = `<div class="state small">Loading history…</div>`;
    card.appendChild(box);
    btn.textContent = 'Hide history';
    try {
      const data = await api(`activity?id=${encodeURIComponent(btn.dataset.id)}`);
      box.innerHTML = renderTrail(data.activity || []);
    } catch (e) {
      box.innerHTML = `<div class="state small">${escapeHtml(e.message)}</div>`;
    }
  }

  // One delegated listener so "History" works on every card, in every list.
  function onHistoryClick(event) {
    const btn = event.target.closest('button[data-act="history"]');
    if (btn) toggleHistory(btn);
  }

  // ---------- Dashboard wiring ----------

  function bindDashboard() {
    $('#period-prev').addEventListener('click', () => stepPeriod(-1));
    $('#period-next').addEventListener('click', () => stepPeriod(1));
    $('#period-label').addEventListener('click', () => {
      // Tapping the label jumps back to the current month.
      dash.mode = 'month';
      dash.ym = new Date().toISOString().slice(0, 7);
      $('#period-mode').value = 'month';
      $('#dash-range').hidden = true;
      dash.active = null;
      renderDashboard();
    });
    $('#period-mode').addEventListener('change', (e) => {
      dash.mode = e.target.value;
      $('#dash-range').hidden = dash.mode !== 'custom';
      dash.active = null;
      renderDashboard();
    });
    $('#dash-dim').addEventListener('change', (e) => { dash.dim = e.target.value; dash.active = null; renderDashboard(); });
    $('#dash-scope').addEventListener('change', (e) => { dash.scope = e.target.value; dash.active = null; loadDashboard(); });
    $('#range-from').addEventListener('change', (e) => { dash.from = e.target.value; dash.active = null; renderDashboard(); });
    $('#range-to').addEventListener('change', (e) => { dash.to = e.target.value; dash.active = null; renderDashboard(); });
    $('#dash-export').addEventListener('click', exportDashboard);
    const closeModal = () => { dash.active = null; renderDashboard(); };
    $('#detail-close').addEventListener('click', closeModal);
    // Click the dark backdrop (but not the card) to close.
    $('#dash-modal').addEventListener('click', (e) => { if (e.target.id === 'dash-modal') closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && dash.active && state.view === 'dashboard') closeModal(); });
    // Click a donut slice, its label, or a ranked row to drill into that bucket.
    el.dashboard.addEventListener('click', (e) => {
      const hit = e.target.closest('[data-key]');
      if (hit) setActiveBucket(hit.getAttribute('data-key'));
    });
  }

  // ---------- Wire up ----------

  function bind() {
    el.tabs.addEventListener('click', (e) => {
      // The "Management" button opens/closes its dropdown; everything else with
      // a data-view (a normal tab or a menu item) switches to that view.
      if (e.target.closest('#mgmt-btn')) { toggleMgmtMenu(); return; }
      const action = e.target.closest('[data-action]');
      if (action && !action.hidden) {
        if (action.dataset.action === 'rescan') { closeMgmtMenu(); openRescanModal(); }
        return;
      }
      const item = e.target.closest('[data-view]');
      if (item && !item.hidden) switchView(item.dataset.view);
    });
    // Keep the floating sort bar aligned under the top bar as it re-wraps.
    window.addEventListener('resize', updateTopbarVar);
    // The person's name opens the account menu; picking anything closes it.
    $('#acct-btn').addEventListener('click', (e) => { e.stopPropagation(); toggleAcctMenu(); });
    $('#acct-list').addEventListener('click', (e) => {
      if (e.target.closest('.menu-item')) closeAcctMenu();
    });
    // Close either menu when clicking anywhere outside it.
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#mgmt-menu')) closeMgmtMenu();
      if (!e.target.closest('#acct-menu')) closeAcctMenu();
    });
    $('#signout').addEventListener('click', () => signOut('Signed out. See you soon!'));
    $('#lock-unlock').addEventListener('click', unlockWithFaceId);
    $('#lock-google').addEventListener('click', showSignin);
    $('#add-toggle').addEventListener('click', toggleAddForm);
    $('#import-toggle').addEventListener('click', () => setImportOpen($('#import-body').hidden));
    $('#bulk-receipts-btn').addEventListener('click', () => $('#bulk-receipts-input').click());
    $('#bulk-receipts-input').addEventListener('change', onBulkReceipts);
    $('#cancel-edit').addEventListener('click', () => { cancelEdit(); setAddFormOpen(false); });
    el.form.addEventListener('submit', onSubmit);
    el.receiptInput.addEventListener('change', onReceiptChange);
    el.receiptCamera.addEventListener('change', onReceiptChange);
    $('#btn-choose').addEventListener('click', () => el.receiptInput.click());
    $('#btn-camera').addEventListener('click', () => el.receiptCamera.click());
    $('#describe-btn').addEventListener('click', suggestDescription);
    $('#describe-options').addEventListener('click', onDescribeOptionClick);
    $('#f-business').addEventListener('change', recallDescriptions);
    $('#rescan-dates').addEventListener('click', rescanDates);
    $('#rescan-close').addEventListener('click', closeRescanModal);
    $('#rescan-modal').addEventListener('click', (e) => { if (e.target.id === 'rescan-modal') closeRescanModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeRescanModal(); });
    $('#aff-close').addEventListener('click', closeAffidavitModal);
    $('#aff-cancel').addEventListener('click', closeAffidavitModal);
    $('#aff-submit').addEventListener('click', submitAffidavit);
    $('#affidavit-modal').addEventListener('click', (e) => { if (e.target.id === 'affidavit-modal') closeAffidavitModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAffidavitModal(); });
    $('#add-sort').addEventListener('click', onSortClick);
    updateSortHeader();
    $('#new-report-btn').addEventListener('click', createReportPrompt);
    $('#f-report').addEventListener('change', onFormReportChange);
    $('#import-choose').addEventListener('click', () => el.importFile.click());
    $('#import-template').addEventListener('click', downloadTemplate);
    $('#import-copy').addEventListener('click', copyImportInstructions);
    $$('.import-mode .type-btn').forEach((b) => b.addEventListener('click', () => setImportMode(b.dataset.mode)));
    $('#import-commit-btn').addEventListener('click', commitImport);
    $('#import-cancel').addEventListener('click', clearImport);
    el.importFile.addEventListener('change', onImportFile);
    $$('.type-btn').forEach((b) => b.addEventListener('click', () => setExpenseType(b.dataset.type)));
    $('#f-distance').addEventListener('input', updateMileageCalc);
    $('#f-rate').addEventListener('change', updateMileageCalc);
    $('#rate-form').addEventListener('submit', saveRate);
    $('#rate-cancel').addEventListener('click', resetRateForm);
    el.ratesList.addEventListener('click', onRatesClick);
    $('#people-choose').addEventListener('click', () => el.peopleFile.click());
    $('#people-template').addEventListener('click', downloadPeopleTemplate);
    $('#people-copy').addEventListener('click', copyPeopleInstructions);
    el.peopleFile.addEventListener('change', onPeopleFile);
    bindDashboard();
    el.addList.addEventListener('click', onAddListClick);
    el.addList.addEventListener('change', onAddListChange);
    $('#dupes-list').addEventListener('click', onDuplicatesClick);
    el.reportsList.addEventListener('click', onReportsClick);
    el.reportsList.addEventListener('change', onAddListChange);
    el.approvalsList.addEventListener('click', onApprovalsClick);
    el.auditList.addEventListener('click', onAuditClick);
    el.archiveReady.addEventListener('click', onArchiveClick);
    el.archiveReady.addEventListener('change', onArchiveChange);
    // One delegated listener covers "History" toggles on every card, everywhere.
    el.app.addEventListener('click', onHistoryClick);
    const refreshers = {
      add: () => { invalidateReports(); showAddExpense(); },
      mine: () => { invalidateReports(); showReports(); },
      approvals: loadApprovals, audit: loadAudit, dashboard: loadDashboard, archive: loadArchive, timing: loadTiming, rates: loadRates, people: loadPeople,
    };
    $$('[data-refresh]').forEach((b) =>
      b.addEventListener('click', () => (refreshers[b.dataset.refresh] || (() => {}))())
    );
  }

  bind();
  boot();
})();
