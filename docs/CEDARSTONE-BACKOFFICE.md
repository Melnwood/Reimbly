# Design: CedarStone back office — accounts, receipt gate & review dashboard (future — not built yet)

> **Status: planned, not implemented.** The live JV app is unchanged. This is the
> ready-to-build plan for using Rembly with **CedarStone** as the back office (the
> role JV plays today), where a reviewer processes many people's expense reports.
> Written from three design conversations with Mel. Nothing here is wired up yet.

Three connected pieces: (1) **role-based accounts** on the submit side, (2) a
**front-side receipt gate** so bad expenses can't be submitted, and (3) a
**CedarStone review dashboard** that surfaces only what needs a human.

---

## 1. Role-based accounts (account, then category)

Some people manage extra **accounts** beyond their own personal ministry account.
Example: Mel is an executive and can log expenses for **Selah** (and possibly one
or two others). Most people have none.

- Each person has an **"Accounts they can use"** list, managed in the CedarStone
  back office. This one list drives the whole behavior.
- **0 extra accounts →** no account step at all. Submitting works exactly as today
  (their own personal account is implied). No confusing empty dropdown.
- **1+ extra accounts →** submitting gains a first step: **pick the account**
  (showing only *their* accounts) → **then pick the category** under it.
- Categories can be per-account if needed, but start with the standard list and the
  account tag; only split category lists per account if a real need appears.
- **CedarStone** is the back-office org that receives and processes all of this
  (the same relationship JV has to Rembly now).

Rule of thumb: *the account picker appears only if you've been given accounts.*

---

## 2. Front-side receipt gate (hard stop, not a nudge)

An expense **cannot go into a report** unless one of these is true:

