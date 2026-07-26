# Data at scale — is Airtable the right foundation?

Short version: **Airtable is the right choice for now and genuinely good for it —
but it is not the foundation to run 200 ministries on long-term.** Plan to
graduate the *storage* (not the app) once several organizations are really using
Rembly. The code is already built so that graduation is a contained job.

## How it works today

- All of Josiah Venture's data lives in **one Airtable base** (think: one big smart
  spreadsheet workbook) — the `AIRTABLE_BASE_ID` env var in Netlify.
- The app reads and writes it through an Airtable token. Mel can open the base any
  time and see or fix any record. That's a real strength: no hidden database.
- Everything goes through one thin data layer in the code
  (`netlify/functions/lib/airtable.js` + `lib/domain.js`). Nothing else in the app
  talks to Airtable directly. **This seam is what makes a future move easy.**

## What "many organizations" actually needs

Whatever stores the data, the model is the same **multi-tenant** shape:

- Each ministry is a **tenant** — its own people, accounts, categories, expenses.
- A ministry only ever sees **itself**.
- **CedarStone** is a back office that spans many tenants: a top-level list of all
  the ministries it serves, drill into one to review, back out to the portfolio.
- Every row carries an **organization id**; every query is scoped to it.

## Where Airtable stops being the right tool (~200 ministries)

Two hard limits bite at scale:

1. **Rows per base.** Even Airtable's largest plans cap a base at roughly
   **250,000 records**. 200 ministries × a few thousand expenses a year fills that
   in a year or two. There is no "just add more" past the cap.
2. **Speed.** Airtable rate-limits the app to ~**5 requests/second per base**, and
   large tables get slow to query. With many orgs active at once, that becomes a
   real bottleneck.

Plus operational drag: no true row-level security (the app enforces who-sees-what,
not the database), and cross-org reporting gets awkward.

## The three ways to grow — and the recommendation

**A. 200 separate Airtable bases (one per ministry).** *Not recommended.* Clean
isolation, but managing 200 bases, routing the app to the right one, and keeping
them in sync is a maintenance nightmare — and CedarStone's cross-org view gets hard.

**B. One shared Airtable base + an "Organization" field on every record.**
*Good interim step* for the first handful of orgs. CedarStone filters across all;
each ministry sees only its own rows. Works right up until total records approach
the base cap — then it stops.

**C. Move the data into a real database (e.g. Supabase / Postgres).**
*The long-term answer.* No row cap, fast at any size, proper per-org isolation
(row-level security in the database itself), real reporting. Because the app already
talks to storage only through `lib/domain.js`, this swap re-implements that layer
against Postgres and leaves the front-end and business logic essentially untouched.

**Recommended path:** stay on Airtable for JV and the **first few** ministries
(option B when the second org joins). When a handful of orgs are actively using it —
or total expenses head toward ~100k records — **migrate the storage to Postgres
(option C)** and keep everything else. Airtable proved the product; Postgres runs it
at scale.

## What to keep doing now so the move stays cheap

- Keep **all** data access inside `lib/airtable.js` / `lib/domain.js` — never let a
  function or the front-end reach Airtable directly.
- When multi-org work begins, add an **organization id** to the domain model from
  day one, even while still on Airtable (option B), so no data has to be re-tagged
  later.

See also: [CEDARSTONE-BACKOFFICE.md](CEDARSTONE-BACKOFFICE.md) §5 (the 200-ministry
portfolio vision) and [EXTERNAL-SERVICES.md](EXTERNAL-SERVICES.md) (Airtable entry).
