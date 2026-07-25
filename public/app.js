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

  function enterApp() {
    el.signin.hidden = true;
    el.lock.hidden = true;
    el.app.hidden = false;
    saveSession(); // remember this session so Face ID can restore it
    updateFaceIdToggle();
    updatePushToggle();
    el.whoName.textContent = state.me.name;
    el.whoRole.textContent = state.me.role;

    $('.tab[data-view="approvals"]').hidden = !state.me.canApprove;
    $('.tab[data-view="audit"]').hidden = !state.me.canApprove;
    $('.tab[data-view="dashboard"]').hidden = !state.me.canApprove;
    $('.tab[data-view="archive"]').hidden = !state.me.canApprove;
    $('.tab[data-view="rates"]').hidden = state.me.role !== 'Finance';
    $('.tab[data-view="people"]').hidden = state.me.role !== 'Finance';

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
    if (view === 'rates' && !state.loaded.rates) loadRates();
    if (view === 'people' && !state.loaded.people) loadPeople();
    if (view === 'import') loadInbox();
  }

  // ---------- Receipt inbox (held email receipts) ----------

  async function loadInbox() {
    const panel = $('#inbox-panel');
    const list = $('#inbox-list');
    if (!panel || !list) return;
    try {
      const data = await api('receipt-inbox');
      const receipts = data.receipts || [];
      if (!receipts.length) { panel.hidden = true; return; }
      panel.hidden = false;
      list.innerHTML = receipts.map(inboxRowHtml).join('');
      list.querySelectorAll('[data-discard]').forEach((btn) => {
        btn.onclick = () => discardHeld(btn.getAttribute('data-discard'));
      });
    } catch (e) {
      panel.hidden = true;
    }
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
          <div class="ir-meta">${escapeHtml([fmtDate(r.date) || 'no date', 'held from email'].filter(Boolean).join(' · '))}</div>
        </div>
        <button type="button" class="link-btn" data-discard="${escapeHtml(r.id)}">Discard</button>
      </div>`;
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

    el.submitBtn.disabled = true;
    el.submitBtn.textContent = editing ? 'Saving…' : 'Submitting…';

    try {
      if (file) {
        body.receipt = {
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          base64: await readFileAsBase64(file),
        };
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
    $('.type-toggle').hidden = false;
    $('#mileage-calc').hidden = true;
    setExpenseType('receipt');
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
    const act = btn.dataset.act;
    if (act === 'toggle') {
      const card = btn.closest('.expense');
      const details = $('.mini-details', card);
      const open = details.hasAttribute('hidden');
      details.toggleAttribute('hidden', !open);
      btn.setAttribute('aria-expanded', String(open));
      card.classList.toggle('open', open);
      return;
    }
    const id = btn.dataset.id;
    if (act === 'edit') startEdit(id);
    else if (act === 'delete') {
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

  function statusDot(status) {
    const key = String(status || '').toLowerCase().replace(/[^a-z]/g, '');
    const known = ['draft', 'submitted', 'approved', 'rejected', 'reimbursed'];
    const cls = known.includes(key) ? key : 'submitted';
    return `<span class="dot ${cls}" title="${escapeHtml(status || 'Submitted')}"></span>`;
  }

  // How the expense got into Rembly: typed, from email, or an import.
  const SOURCE_META = {
    Manual: ['✍️', 'Manual'],
    Email: ['📧', 'Email'],
    CSV: ['📄', 'CSV'],
    YNAB: ['📊', 'YNAB'],
  };
  function sourceBadge(src) {
    const meta = SOURCE_META[src];
    if (!meta) return '';
    return `<span class="src-badge src-${src.toLowerCase()}">${meta[0]} ${escapeHtml(meta[1])}</span>`;
  }
  function sourceDot(src) {
    const meta = SOURCE_META[src];
    if (!meta) return '';
    return `<span class="mini-src" title="Added: ${escapeHtml(meta[1])}">${meta[0]}</span>`;
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

  function renderMine(expenses) {
    if (!expenses.length) {
      el.mineList.innerHTML = `<div class="state"><span class="emoji">🌱</span>No expenses yet. Submit your first one above!</div>`;
      return;
    }
    el.mineList.innerHTML = expenses.map((e) => {
      const editable = EDITABLE.includes(e.status);
      const who = e.merchant || e.description || '(no description)';
      const amt = e.amountUsd != null ? money(e.amountUsd, 'USD') : money(e.amount, e.currency);
      const mileageMeta = e.distance != null && e.mileageRate != null
        ? `<div class="expense-meta">${escapeHtml(`${e.distance} ${e.distanceUnit} × ${money(e.mileageRate, e.currency)}`)}</div>`
        : '';
      return `
      <article class="expense mini" data-id="${escapeHtml(e.id)}">
        <button type="button" class="mini-row" data-act="toggle" aria-expanded="false">
          <span class="mini-date">${escapeHtml(fmtDateShort(e.date))}</span>
          <span class="mini-who">${escapeHtml(who)}</span>
          <span class="mini-amt">${escapeHtml(amt)}</span>
          ${sourceDot(e.source)}
          ${statusDot(e.status)}
          <span class="mini-caret" aria-hidden="true">▾</span>
        </button>
        <div class="mini-details" hidden>
          <div class="mini-desc">${cardTitle(e)}</div>
          <div class="expense-meta">${cardMeta(e, [e.account || e.category, fmtDate(e.date)])}</div>
          ${mileageMeta}
          <div class="expense-actions">
            ${statusBadge(e.status)}
            ${sourceBadge(e.source)}
            ${receiptLink(e)}
            ${historyBtn(e.id)}
            ${editable ? `<button class="link-btn" data-act="edit" data-id="${escapeHtml(e.id)}">Edit</button>` : ''}
            ${editable ? `<button class="link-btn danger" data-act="delete" data-id="${escapeHtml(e.id)}">Delete</button>` : ''}
          </div>
          ${e.status === 'Rejected' && e.notes ? `<div class="expense-note">↩︎ ${escapeHtml(e.notes)}</div>` : ''}
        </div>
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
          ${historyBtn(e.id)}
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
    add: 'Upload your budget export (YNAB works — Date, Payee, Outflow, Memo). Rembly turns each row into an expense and automatically attaches the matching receipt from your email. It flags duplicates and lets you review before anything is added.',
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
      html += `<p class="import-note">Tick the ones to add. They come in as Submitted expenses (add receipts after).</p>`;
      html += missing.map(importRowHtml).join('');
    }
    if (matched.length) {
      html += `<details class="import-help"><summary>✓ Already captured (${matched.length})</summary>${
        matched.map((m) => reconcileLine(m, `matched to your ${escapeHtml(m.matchedTo.status || 'submitted').toLowerCase()} expense`)).join('')
      }</details>`;
    }
    if (extra.length) {
      html += `<details class="import-help"><summary>In Rembly but not on your budget list (${extra.length})</summary>${
        extra.map((x) => reconcileLine(x, escapeHtml((x.status || '').toLowerCase()))).join('')
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
      state.loaded.mine = false;
      state.loaded.audit = false;
      state.loaded.dashboard = false;
      switchView('mine');
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
    'Name,Email,Role,Upline,Accounts\n' +
    'Dana Director,director@josiahventure.com,Finance,,\n' +
    'Mel Ellenwood,mel@josiahventure.com,Approver,director@josiahventure.com,"9100000, 9200000"\n' +
    'Jana Novak,jana@josiahventure.com,Staff,mel@josiahventure.com,\n';

  const PEOPLE_INSTRUCTIONS = [
    'Build me a CSV of our people with ONE row per person and a header row using exactly these columns:',
    '',
    'Name, Email, Role, Upline, Accounts',
    '',
    '- Name: the person’s full name.',
    '- Email: their Josiah Venture email (this is how people are matched).',
    '- Role: one of Staff, Approver, or Finance.',
    '- Upline: the email of the person who approves their expenses (leave blank for top-level people).',
    '- Accounts: only for people who may use restricted general-fund accounts — the GL codes separated by commas (e.g. "9100000, 9200000"). Leave blank for everyone else.',
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
    Submitted: '📝', Approved: '✅', 'Sent back': '↩︎', 'Kicked back': '↩︎',
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

  // ---------- Wire up ----------

  function bind() {
    el.tabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.tab');
      if (tab && !tab.hidden) switchView(tab.dataset.view);
    });
    $('#signout').addEventListener('click', () => signOut('Signed out. See you soon!'));
    $('#lock-unlock').addEventListener('click', unlockWithFaceId);
    $('#lock-google').addEventListener('click', showSignin);
    $('#cancel-edit').addEventListener('click', cancelEdit);
    el.form.addEventListener('submit', onSubmit);
    el.receiptInput.addEventListener('change', onReceiptChange);
    el.receiptCamera.addEventListener('change', onReceiptChange);
    $('#btn-choose').addEventListener('click', () => el.receiptInput.click());
    $('#btn-camera').addEventListener('click', () => el.receiptCamera.click());
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
    el.mineList.addEventListener('click', onMineClick);
    el.approvalsList.addEventListener('click', onApprovalsClick);
    el.auditList.addEventListener('click', onAuditClick);
    el.archiveReady.addEventListener('click', onArchiveClick);
    // One delegated listener covers "History" toggles on every card, everywhere.
    el.app.addEventListener('click', onHistoryClick);
    const refreshers = { mine: loadMine, approvals: loadApprovals, audit: loadAudit, dashboard: loadDashboard, archive: loadArchive, rates: loadRates, people: loadPeople };
    $$('[data-refresh]').forEach((b) =>
      b.addEventListener('click', () => (refreshers[b.dataset.refresh] || (() => {}))())
    );
  }

  bind();
  boot();
})();
