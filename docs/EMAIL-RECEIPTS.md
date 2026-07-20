# Filing receipts straight from email

Reimbly can read receipts that arrive in your inbox and file them for you —
no typing. You label a receipt email, and within the hour it appears under
**My expenses** as a Submitted expense with the amount, date, merchant, and
account already filled in by Claude (and the receipt attached).

## How it works

```
Gmail label "Reimbly"  ──▶  Apps Script (hourly)  ──▶  /api/inbound-email  ──▶  Claude reads it  ──▶  Expense in Airtable
```

- A tiny **Google Apps Script** (in `integrations/gmail-to-reimbly.gs`) runs in
  your Google Workspace and watches a Gmail label.
- It sends each receipt email — attachments **and** the email text — to the
  Reimbly **`/api/inbound-email`** function.
- That function reads every receipt with Claude (photo, PDF, or an HTML-only
  email like an Uber or hotel confirmation) and creates a **Submitted** expense
  owned by you, with the receipt file attached.
- You just review it in **My expenses** and approve/edit as normal. Every one
  also lands on the expense's activity trail as “From email”.

Because they come in as normal Submitted expenses, the audit still checks them,
duplicate detection still applies, and nothing is charged or sent anywhere
until it goes through your usual approval flow.

## Turning it on (one time)

1. **Pick a secret.** Any long random string. In Netlify → Site settings →
   Environment variables, add:
   - `INBOUND_EMAIL_SECRET` = your secret
   - (make sure `ANTHROPIC_API_KEY` is already set — the same one the receipt
     scanner uses)
2. **Add the Gmail label + filter.** Create a Gmail label called `Reimbly`.
   Optionally add a filter (e.g. subject/body contains `receipt OR invoice OR
   účtenka OR objednávka`) that applies the `Reimbly` label automatically.
3. **Install the script.** Open <https://script.google.com>, create a new
   project, and paste in `integrations/gmail-to-reimbly.gs`. Set `ENDPOINT_URL`
   (your site + `/api/inbound-email`) and `SECRET` (the same value as
   `INBOUND_EMAIL_SECRET`).
4. **Authorize + schedule.** Run `processReimblyReceipts` once and grant
   permission, then run `installHourlyTrigger` once so it keeps checking.

That's it. Label a receipt `Reimbly` (or let your filter do it) and it files
itself. Filed emails get a `Reimbly/Filed` label so they're never imported
twice.

## Notes

- Only emails **you** label are read — Reimbly never touches the rest of your
  inbox. The expense is always assigned to the inbox owner.
- The endpoint is protected by the shared secret, so only your script can post
  to it.
- Anything Claude can't read is left blank for you to fill in; the audit tab
  will flag it. Nothing is auto-approved.
