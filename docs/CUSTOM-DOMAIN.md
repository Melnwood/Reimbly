# Custom domain — reimbly.app

**Decision:** use **`reimbly.app`** as Reimbly's main address (see the reasoning
below). This replaces `reimbly.netlify.app` as the address people use and sign in
with; the Netlify address keeps working underneath either way.

> The other domains you registered (`reimbly.org`, `reimbly.info`, `reimbly.pro`,
> `reimbly.vip`, …) don't need any setup — leave them unused, or point them to
> redirect to `reimbly.app` later so nobody lands on a dead page if they guess wrong.

## Why `.app`

- **It says what it is.** `.app` is a domain built specifically for applications —
  exactly what Reimbly is.
- **Security is built in.** `.app` domains require HTTPS everywhere (enforced by the
  registry), so it can't accidentally be reached over an insecure connection.
- **Short and trustworthy.** `.info`/`.pro`/`.vip` read as lower-trust/spam-adjacent;
  `.org` reads as "organization site" rather than "app." `.app` is the clean fit.

## The steps (in order — each matters)

### 1. Add the domain in Netlify
1. Netlify → your Reimbly site → **Domain management** (or **Domain settings**).
2. **Add a custom domain** → type `reimbly.app` → follow the prompts.
3. Netlify will show you **DNS records to add** (usually an `A` record and/or a
   `CNAME`, or it may offer to be your domain's nameserver — either works; **using
   Netlify DNS is simplest** if your registrar allows changing nameservers).

### 2. Point the domain at Netlify (at your registrar)
Wherever `reimbly.app` is registered (the domains list you shared):
- **Simplest: switch to Netlify's nameservers.** Netlify manages DNS for you from
  then on — no manual records to keep in sync.
- **Or: add the specific DNS records Netlify shows you** (an `A` record pointing to
  Netlify's load balancer, plus a `CNAME` for `www`) directly in your registrar's DNS
  settings for `reimbly.app`.
- DNS changes can take anywhere from a few minutes to a few hours to take effect.

### 3. Set it as the primary domain in Netlify
Once it shows verified/connected, in Netlify's Domain management mark
**`reimbly.app` as the primary domain**. Netlify auto-provisions the HTTPS
certificate — no extra step.

### 4. Tell Reimbly its own address (one environment variable)
Netlify → **Site settings → Environment variables** → add:

| Variable | Value |
|---|---|
| `APP_URL` | `https://reimbly.app` |

The app already reads this everywhere it needs its own address (email links, the
Gmail-connect return trip) — this is the only code-facing step, and it's just a
setting, not a code change. Then **redeploy** (Deploys → Trigger deploy).

### 5. Update Google Cloud (sign-in + Gmail connect)
Two places, both in the Google Cloud console
(see [GOOGLE-CLOUD.md](GOOGLE-CLOUD.md)):
1. **OAuth client → Authorized JavaScript origins** — add `https://reimbly.app`
   (keep `https://reimbly.netlify.app` too, so both keep working).
2. **If Gmail "Connect" is set up** ([CONNECT-GMAIL-SETUP.md](CONNECT-GMAIL-SETUP.md)) —
   its OAuth client's **Authorized redirect URIs** needs
   `https://reimbly.app/api/gmail-callback` added alongside the existing one.

### 6. Try it
Open `https://reimbly.app`, sign in, and confirm everything looks and works the
same. Keep `reimbly.netlify.app` working as a fallback — don't remove it.

## Notes
- **No code changes needed** — the app already takes its own address from `APP_URL`.
- The site keeps working at `reimbly.netlify.app` even after `reimbly.app` is live;
  people can use either address until you're ready to point everyone at the new one.
- Bookmarks/PWA installs on `reimbly.netlify.app` keep working — only the future
  sign-in / email links use the new address once `APP_URL` is updated.
