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

## Update (after talking to Olivia): ride the pipe they already have

Mel confirmed **CedarStone already *receives* from Bill.com into Intacct** — so the
**Bill.com → Intacct** channel exists and works today. That points straight at the
least-work-for-CedarStone architecture:

> **Reimbly → Bill.com → Intacct (their existing sync).**

Reimbly drops the reimbursements *into* Bill.com; Bill.com carries them into Intacct
the way it already does. CedarStone does **less**, not more — they stop importing
anything from us; the reimbursements arrive through the channel they already watch.

Two things this settles:

- The direction we were unsure about — **Intacct → Bill.com — is not needed.** We
  only ever push data *into* Bill.com; Bill.com handles everything downstream.
- The Intacct JE file we built becomes a **fallback**, not the main path. (Keep it
  for now; it's the safety net until the Bill.com route is proven.)

## The one thing to confirm — can we get data *into* Bill.com?

The whole question narrows to this, and Bill.com supports at least one of:

- **API** — Reimbly creates the bills in Bill.com directly (fully automatic), or
- **Import file** — Reimbly produces a Bill.com bill-import file that's uploaded
  into Bill.com (same idea as our Intacct file, pointed at Bill.com instead).

Either lands in the same place, because Bill.com → Intacct is already theirs. We're
well-positioned: Reimbly already produces the full coding (GL account + fund/
project/class) a Bill.com bill needs to map cleanly into Intacct.

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

## The question to ask Bill.com (for Mel)

One question decides the path — ask Bill.com support / your account rep:

> **"Can we get bills *into* this account automatically — either through the API, or
> a bill-import file — and have them flow to Intacct through our existing sync?"**

- **If yes, API:** get **API access enabled**, a **Developer Key**, the
  **Organization ID**, a **dedicated API user**, and **sandbox** credentials. Send
  those to go in **Netlify** (never email a key into the repo); Claude builds against
  the sandbox first.
- **If yes, import file only (no API):** ask for their **bill-import template/format**.
  Reimbly generates that file (it already has the coding); it's uploaded into
  Bill.com like our Intacct file — still less work for CedarStone, since it rides
  their Bill.com → Intacct sync.
- **Either way, confirm:** whose account it is (JV vs CedarStone), and that staff can
  be **Vendors** in Bill.com (that's what a payment is made to).

Sign in / start here: <https://app.bill.com>.

> When any of this is set up, add it to [EXTERNAL-SERVICES.md](EXTERNAL-SERVICES.md)
> with the real org ID (non-secret) and which Netlify variables hold the keys.
