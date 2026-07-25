# Reimbly

A warm, simple expenses app for Josiah Venture. Staff sign in with their Google
account, snap a receipt, and submit in under a minute. They track their own
expenses; approvers approve right in the app; everything lands in Airtable.

**Stack:** static front-end (Netlify) → serverless functions (Netlify) → Airtable (data).
No server to babysit, no per-seat SaaS fees, and your Airtable key never touches the browser.

```
Browser (index.html + app.js)
        │  Google ID token (Bearer)
        ▼
Netlify Functions  ──►  verify Google sign-in (@josiahventure.com)
  /api/config              │
  /api/me                  ▼
  /api/submit-expense   Airtable REST + content API  ──►  "JV Expenses" base
  /api/my-expenses
  /api/approvals
  /api/decision
```

---

## What you'll need (one-time, ~20 minutes)

1. An **Airtable Personal Access Token**
2. A **Google OAuth Client ID**
3. This repo pushed to **GitHub**
4. A **Netlify** site connected to that repo

Follow the four sections below in order.

---

### 1. Airtable token

1. Go to https://airtable.com/create/tokens → **Create token**.
2. Name it `Reimbly app`.
3. Scopes: `data.records:read`, `data.records:write`, `schema.bases:read`.
4. Access: add the **JV Expenses** base.
5. Create it and copy the token (starts with `pat…`). You'll paste it into Netlify in step 4.

The base ID is already set for you: `appquqkhFfrnoU6v9`.

### 2. Google sign-in (OAuth Client ID)

1. Go to https://console.cloud.google.com/ → create a project (or reuse one), e.g. `Reimbly`.
2. **APIs & Services → OAuth consent screen** → choose **Internal** (so only
   @josiahventure.com accounts can use it) → fill in the app name and your support email → save.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
4. Application type: **Web application**. Name: `Reimbly web`.
5. Under **Authorized JavaScript origins**, add (you can add the Netlify URL now and
   update after your first deploy):
   - `http://localhost:8888` (for local testing)
   - `https://YOUR-SITE.netlify.app`
   - your custom domain later, e.g. `https://expenses.josiahventure.com`
6. Create it and copy the **Client ID** (ends in `.apps.googleusercontent.com`).

> You do **not** need a client secret — the app uses Google's ID-token sign-in only.

### 3. Push to GitHub

```bash
cd reimbly
git init
git add .
git commit -m "Reimbly app"
git branch -M main
git remote add origin https://github.com/YOUR-ORG/reimbly.git
git push -u origin main
```

### 4. Deploy on Netlify

1. https://app.netlify.com → **Add new site → Import an existing project** → pick the repo.
2. Build settings are read from `netlify.toml` automatically — just click **Deploy**.
3. Once deployed, go to **Site settings → Environment variables** and add four:

   | Key | Value |
   |---|---|
   | `AIRTABLE_TOKEN` | your `pat…` token from step 1 |
   | `AIRTABLE_BASE_ID` | `appquqkhFfrnoU6v9` |
   | `GOOGLE_CLIENT_ID` | your `…apps.googleusercontent.com` from step 2 |
   | `ALLOWED_DOMAIN` | `josiahventure.com` |
   | `ANTHROPIC_API_KEY` | *(optional)* enables receipt auto-fill — see below |

4. **Deploys → Trigger deploy → Deploy site** so the new variables take effect.
5. Copy your live URL (e.g. `https://reimbly.netlify.app`) and add it back into
   Google (step 2.5) under Authorized JavaScript origins.

Open the URL, sign in with your JV Google account, and submit a test expense. 🎉

---

## Airtable base

The **JV Expenses** base (`appquqkhFfrnoU6v9`) is already built with everything
Reimbly needs — you don't create anything. It's a relational base: an expense
**links** to the person, category, and currency rather than storing them as loose
text, and it converts to USD automatically. Reimbly matches this structure exactly.

The tables it uses:

**`Staff`** — people who submit and approve.
`Name`, `Email`, `Role` (single select: `Staff` / `Approver` / `Finance`).
Everyone gets a `Staff` record automatically the first time they sign in.