1. It **has a receipt attached**, **or**
2. It is **explicitly marked "missing receipt"** and that missing-receipt form is
   **fully filled out** (why it's missing, what it was for, the amount).

If it's neither — no receipt and not properly declared missing — the app **blocks
submission**. A bare, receiptless, half-filled expense can never reach a report.

**Why this beats today's practice.** Currently a missing receipt is handled by just
entering a **handwritten receipt** and moving on — a quiet substitution. The new way
is deliberately *not* that: the person must **declare "I don't have a receipt, and
here's why"** and enter the details. Same situation, but now it's an honest,
**flaggable, countable** declaration the app and CedarStone can actually see —
rather than something hidden inside a handwritten note.

Consequences:
- The "silently no receipt" case **stops existing** — impossible to create.
- The only receiptless items that survive are **deliberately declared** missing,
  and they arrive **with a reason attached**. Those are exactly what CedarStone
  should review.

Confirm whether a "missing receipt" declaration already exists in current practice
or is being introduced here. (Open question from the design chat.)

### Flags split into two kinds

- **Front-side blockers** (can't submit at all): no receipt *and* not declared
  missing; required fields blank; missing account/category. These never reach
  CedarStone.
- **Back-side "give it a look"** (submitted but flagged for a human): declared
  missing-receipt; receipt amount ≠ entered amount; over a $ threshold CedarStone
  sets; possible duplicate (same amount + same day). This is CedarStone's worklist.

---

## 3. CedarStone review dashboard

Principle: **the app does the checking and says so**, so reviewers trust the green
and spend attention only on the yellow. Don't make them read every expense.

### Top of the page

- Headline: **"N reports waiting for you"** (unapproved reports).
- The split right under it: **"X all clear · Y need a look."** Y is the real job.
- At-a-glance extras: **total $ pending**, **oldest waiting** (aging, e.g. "6 days").

### The waiting list (one row per report)

> **Mel Ellenwood** — 14 expenses · $2,340 · submitted 2 days ago · ✅ All clear
> **Jane Smith** — 9 expenses · $880 · submitted 5 days ago · ⚠️ 2 need a look

- ⚠️ reports sort to the top; oldest next.
- All-clear rows are checkbox-selectable → **"Approve N all-clear reports"** in one
  batch (bulk approval). Flagged reports are opened individually.

### Inside a report

- **Reassurance banner** at the top:
  - Clean: **"All 14 receipts match."** → single **Approve report**.
  - Flagged: **"13 of 14 receipts checked and matched. 1 item needs your
    attention."**
- **Sorted by attention:** flagged item(s) highlighted at top with the reason
  ("Declared missing receipt — taxi, no receipt given" / "Receipt says $48, expense
  says $84"). The already-good items sit below, calm/greyed, each with a small green
  **"receipt matches"** — visible but not demanding time.
- Reviewer resolves the flagged one(s), hits **Approve report**.

### Per-person missing-receipt trend (year-to-date)

When a person's name comes up (in their report header, and/or on the waiting list),
show a running **year-to-date count of their missing-receipt declarations** — e.g.
**"Mel — 7 missing-receipt declarations YTD."**

This is about the **pattern, not any single expense**. One or two is normal. If the
count starts climbing past a comfortable level, that's the signal for **someone to
have a friendly check-in** — a lost habit, a system problem, whatever it is. The app
surfaces the trend so it's a caring conversation, not a gotcha. Consider a gentle
threshold (configurable) that visibly highlights the count once it's high enough to
warrant a chat.

The point: the app isn't dumping expenses on the reviewer — it's saying *"I looked,
here's what's true, here's the one I couldn't vouch for."* Glance-and-approve
instead of grind-through-everything.

---

## 4. How CedarStone is doing — timing / throughput view

> **Priority: wanted for JV now** (not parked). Unlike the rest of this doc, this
> view builds on data the live app **already records** — every expense is stamped
> with `Submitted On`, `Decided On`, and `Paid On` — so "time to approve" is real
> today, and "approved → paid" is real wherever payment has been marked. This is the
> near-term build for JV.

A **health view** (not a to-do list) so leaders can see whether the whole
loop is keeping up. Two headline numbers:

- **Time to approve** — average days from **submitted → approved**. Are reports
  sitting in CedarStone's queue too long?
- **Time to reimburse** — average days from **approved → paid**. Once approved, how
  long until the person actually gets their money back?

Supporting figures: approved this month, number (and $) **awaiting payment**, and
**oldest unpaid**. A simple month-by-month trend for each metric shows whether it's
getting quicker or slower. **Built and shipped** (`timing.js` + the Timing screen).

### Volume, and reading speed against it

Also shipped: **how many reports came in** each month (counted by `Submitted On` on
the Reports table), shown next to the speed clocks with a "vs last month" delta and a
6-month trend, plus **"came in this month" beside "approved this month"** so inflow
and throughput read together.

**The connection Mel flagged:** approval speed only means something *relative to how
much came in*. A slow month during a flood of reports is very different from a slow
month with barely any. Rather than invent a shaky "days per report" number, express
it two honest ways:

- **Keeping up** — came in vs approved (and vs paid) in the same period. If approved
  keeps pace with came-in, they're staying even; if inflow outruns it, a backlog is
  building. This is the real speed-against-load signal.
- **Overlay** — put the volume bars and the approve-time on **one timeline**, so a
  spike in reports sitting next to steady speed reads as "handled it well," and slow
  speed *without* a volume spike reads as a genuine flag.

Next step for the timing view: the overlay/keeping-up chart. (The pieces — monthly
volume, monthly approve-time, approved-this-month — are all already computed.)

### The dependency this creates: knowing when something was *paid*

"Approved → paid" can only be measured if Rembly knows **when the reimbursement went
out**. Today that's marked **outside Rembly** — it sounds like CedarStone records
payment in **Expense Wire**. So this view needs one of:

- a quick **"Mark as paid"** action in Rembly (a tap when the payment goes out), or
- a small **sync from Expense Wire** (if it can export/notify payment events).

Decide which before building the timing view. **If we integrate or sync Expense
Wire, it must be added to [EXTERNAL-SERVICES.md](EXTERNAL-SERVICES.md)** per the
standing rule (what it's for, sign-in link, which Netlify env var holds its key).
Note: the base already has a `Paid On` field and a `Mark paid` function — the
`approved → paid` clock can likely hang off that once payment is recorded in Rembly.

### Closing the loop: a "waiting to be paid" queue

The real-world payment flow Mel described, and how it should feel in Rembly:

1. CedarStone **downloads the CSV** of all approved reports (their hand-off into
   their own payment process). That export action should also **move those reports
   into a "Waiting to be paid" state** — so the app tracks that they've left approval
   and are now in the payment queue.
2. A **"Waiting to be paid" dashboard** lists those reports. CedarStone can
   **bulk-select (or select all) and hit one button → marks them paid.** That single
   action stamps `Paid On`, flips them to Reimbursed, and (already built) emails each
   person they've been reimbursed — which is what makes the approved→paid clock real.

**Status — mostly built.** The **Paid** screen (`archive.js` + `mark-paid.js`) is now
a **"Waiting to be paid"** queue: **Export CSV** of all approved expenses, **select
all / per-report checkboxes**, and one **"Mark N paid"** button that reimburses the
whole selection at once (and emails each person). The one piece **not** built is
making the export **transition reports to an explicit "Waiting to be paid" status**
— today "Approved" implicitly is that stage, and the queue simply shows all approved-
not-yet-paid reports. Decide whether "Waiting to be paid" needs to be a real new
status (a schema change to the base) or stays a view over Approved-not-Reimbursed.

### A third clock: sent back → resubmitted

When a reviewer hits **"Send report back,"** the JV staff member has to know quickly
and turn it around, or the whole loop stalls at that person. Two parts:

- **Visibility for the submitter.** The app already emails (and can push) the person
  on the "Sent back" moment. Make it **unmissable in-app** too: a badge/attention
  marker on **My reports**, and the sent-back report surfaced at the top with the
  reviewer's note, so they can jump straight to fixing it.
- **A turnaround metric** on the timing dashboard: average time from **sent back →
  resubmitted**, and a way to spot reports sent back and **sitting untouched** too
  long. The **Activity Log already records** `Sent back` / `Kicked back` and
  `Resubmitted` events with timestamps, so it's computable — but it means reading the
  activity trail, not just the date fields on the expense, so it's a follow-on to the
  first two clocks.

---

## 5. CedarStone at scale — many ministries (the bigger vision)

CedarStone is a **back office that serves ~200 ministries**. The hope is that a large
share of them adopt Rembly — which means Rembly can't assume a single organization.
It has to let CedarStone **stand above many ministries at once**.

The shape of it:

- A **top-level CedarStone dashboard** that lists **every ministry/account they
  serve** — each with its own at-a-glance state (reports waiting, needs-a-look count,
  $ pending, timing).
- CedarStone **drills into a ministry** to get the exact review experience described
  in sections 1–4 (that ministry's waiting reports, flags, approvals, timing).
- Back out, and they're looking across the whole portfolio again.

This is a **multi-tenant** model: each ministry is its own isolated set of people,
accounts, categories, and expenses; CedarStone is the shared back office that can see
across all of them, while an individual ministry only ever sees itself. It overlaps
heavily with the household-invites multi-tenant thinking — see
[HOUSEHOLD-INVITES.md](HOUSEHOLD-INVITES.md); reconcile the two account/org models
when this is built.

**The storage question at this scale (Airtable vs. a real database) is answered in
its own note — see [DATA-AT-SCALE.md](DATA-AT-SCALE.md).** Short version: Airtable is
right for JV and the first few ministries (add an "Organization" tag), but ~200
ministries needs a move to Postgres; the code's single data layer keeps that move
contained.

**Status: parked on purpose.** This is the large, later dashboard — written down now
so the vision isn't lost, but **not** the next thing to build. The near-term work is
the single-back-office review experience (sections 1–4) for JV. The 200-ministry
portfolio view comes after that proves out.

---

## What NOT to do now

- Do **not** change the live JV app. This turns on only for a deliberate CedarStone
  / multi-account build.
- The multi-tenant plumbing (per-account isolation, who belongs to which back
  office) overlaps with the household-invites design — see
  [HOUSEHOLD-INVITES.md](HOUSEHOLD-INVITES.md). Reconcile the two when building.

## Open questions for Mel

- Besides missing receipts and amount mismatches, are there categories or dollar
  amounts CedarStone **always** wants to eyeball?
- Do accounts ever need their **own** category lists, or is one standard list + an
  account tag enough to start?
- For the timing view: is **"paid" marked in Rembly** (a Mark-as-paid tap) or should
  we **sync from Expense Wire**? Confirm the tool name and whether it can export
  payment events.
> Resolved (threshold): don't pick a number up front — it'd be a guess. **Track the
> per-person YTD count first, watch what "normal" looks like across JV for a while,
> then set the highlight threshold from real data.** Build the counter now; leave the
> threshold configurable and unset until there's history to base it on.

> Resolved: the "missing receipt" idea replaces today's practice of quietly entering
> a **handwritten receipt** — see the note in section 2. The new declaration is the
> deliberate, flaggable, countable version of that.

## Build checklist (when the time comes)

1. Add an **Accounts** concept + an "accounts this person can use" list per Staff
   record; show the account picker on submit only when the list is non-empty.
2. Enforce the **front-side gate**: block submit unless receipt attached OR
   missing-receipt declared and complete.
3. Compute **flags** per expense (missing-declared, amount mismatch, over
   threshold, duplicate) and a per-report **all-clear vs needs-a-look** status.
4. Build the **dashboard**: waiting count, all-clear/needs-a-look split, $ pending,
   aging; sortable report list; bulk-approve all-clear.
5. Build the **report detail**: reassurance banner, attention-sorted rows,
   per-line "receipt matches" checks, approve.
6. Track a **per-person year-to-date missing-receipt count**; show it on the report
   header / waiting list. Leave the highlight threshold **configurable and unset at
   first** — set it later from real JV usage rather than guessing up front.
7. Build the **timing view**: time-to-approve (submitted→approved) and
   time-to-reimburse (approved→paid) averages + trend; awaiting-payment and
   oldest-unpaid figures. Requires a **Mark-as-paid** step or an Expense Wire sync so
   `Paid On` is recorded.
8. Tests: receiptless-undeclared can't submit; declared-missing can and is flagged;
   amount mismatch flags; all-clear report bulk-approves; account picker hidden for
   people with no accounts.

## Later (parked): the 200-ministry portfolio

9. A **top-level CedarStone dashboard** across all ministries they serve — per-
   ministry state (waiting, needs-a-look, pending, timing), drill into one to get the
   sections 1–4 experience, back out to the portfolio. Multi-tenant isolation per
   ministry. See section 5 — build **after** the single-back-office experience proves
   out for JV.
