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
- What's a sensible **threshold** for the year-to-date missing-receipt count before
  it highlights for a check-in?

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
   header / waiting list and highlight it past a configurable threshold.
7. Tests: receiptless-undeclared can't submit; declared-missing can and is flagged;
   amount mismatch flags; all-clear report bulk-approves; account picker hidden for
   people with no accounts.