**`Expenses`** — one row per expense. Reimbly writes these on submit:

| Field | How Reimbly uses it |
|---|---|
| `Description` | The short description from the form. |
| `Expense Date` | Date the expense happened. |
| `Amount` | Amount in the original currency. |
| `Currency` | **Linked** to the Currencies table (drives the USD formula). |
| `Category` | **Linked** to the Categories table (falls back to "Other"). |
| `Submitter` | **Linked** to the submitter's Staff record. |
| `Payment Method` | Defaults to `Personal funds (reimburse me)`. |
| `Status` | `Submitted` → `Approved` / `Rejected` on a decision. |
| `Receipt` | The uploaded photo or PDF. |
| `Submitted On` | Stamped on submit. |
| `Approver` / `Decided On` / `Approver Note` | Stamped when an approver decides. |
| `Amount (USD)` | **Formula** — `Amount × Rate to USD`, computed by the base. Reimbly never writes it. |
| `Submitter Email` | **Lookup** from the linked Staff record. Reimbly filters "My expenses" on this. |

**`Currencies`** — `Code`, `Rate to USD` (USD value of one unit), kept current by
the weekly rate automation. **`Categories`** — `Category` + `GL Code` for
accounting. **`Teams`** — teams/projects a spend can be charged to.

> "Send back" in the approver view sets the expense to **`Rejected`** and writes an
> **`Approver Note`** so the submitter sees what to fix and can resubmit.

---

## Reading receipts automatically (optional)

When `ANTHROPIC_API_KEY` is set, picking a receipt photo (or PDF) on the Submit
screen sends it to Claude's vision model, which reads it and **fills in the
amount, currency, date, description, and a best-fit category** for the person to
check and submit. It handles receipts in Czech, Polish, German, and other
languages, and translates the description to English.

- Get a key at <https://console.anthropic.com/settings/keys> and add it as the
  `ANTHROPIC_API_KEY` environment variable in Netlify, then redeploy.
- The key is a secret — it lives only in Netlify's environment (every scan
  request first verifies the JV sign-in, so only staff can use it).
- Cost is a fraction of a cent per receipt. Leave the key unset to turn the
  feature off — the app works exactly the same, people just type the fields in.
- `SCAN_MODEL` (optional) sets the model. Default `claude-opus-4-8` (most
  accurate); set `claude-haiku-4-5` for faster, cheaper scans.

---

## Email notifications (optional)

Rembly can email people the moment something needs them, so nobody has to keep
checking the app:

- **A new expense to approve** → the submitter's upline (approver) gets an email.
- **Approved** → the submitter is told.
- **Sent back** → the submitter gets the note explaining what to fix.
- **Reimbursed** → the submitter is told they've been paid.

It's off until you add a mail key, and every send is best-effort — a failed
email never blocks the expense from going through.

- Sign up at <https://resend.com> (free tier is plenty), verify your
  `josiahventure.com` domain, and create an API key.
- Add these environment variables in Netlify, then redeploy:

  | Key | Value |
  |---|---|
  | `RESEND_API_KEY` | your `re_…` key from Resend |
  | `NOTIFY_FROM` | *(optional)* the sender, e.g. `Rembly <rembly@josiahventure.com>` (must be on a verified domain) |
  | `APP_URL` | *(optional)* your live URL, so the email's button links back — e.g. `https://reimbly.netlify.app` |

- Leave `RESEND_API_KEY` unset to keep notifications off — the app works exactly
  the same, people just check the app themselves.

### Filing receipts from your email (optional)

Rembly can find the receipts and invoices already in your Gmail — and new ones
as they arrive — and file them for you as Submitted expenses, with the amount,
date, merchant, and account read off each receipt by Claude. It runs from a
small script in your own Google account, so nothing else sees your mail. Full
setup (about 10 minutes) is in **[docs/EMAIL-RECEIPTS.md](docs/EMAIL-RECEIPTS.md)**;
it needs `INBOUND_EMAIL_SECRET` set in Netlify alongside `ANTHROPIC_API_KEY`.

