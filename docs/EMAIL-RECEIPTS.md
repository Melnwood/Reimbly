# Filing receipts straight from email

Rembly can find the receipts and invoices in your Gmail and file them for you —
no typing. It reads each one with Claude and, within the hour, it appears under
**My expenses** as a Submitted expense with the amount, date, merchant, and
account already filled in (and the receipt attached).

## How it works

```
Your Gmail  ──▶  Apps Script (finds receipts, hourly)  ──▶  /api/inbound-email  ──▶  Claude reads it  ──▶  Expense in Rembly
```

- A small **Google Apps Script** (in `integrations/gmail-to-rembly.gs`) runs in
  your own Google Workspace account. It works two ways:
  - **Automatic** — it searches your mail for anything that looks like a receipt
    or invoice (has an attachment + words like *receipt, invoice, faktura,
    účtenka, Rechnung, factura, order confirmation…*) and files it. No labeling.
  - **Manual** — anything you drop into a Gmail label called `Rembly` is filed
    too, for the odd one the search misses.
- It sends each receipt — attachments **and** the email text — to the Rembly
  **`/api/inbound-email`** function.
- That function reads every receipt with Claude (photo, PDF, or an HTML-only
  email like an Uber or hotel confirmation) and creates a **Submitted** expense
  owned by you, with the receipt file attached.
- You just review it in **My expenses** and approve/edit as normal. Every one
  also lands on the expense's activity trail as “From email”.

Because they come in as normal Submitted expenses, the audit tab still checks
them, duplicate detection still applies, and nothing is charged or sent anywhere
until it goes through your usual approval flow. So a stray non-receipt that
sneaks in is harmless — you just delete it.

## Turning it on (one time, ~10 minutes)

1. **Set the secret in Netlify.** Pick any long random string. In Netlify → Site
   settings → Environment variables, add:
   - `INBOUND_EMAIL_SECRET` = your secret
   - make sure `ANTHROPIC_API_KEY` is already set (the same one the receipt
     scanner uses), then **redeploy**.
2. **Install the script.** Open <https://script.google.com> → **New project**,
   and paste in the whole of `integrations/gmail-to-rembly.gs`. In `CONFIG`, set
   `SECRET` to the same value as `INBOUND_EMAIL_SECRET` (and `ENDPOINT_URL` if
   your site address isn't `reimbly.netlify.app`).
3. **Sweep your existing mail.** Run `backfillReceipts` once and grant the
   permissions it asks for. If it logs that it hit the per-run limit, run it
   again — it picks up where it left off — until it says *0 new*.
4. **Keep it running.** Run `installHourlyTrigger` once so new receipts file
   themselves from now on.

That's it. Filed emails get a `Rembly/Filed` label so they're never imported
twice.

## Pairing with your budget (YNAB) — the "hold" mode

By default the script runs in **`inbox` mode** (`CONFIG.MODE` in the script):
a receipt is **held**, not turned into an expense on its own. Your budget app —
YNAB — stays the master list of what's reimbursable. The flow is:

1. Receipts arrive by email → Rembly reads each one and **holds** it (with the
   image + the amount/date/merchant Claude read off it).
2. You export your reimbursables from YNAB (Date, Payee, Outflow, Memo) and
   upload it on the **Import** screen.
3. Each YNAB row becomes an expense, and Rembly **automatically attaches the
   matching held receipt** (same amount, within a few days). Rows with no
   receipt are created and flagged; held receipts not on your YNAB list simply
   stay in the **Receipts waiting from email** box — nothing junk is created,
   and there's nothing to delete.
4. A receipt that shows up *after* its expense already exists attaches itself to
   that waiting expense automatically.

Anything the auto-matcher misses (a receipt dated a few days off, an odd
merchant name) sits in the inbox for you to attach by hand or discard.

If you'd rather each receipt become a Submitted expense the moment it arrives
(no budget file), set `CONFIG.MODE` to `'expense'`.

## Tuning it

All in the `CONFIG` block at the top of the script:

- **`KEYWORDS`** — what counts as a receipt/invoice. Add your own terms (other
  languages, a specific vendor) or trim ones that cause noise.
- **`BACKFILL_WINDOW`** — how far back the one-time sweep looks (default one
  year; widen to `newer_than:3y` for a deeper history).
- **`MAX_ATTACH_MB`** — attachments bigger than this are skipped (Rembly accepts
  up to 8 MB).

## Notes

- The script only ever files to **you**, the inbox owner — it never guesses
  someone else's expense. If more of the team wants email intake, each person
  installs the script in their own account.
- It only reads mail that matches the search (or that you label) — it doesn't
  touch the rest of your inbox.
- The endpoint is protected by the shared secret, so only your script can post
  to it.
- Anything Claude can't read is left blank for you to fill in; the audit tab
  flags it. Nothing is auto-approved.
