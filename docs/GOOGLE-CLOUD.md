# Google Cloud setup — where it lives & how to get back to it

This is the "I'm not going to remember all this" page. If you ever need to find,
check, or change the Google side of Reimbly, everything you need is right here.

> ⚠️ **Fill in your real project name/ID below.** The values shown (`jv-whatever`)
> look like placeholders. Open the console link, copy the real **project name** and
> **project ID** from the top of the page, and paste them in here — or tell me and
> I'll update this file for you. (A project ID is *not* a secret, so it's safe to
> keep in GitHub. The actual keys are not — see "Where the keys live" below.)

---

## The project

| | |
|---|---|
| **Project name** | `jv-whatever` |
| **Project ID** | `jv-whatever-123456` |
| **What it's for** | Lets JV staff sign in to Reimbly with their `@josiahventure.com` Google account |

**Handy links** (open these when you need to look at or change something):

- **Credentials** (the sign-in Client ID) —
  https://console.cloud.google.com/apis/credentials?project=jv-whatever-123456
- **OAuth consent screen** (who's allowed to sign in) —
  https://console.cloud.google.com/auth/overview?project=jv-whatever-123456
- **Console home** for the project —
  https://console.cloud.google.com/home/dashboard?project=jv-whatever-123456

---

## What's turned on

**APIs enabled in the project:** Google **Sheets**, Google **Drive**.

**What Reimbly actually uses today:** just **Google sign-in** (an OAuth *Client ID*).
When someone signs in, Google hands the app a signed "yes, this really is
mel@josiahventure.com" token, and the app checks it's a `@josiahventure.com`
address before letting them in. That's the whole Google footprint in the app.

Sheets and Drive are switched on in the project but the app code doesn't call them
right now. That's fine — leaving them enabled costs nothing and means they're ready
if we ever add, say, "export a report to Google Sheets" or "match receipts from a
Drive folder." No action needed.

**If you've turned on the one-tap "Connect Gmail" receipts button**, this same
project also has the **Gmail API** enabled and a second OAuth client (a *Web
application* one, with a client **secret**). That setup — and the two Netlify
variables it needs (`GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`) — has its
own step-by-step page: **[CONNECT-GMAIL-SETUP.md](CONNECT-GMAIL-SETUP.md)**.

---

## Where the keys live (important)

**The keys are *not* in this GitHub repo, and they should never be.** They live in
**Netlify's environment variables**, so they stay secret and out of the code.

The Google one is:

| Variable | What it is | Where to set it |
|---|---|---|
| `GOOGLE_CLIENT_ID` | The sign-in Client ID (ends in `.apps.googleusercontent.com`) | Netlify → **Site settings → Environment variables** |

> Good news: Google sign-in here uses an **ID token only**, so there is **no client
> secret** to guard. The Client ID isn't really a secret either, but we keep it in
> Netlify with everything else so there's one place to look.

The full list of Reimbly's Netlify variables (Airtable, Anthropic, email, etc.) is
in the main [README](../README.md#4-deploy-on-netlify).

---

## How to rotate / regenerate the sign-in Client ID

Do this if the Client ID is ever exposed or you just want a fresh one. Nothing
breaks for users as long as you do all three steps close together.

1. **Regenerate in the console.** Open the Credentials link above → find the
   `Reimbly web` OAuth client → create a new Client ID (Web application), or edit the
   existing one. Copy the new value (ends in `.apps.googleusercontent.com`).
   - Make sure **Authorized JavaScript origins** lists **both** live addresses —
     `https://reimbly.netlify.app` and the custom domain `https://reimbly.app`
     (see [CUSTOM-DOMAIN.md](CUSTOM-DOMAIN.md)).
2. **Update Netlify.** Netlify → Site settings → Environment variables →
   set `GOOGLE_CLIENT_ID` to the new value → save.
3. **Redeploy.** Netlify → **Deploys → Trigger deploy → Deploy site** so the new
   value takes effect. Then open the site and sign in once to confirm it works.

---

## First-time setup (if you're ever starting from scratch)

The step-by-step for creating the project, the OAuth consent screen, and the Client
ID from nothing is in the main README:
**[README → "2. Google sign-in (OAuth Client ID)"](../README.md#2-google-sign-in-oauth-client-id)**.

This page is the quick reference for the project *once it exists*; the README is the
build-it-from-zero guide.
