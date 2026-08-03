# External accounts & services — the "where do I log in?" map

Every outside website Reimbly depends on, in one place, so you never have to
remember where you set something up. For each one: what it's for, where to sign
in, and where its keys live. **None of the actual keys are in GitHub** — they all
live in Netlify's environment variables, kept secret and out of the code.

> 🔑 **The golden rule:** the code is in GitHub; the secret keys are in **Netlify**
> (Site settings → Environment variables). If you ever change a key on one of the
> sites below, update it in Netlify and redeploy.

---

## The services

### 1. GitHub — the code
- **What:** stores all of Reimbly's code (this repo, `melnwood/reimbly`).
- **Sign in:** https://github.com/melnwood/reimbly
- **Keys:** none to manage here.

### 2. Netlify — hosting & the keys
- **What:** runs the website and the little serverless functions, and holds every
  secret key as an environment variable. This is the one place all keys live.
- **Sign in:** https://app.netlify.com → your Reimbly site
- **Where the keys live:** **Site settings → Environment variables**
- **After changing any key:** **Deploys → Trigger deploy → Deploy site**

### 3. Airtable — the database
- **What:** where all the expense data actually lives (the **JV Expenses** base).
- **Sign in:** https://airtable.com → base `appquqkhFfrnoU6v9`
- **Manage the key:** https://airtable.com/create/tokens
- **Netlify variables:** `AIRTABLE_TOKEN`, `AIRTABLE_BASE_ID`
- **At scale:** great for JV now, but not the long-term store for ~200 ministries —
  see [DATA-AT-SCALE.md](DATA-AT-SCALE.md) for the why and the migration path.

### 4. Google Cloud — sign-in
- **What:** lets JV staff sign in with their `@josiahventure.com` Google account.
- **Sign in:** https://console.cloud.google.com/
- **Netlify variable:** `GOOGLE_CLIENT_ID`
- **Full details & how to rotate:** **[docs/GOOGLE-CLOUD.md](GOOGLE-CLOUD.md)**

### 5. Google — "Connect Gmail" receipts (one-tap OAuth)
- **What:** the one-tap **Connect Gmail** button in Reimbly. Each person connects
  their own Gmail; a scheduled worker reads receipt-looking mail hourly and files
  it. No scripts to install. Set up once for the whole org.
- **Sign in:** https://console.cloud.google.com/ → the JV Reimbly project
  (Gmail API + an **Internal** OAuth "Web application" client)
- **Netlify variables:** `GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`
  (the secret also encrypts each person's stored permission)
- **Redirect URI to register:** `https://reimbly.netlify.app/api/gmail-callback`
- **Admin setup, step by step:** **[docs/CONNECT-GMAIL-SETUP.md](CONNECT-GMAIL-SETUP.md)**
- **How it works for people:** **[docs/EMAIL-RECEIPTS.md](EMAIL-RECEIPTS.md)**

### 5b. Google Apps Script — receipts from Gmail (older fallback)
- **What:** the original small script in your Google Workspace that forwards
  receipts into Reimbly, hourly. Still works; the one-tap button above is simpler.
- **Sign in:** https://script.google.com → the `gmail-to-rembly` project
- **Netlify variable:** `INBOUND_EMAIL_SECRET` (must match `SECRET` in the script)
- **Full details:** **[docs/EMAIL-RECEIPTS.md](EMAIL-RECEIPTS.md)**

### 6. Anthropic (Claude) — reads the receipts
- **What:** the AI that reads a receipt photo/PDF and fills in the amount, date,
  and merchant automatically.
- **Sign in:** https://console.anthropic.com/settings/keys
- **Netlify variables:** `ANTHROPIC_API_KEY`, `SCAN_MODEL` *(optional — picks the model)*

### 7. Resend — sends notification emails
- **What:** sends the "you have an expense to approve / your expense was paid"
  emails.
- **Sign in:** https://resend.com → API Keys
- **Netlify variables:** `RESEND_API_KEY`, `NOTIFY_FROM`

### 8. Web Push (VAPID) — phone notifications
- **What:** the browser push notifications. There's **no website to log into** —
  the keys are generated once with a command (`npx web-push generate-vapid-keys`).
- **Netlify variables:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`

### 9. Sage Intacct — accounting (future / not live yet)
- **What:** the planned hand-off of approved expenses to Cedarstone's accounting
  system. Not turned on yet.
- **Reference:** https://developer.intacct.com/api/
- **Full notes:** **[docs/INTACCT-INTEGRATION.md](INTACCT-INTEGRATION.md)**

---

## If you're ever setting one up from scratch
The step-by-step first-time instructions are in the main
**[README](../README.md)** (Airtable, Google, and Netlify) and in the linked docs
above (email, Intacct). This page is the quick "where does it live" map for
services that already exist.
