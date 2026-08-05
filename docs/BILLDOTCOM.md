# Connecting Reimbly to Bill.com (plan — not live yet)

> **Status: planned.** Nothing is built or connected yet. This is the map of what
> Bill.com would do, what we need from it, and how the integration would work — so
> Mel can request access and Claude can build it. Keys will live in Netlify only
> (never in GitHub), same as every other service — see
> [EXTERNAL-SERVICES.md](EXTERNAL-SERVICES.md).

## What Bill.com does for Reimbly

Reimbly already hands the **accounting** to CedarStone (the Intacct journal-entry
file) and you mark a batch "paid" once the money has gone out. **Bill.com is the
part that actually moves the money** — paying each person by ACH or check.

Connected, the flow becomes: a batch is approved → Reimbly tells Bill.com *who to
pay, how much, and how it's coded* → Bill.com sends the payments → Bill.com tells
Reimbly "paid" → everyone's app updates itself. No spreadsheet, no manual wire.

> Bill.com is one option for the money rail. For the wider comparison — services
> where staff enter their own bank details and get paid out, and what they cost per
> person — see **[PAYOUT-PROVIDERS.md](PAYOUT-PROVIDERS.md)**.

## Update (after talking to Olivia): ride the pipe they already have

Mel confirmed with Olivia (Aug 2026): **Intacct does not pay anything itself**, and
the Bill.com ↔ Intacct link is **one-way — Bill.com syncs *into* Intacct after a
payment, and Intacct never sends anything back to Bill.com.** So the
**Bill.com → Intacct** channel exists and works today, and there is no
Intacct → Bill.com direction to rely on.

That settles the architecture — the least-work-for-CedarStone shape:

> **Reimbly → Bill.com → Intacct (their existing one-way sync).**

Reimbly drops the reimbursements *into* Bill.com; Bill.com carries them into Intacct
the way it already does. CedarStone does **less**, not more — they stop importing
anything from us; the reimbursements arrive through the channel they already watch.

What the one-way sync means for us:

- **Reimbly must feed Bill.com directly.** Since Intacct can't push to Bill.com, the
  only way in is Reimbly → Bill.com (API or import file). There's no shortcut through
  Intacct.