### iPhone / phone push alerts (optional)

On top of email, Rembly can pop a notification straight onto someone's phone the
same moment — approver gets "new expense to approve", submitter gets approved /
sent-back / reimbursed. It uses the same four moments as email.

Turning it on:

1. **Make VAPID keys once.** On any computer with Node: `npx web-push generate-vapid-keys`.
   You get a **public** key and a **private** key.
2. Add these environment variables in Netlify, then redeploy:

   | Key | Value |
   |---|---|
   | `VAPID_PUBLIC_KEY` | the public key from step 1 |
   | `VAPID_PRIVATE_KEY` | the private key from step 1 (secret) |
   | `VAPID_SUBJECT` | a contact, e.g. `mailto:it@josiahventure.com` |

3. In the app, each person taps **"Turn on alerts"** (top-right) on the device
   they want to be notified on, and allows notifications.

**On iPhone there's one extra step Apple requires:** open Rembly in Safari, tap
the **Share** button → **Add to Home Screen**, then open Rembly from that new
home-screen icon and tap "Turn on alerts". (iOS only delivers web push to apps
added to the Home Screen, on iOS 16.4 or newer.) Android and desktop browsers
work right in the browser with no extra step.

Leave the VAPID keys unset to keep push off — email (or neither) still works.

---

## Set who can approve

Approving is controlled by the **Role** field in the **Staff** table of the base:

- `Staff` — can submit and see their own expenses (this is the default for everyone).
- `Approver` — also sees the **Approvals** tab and can approve / send back.
- `Finance` — same as Approver (use this label for your finance team).

Everyone gets a Staff record automatically the first time they sign in. To make
someone an approver, open the base → **Staff** table → set their **Role** to `Approver`
or `Finance`. No redeploy needed.

> **v1 approval model:** anyone with an Approver/Finance role sees all submitted
> expenses. When you're ready, we can switch to manager-based routing that reads your
> existing **JV Organizational Chart** base, so each expense goes to the right person.

---

## Gentle reminders (keep expenses on time)

Set these up as **Airtable Automations** (base → Automations → Create automation).
They're free, reliable, and need no code.

**A. Nudge approvers about anything waiting too long**
- Trigger: **At a scheduled time** → weekly (e.g. Monday 8am).
- Action: **Find records** → Expenses where `Status` is `Submitted` **and** `Submitted On`
  is before *5 days ago*.
- Action: **Send email** → to your approvers/finance address → include the list of found
  records. Subject: "Expenses waiting for approval". Only sends if any are found.

**B. Nudge finance to reimburse approved expenses**
- Trigger: weekly (or daily).
- Find records where `Status` is `Approved` and `Decided On` is before *3 days ago*.
- Send email to finance with the list, subject "Approved — ready to reimburse".

**C. (Optional) Thank + confirm on approval**
- Trigger: **When a record matches conditions** → `Status` becomes `Approved`.
- Send email to `Submitter Email` → "Your expense was approved and is being reimbursed."

You can tune the day counts to your rhythm. These three cover the whole loop:
submitted → approved → reimbursed, with a nudge at each hand-off.

---

## Local development (optional)

```bash
npm install
npm i -g netlify-cli
netlify dev          # serves the site + functions at http://localhost:8888
```
Create a local `.env` from `.env.example` for local testing (never commit it).

---

## Notes & safety

- The Airtable token lives **only** in Netlify's environment — never in the browser or the repo.
- Every function verifies the Google sign-in and rejects anyone outside `@josiahventure.com`.
- Receipts upload straight to the Airtable record; the browser never holds a permanent copy.
- Amounts convert to USD automatically using the rates in the **Currencies** table
  (kept current by the weekly rate automation from the earlier setup guide).

## Where this goes next

- **Manager-based approval routing** using the JV Org Chart base.
- **Budget visibility** — link to Division Budget Overview / IRD Budget 2026 so leaders
  see spend-against-budget live.
- **Accounting export** — a monthly export mapped to your GL codes once the accounting
  system is confirmed.
- **One JV sign-in** — the same Google login can front every internal app you build next.
