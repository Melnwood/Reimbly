# Reimbly, end to end — a stakeholder tour

A plain-language tour of the whole app, for leadership, CedarStone, or Mel's own
reference. There's also a viewable version (a shareable page) generated alongside
this. Companion to [CEDARSTONE-WALKTHROUGH.md](CEDARSTONE-WALKTHROUGH.md), which
covers the final Intacct hand-off in depth.

## At a glance

- **Built for JV** — sign in with a `josiahventure.com` Google account; nothing to install.
- **Receipts read themselves** — snap a photo and the amount, date, and merchant fill in.
- **Paid in USD** — foreign amounts convert at the day's rate; the original is kept too.
- **Hands off to CedarStone** — each pay run becomes a balanced Intacct journal entry.

## The journey of one expense

Every reimbursement follows the same five steps, and everyone can see where their
money is along the way:

1. **Snap it** (staff) — photograph/upload a receipt, or let it arrive from email; Reimbly reads the details.
2. **Add to a report** (staff) — group expenses into a report and submit for approval.
3. **Approved** (approver) — the upline sees the receipt and details, then approves or sends it back with a note.
4. **Paid** (Finance) — Finance pays a batch and marks it paid; everyone's app updates to "reimbursed."
5. **Booked in Intacct** (CedarStone) — the pay run downloads as a balanced journal entry to load into Sage Intacct.

## Three views of the same app

Everyone gets the everyday tabs; approvers and Finance see one extra **Management**
menu — so nobody is shown more than they need.

### Everyone (any JV staff member) — *Add expense · My reports*
- **Add an expense** — snap a receipt or log mileage; pick the account (fund) and category; amount/date/merchant read for you; reimbursed in USD.
- **Upload or import** — several receipts at once, or a budget export (YNAB) that becomes expenses with receipts matched and duplicates flagged.
- **Receipts from email** — optional, off by default; one-tap **Connect Gmail** (read-only, receipts only) drops new receipts into an inbox to file.
- **Build & submit a report** — name it, add expenses, submit; loose expenses are kept in one place.
- **Track it to paid** — "My reports" shows each stage (being worked on → on its way → reimbursing → paid, by month) with a progress stepper.
- **Gentle reminders** — age-based nudges as an expense nears the deadline (first at 10 days left), by email, push, or both — each person's choice.

### Approvers (uplines) — *Management → Review*
- **The review queue** — everything waiting, grouped by person; receipt and details side by side.
- **Approve or send back** — approve in a click, or return with a note to fix and resubmit; the person is notified.
- **Missing-receipt affidavit** — when a receipt truly isn't available, the person certifies it and the approver signs off.
- **Year-to-date context** — each person's running count of missing-receipt expenses, so patterns are easy to spot.

### Finance & owner — *Paid · Dashboard · Timing · Setup*
- **Pay a batch** — approved reports ready to pay and those waiting; download for CedarStone, then mark a report paid once money's out.
- **Download for Intacct** — one button builds a balanced journal entry (bank clearing, wire fee, every expense), fully coded from the fund listing, and starts the batch paying.
- **Dashboard & timing** — where the money's going, plus two clocks (time to approve, time to pay).
- **People & access** — roles, uplines, restricted accounts, and households — per person or from one spreadsheet.
- **Accounts & categories** — the accounts (Expense Types) people pick and who may charge each, matching ExpenseWire.
- **Rules & reminders** — the no-receipt-needed amount ($50) and the submission deadline, editable without a developer.

## Behind every expense

- **AI reads each receipt** — amount, date, merchant; only real receipts are kept (junk skipped).
- **Multi-currency, one number** — original amount + USD at the day's rate, so books and receipt match.
- **Receipt rules, built in** — required over a set amount; the affidavit path covers the rare no-receipt case, all on the record.
- **Sign-in that's easy and safe** — Google sign-in limited to JV accounts, plus Face ID unlock on a phone.
- **Notifications that reach people** — approvals, send-backs, payments, and deadline nudges by email and optional phone push.
- **Clean hand-off to accounting** — every pay run exports as a balanced, fully-coded journal entry that reconciles to what left the bank.

## Under the hood (for reference)

Static web front-end + Netlify Functions + Airtable, with Google sign-in, Claude for
receipt reading, Resend for email, and web push for phone alerts. Runs on the web —
nothing to install — and the everyday rules (receipt limit, deadline, accounts, people)
are all editable in the app. See the [README](../README.md) and
[EXTERNAL-SERVICES.md](EXTERNAL-SERVICES.md) for the stack and where each piece lives.
