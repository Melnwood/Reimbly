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

## First decision: payment rail only, or accounting too?

Bill.com syncs natively to Sage Intacct, so there are two shapes:

- **A — Bill.com is only the payment rail.** Keep the Intacct JE file we built for
  the books; use Bill.com just to send the money. Simplest to reason about; the two
  systems stay independent.
- **B — Bill.com also carries the accounting.** If JV pays through Bill.com *and*
  Bill.com syncs to Intacct, the bills we push could post to Intacct through
  Bill.com — potentially **replacing** the JE file. One rail for pay + books.

**We must settle this with CedarStone before building** — it decides whether the
coding lives in the Bill.com bill, the Intacct file, or both. (This is on the
CedarStone agenda.)

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

## Requesting access — the outside-website steps (for Mel)

1. Sign in to Bill.com (or have CedarStone do it): <https://app.bill.com>.
2. Ask Bill.com support / your account rep to **enable API access** and issue a
   **Developer Key** for the org. (Search their help for "API access" / "developer
   key," or ask the rep directly.)
3. Get the **Organization ID**, and create a **dedicated API user**.
4. Ask for **sandbox** credentials for testing.
5. Send those to be put in **Netlify** (never email a key into the repo). Then Claude
   builds against the sandbox first.

> When any of this is set up, add it to [EXTERNAL-SERVICES.md](EXTERNAL-SERVICES.md)
> with the real org ID (non-secret) and which Netlify variables hold the keys.