- **Don't double-book.** Once Bill.com is live for a reimbursement, we must **not
  also send the Intacct JE file for it** — Bill.com's sync already posts it to
  Intacct, so sending our file too would record it twice. The JE export becomes the
  **pre-Bill.com fallback** (and the path for anything Bill.com can't pay), not an
  additional feed.
- **The coding must live on the Bill.com bill.** Because Bill.com carries the entry
  into Intacct, the GL account + fund/project/class Reimbly produces must map onto
  the Bill.com bill's fields. Confirm with CedarStone how their Bill.com → Intacct
  sync maps those dimensions, so the books land the same as they do today.

## What Bill.com can actually do (researched, Aug 2026)

Short answer: **everything we need is there via Bill.com's API.**

- **There is a full REST API** (BILL "AP & AR" API — v2 and a newer v3). You sign up
  for a **developer key** and a **sandbox** to build/test. Auth is
  `username + password + organizationId + devKey` → a `sessionId` used on every call.
- **Reimbly can create the whole chain by API:** find-or-create each person as a
  **vendor** (international vendors are supported), **create a bill** (with
  `vendorId`, `dueDate`, and line items coded to the GL account + dimensions), and
  **initiate the payment**, then **track status** to completion (polling or webhooks).
- **The coding will carry.** Bill.com's Sage Intacct integration syncs the chart of
  accounts and dimensions **from Intacct into Bill.com** (departments, locations,
  classes, and custom dimensions — the latter one-way, view-only in Bill.com). So the
  fund/project/class Reimbly already produces line up with what Bill.com holds, and
  the **transaction sync runs one-way Bill.com → Intacct** — exactly what Olivia
  described.
- **International reach is broad:** Bill.com pays **~137 countries / ~106
  currencies**, with **no wire fees on local-currency payments** and better-than-bank
  FX — good for JV's Europe footprint (verify the exact country list, esp. Ukraine).
- **CSV import exists but is the wrong tool here:** Bill.com's own docs say **don't
  import bills by CSV when you sync to an accounting system** (it causes duplicates /
  sync errors). Since JV syncs to Intacct, we use the **API**, not a file.

**Note on "employee reimbursements":** Bill.com's core is *vendor* payments, so the
clean model is each staff member = a **vendor**, each reimbursement = a **bill**.
(Bill.com also sells a separate product, **BILL Spend & Expense**, that does employee
reimbursements natively — worth a look, but our Reimbly-driven approach uses AP bills
to vendors and doesn't need it.)

## What we need from Bill.com to build it

A short checklist to request (JV or CedarStone, whoever owns the account):

1. **A Bill.com account with API access enabled.** API access is a feature you
   request/turn on; a plain login isn't enough.
2. **A Developer Key (`devKey`).** Bill.com issues this for the account.
3. **The Organization ID (`orgId`).** Identifies which Bill.com org we act on.
4. **A dedicated API user** (username + password, or API key) — its own service
   login, not a person's, so it's easy to rotate and audit.
5. **Sandbox access** for testing, so we make and verify a test payment before a
   single real dollar moves.
6. **Confirmation of the Intacct sync** (for the A-vs-B decision above), and whether
   staff are set up as **Vendors** in Bill.com (that's what a payment is made to).

## The keys (Netlify environment variables)

Once we have the above, these go in Netlify → Site settings → Environment variables
(names to be finalized at build):

| Variable | What it is |
|---|---|
| `BILLDOTCOM_DEV_KEY` | The developer key |
| `BILLDOTCOM_ORG_ID` | The organization ID |
| `BILLDOTCOM_USER` | The API service-user login |
| `BILLDOTCOM_PASSWORD` | That user's password (or an API key) |
| `BILLDOTCOM_ENV` | `sandbox` or `production` |

## How the integration will work

Bill.com's API is a server-to-server one: you **log in** (devKey + orgId + user →
a short-lived session), then create/read objects (Vendors, Bills, Payments). We'll
confirm the exact endpoints and fields against Bill.com's current API + sandbox at
build time, but the shape is:

1. **Match each person to a Bill.com Vendor.** On first payment, find-or-create the
   vendor by email, and store their **Bill.com Vendor ID** on the Staff record so we
   never create duplicates.
2. **Create a Bill per reimbursement (or per report).** Line items carry the same
   coding Reimbly already produces — GL account + fund/project/class — so the books
   match whether it posts via Bill.com or the Intacct file.
3. **Queue the payment.** Either an electronic (ACH) payment if the vendor is set up
   for it, or a recorded payment — per what CedarStone wants.
4. **Track status back.** Store the Bill/Payment IDs on the expense/batch; a small
   scheduled check (or a Bill.com webhook, if available on the account) flips the
   batch to **Paid** in Reimbly when Bill.com reports it sent — the same one-click
   "paid" everyone already sees, but automatic.

### What changes inside Reimbly

- **Staff:** a new **Bill.com Vendor ID** field (set once per person, automatically).
- **Expenses/batch:** **Bill.com Bill ID** + **Payment status** fields, so a batch
  can be traced to its Bill.com payment.
- **Paid screen:** a **"Send to Bill.com"** action for Finance (next to the Intacct
  download), plus automatic status updates.
- **New functions:** `billdotcom-send` (push a batch), `billdotcom-status` (poll/
  receive status). A shared `lib/billdotcom.js` for auth + calls, with the token
  encrypted/held in memory only.

## Build plan (safe, staged)

1. **Sandbox first.** Wire auth + vendor + bill + a test payment entirely in the
   Bill.com sandbox. Nothing touches real money or real staff.
2. **One real test.** A single small live reimbursement to one person, start to
   finish, confirmed in Bill.com and back in Reimbly.
3. **Turn it on for Finance** once CedarStone signs off on the coding + the A/B
   decision.

## What's left to nail down (the API exists — these are org-specific)

Research settled *whether* it's possible; these are the JV-account questions:

1. **Whose Bill.com account** is it — JV's or CedarStone's? Whoever owns it issues the
   production **Developer Key** and **Organization ID** and creates a **dedicated API
   user**. (The **sandbox** we can sign up for ourselves to start building now:
   <https://developer.bill.com>.)
2. **Country/currency coverage** for JV's actual list — confirm the ones that matter,
   especially **Ukraine (UAH)** and smaller markets.
3. **Vendor model:** confirm staff can be set up as **vendors** (that's what a bill is
   paid to), and how their bank details get collected — in Bill.com's vendor
   onboarding (the "staff enter their own details" flow you wanted).
4. **Sync direction confirmed:** the Bill.com → Intacct **transaction** sync stays
   **one-way** (so we don't double-book with the Intacct file).

Then the production key + org id + API user go into **Netlify** (never emailed into
the repo), and the build moves from sandbox to live.

Sign in / start here: <https://app.bill.com> · Developer portal: <https://developer.bill.com>

> When any of this is set up, add it to [EXTERNAL-SERVICES.md](EXTERNAL-SERVICES.md)
> with the real org ID (non-secret) and which Netlify variables hold the keys.
