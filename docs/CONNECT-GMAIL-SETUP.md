# Turning on the one-tap "Connect Gmail" button (admin, one time)

This is the walkthrough for Mel. Do this **once for the whole organization** and
every JV staff member gets a single **Connect Gmail** button in Reimbly — no
scripts, no copy-pasting, nothing for them to install. They tap it, approve on
Google's own screen, and their receipts start filing themselves within the hour.

You only need to do this one time. It takes about 15 minutes and it's all in the
Google Cloud console you already use for sign-in.

> **Why this is safe and simple for us:** JV is a single Google Workspace, so we
> can keep this app **Internal**. That means Google does *not* put us through its
> long "restricted scope" security review — the button just works for anyone with
> a `@josiahventure.com` account, and nobody outside JV can use it.

---

## What you'll end up with

Two new values that go into Netlify (just like the other keys):

| Netlify variable | What it is |
|---|---|
| `GMAIL_OAUTH_CLIENT_ID` | The new OAuth client's ID (ends in `.apps.googleusercontent.com`) |
| `GMAIL_OAUTH_CLIENT_SECRET` | Its secret (this one **is** secret — keep it in Netlify only) |

Once those two are in Netlify and you redeploy, the **Connect Gmail** button
appears for everyone automatically. Until they're set, Reimbly quietly shows the
old manual instructions instead — so nothing breaks in the meantime.

---

## Step by step

Everything below is in the same project you use for Google sign-in. Open the
Google Cloud console first: <https://console.cloud.google.com/> and make sure the
project selector at the top says the JV Reimbly project (the same one in
[GOOGLE-CLOUD.md](GOOGLE-CLOUD.md)).

### 1. Turn on the Gmail API

1. Go to **APIs & Services → Library**:
   <https://console.cloud.google.com/apis/library>
2. Search for **Gmail API**, click it, and click **Enable**.
   (If it's already enabled it'll just say "Manage" — that's fine.)

### 2. Make sure the consent screen is "Internal"

1. Go to **APIs & Services → OAuth consent screen** (Google may call this
   "Google Auth Platform → Audience"):
   <https://console.cloud.google.com/auth/audience>
2. It should say **User type: Internal**. If it does, you're done here — skip to
   step 3.
3. If it says *External*, click **Make internal** (or, on the older screen,
   pick **Internal** and Save). Internal is what keeps us out of Google's
   security review.

### 3. Add the Gmail permission to the consent screen

1. Still under the OAuth consent screen, open **Data access** (older console:
   the **Scopes** step).
2. Click **Add or remove scopes**.
3. In the filter box paste this exact scope and check its box:
   ```
   https://www.googleapis.com/auth/gmail.readonly
   ```
   (It reads as "View your email messages and settings." Read-only — Reimbly can
   never send, delete, or change mail.)
4. Click **Update**, then **Save**.

### 4. Create the OAuth client (the button's ID + secret)

1. Go to **APIs & Services → Credentials**:
   <https://console.cloud.google.com/apis/credentials>
2. Click **+ Create credentials → OAuth client ID**.
3. **Application type:** choose **Web application**.
4. **Name:** something you'll recognize, e.g. `Reimbly Gmail receipts`.
5. Under **Authorized redirect URIs**, click **+ Add URI** and paste **exactly**:
   ```
   https://reimbly.netlify.app/api/gmail-callback
   ```
   - If Reimbly lives at a different address (a custom domain), use that address
     instead, keeping the `/api/gmail-callback` on the end.
   - This has to match to the letter — a trailing slash or `http` vs `https` will
     make Google refuse the connection.
6. Click **Create**. Google shows you a **Client ID** and a **Client secret** —
   leave this box open for the next step (or copy both somewhere safe for a
   minute).

### 5. Put the two values into Netlify

1. Open Netlify → your Reimbly site → **Site settings → Environment variables**.
2. Add two variables:
   - `GMAIL_OAUTH_CLIENT_ID` = the Client ID from step 4 (ends in
     `.apps.googleusercontent.com`)
   - `GMAIL_OAUTH_CLIENT_SECRET` = the Client secret from step 4
3. Save.

### 6. Redeploy so it takes effect

Netlify → **Deploys → Trigger deploy → Deploy site**. Wait for it to go green.

### 7. Try it

1. Open Reimbly, go to the account menu → **Email receipts**.
2. You should now see a **Connect Gmail** button. Tap it.
3. Google shows its own approval screen (with your JV account and the read-only
   Gmail permission). Approve it.
4. It bounces you back to Reimbly with "Gmail connected." Within the hour, receipts
   in your mail start appearing in your **Receipts waiting from email** box on the
   Add-expense tab.

That's it — every other staff member now has the same one-tap button.

---

## Good to know

- **Read-only, receipts only.** Reimbly only ever *reads* mail, and the hourly
  worker only looks at receipt/invoice-looking messages — not someone's personal
  email. It skips marketing, order confirmations, and terms-and-conditions.
- **Each person opts in for themselves.** The button does nothing until *they*
  tap it and approve. Nobody's mailbox is touched otherwise.
- **Anyone can disconnect anytime** — the same panel has a **Disconnect Gmail**
  button, and they can also remove it from their Google account's
  "Third-party access" page. Reimbly immediately stops reading their mail.
- **How it's stored:** each person's permission (a "refresh token") is encrypted
  before it's saved on their Staff record in Airtable, using the client secret as
  the key. Even someone looking at the database can't read it.
- **If you ever rotate the client secret**, update `GMAIL_OAUTH_CLIENT_SECRET` in
  Netlify and redeploy. Everyone will need to tap **Connect Gmail** once more,
  because the old stored permissions can no longer be unlocked.

## The technical bits (for whoever maintains the code)

- Front end: the **Email receipts** panel (`#emailintake-modal`) shows one of
  three states from `me` — connected, one-tap available, or manual fallback.
- `POST /api/gmail-connect` → returns Google's consent URL (signed `state`).
- `GET /api/gmail-callback` → trades the code for a refresh token, encrypts it,
  stores it on the Staff record, flips **Email Intake** on, redirects to
  `/?gmail=connected`.
- `POST /api/gmail-disconnect` → revokes at Google, clears the stored token.
- `gmail-poll` (scheduled hourly in `netlify.toml`) reads new receipt-looking mail
  for every connected person and files it through the shared `intakeReceipts` core.
- Libraries: `lib/gmail.js` (Google API calls), `lib/secure.js` (token encryption +
  signed state), `lib/intake.js` (the shared "turn a receipt into an expense" core,
  also used by the older forward-by-email path).
