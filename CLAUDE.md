# Working notes for Reimbly

Reimbly (aka "Rembly") is a warm, simple expense-reimbursement app for Josiah
Venture. Static front-end + Netlify Functions + Airtable. See the
[README](README.md) for the stack and setup. Mel Ellenwood is the owner and is
non-technical — explain things plainly and keep the app's wording human.

## Project conventions

### Always document external services (standing rule)

**Whenever setup involves going to an outside website or account — Google Cloud,
Airtable, Netlify, Anthropic, Resend, a Google Apps Script, a new API, anything —
write it down so Mel can find it again.** He should never have to remember where
something was configured.

Concretely, any time an external service is added or changed:

1. Add or update its entry in **[docs/EXTERNAL-SERVICES.md](docs/EXTERNAL-SERVICES.md)**
   — the master "where do I log in?" map. Include: what it's for, the sign-in/console
   link, and which Netlify environment variable holds its key.
2. If it needs more than a couple lines (setup steps, how to rotate keys), give it
   its own `docs/<SERVICE>.md` and link it from both the index and the README.
3. **Never commit secret keys.** Keys live in Netlify env vars only. It's fine to
   record non-secret identifiers (project IDs, base IDs, console URLs) in the repo.

The goal: if Mel opens GitHub, he can always trace every outside piece the app
relies on and get back to it.
