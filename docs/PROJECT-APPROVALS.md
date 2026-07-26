# Design: Project approvals — submit, review, decision & report reminders (planned)

> **Status: planned, not built yet.** Written from a design conversation with Mel.
> This is a **second workflow** alongside expense reimbursement: country leaders
> propose **projects**, a council-led team reviews them, and someone (Amanda)
> records an approve/deny decision. Denials carry a written reason; approvals set
> two report deadlines. Every handoff emails the next person a link to their page.
>
> Good news: most of this **reuses machinery Reimbly already has** — staged
> ownership, an activity trail, per-person pages, and the branded email+link
> notifications (`lib/notify.js`). The genuinely new parts are the *project*
> record and the scheduled report-due letters.

---

## The people

- **Country leader** — the submitter. Proposes a project, has "their page," receives
  the decision and the report-due letters. (Parallels the expense *submitter*.)
- **Council-led team** — the reviewing body. Amanda records the decision on its
  behalf. (Parallels the expense *approver / CedarStone reviewer*.)
- **Amanda** — the person who approves or denies and, on a denial, writes why.

## The pipeline (each stage has one clear owner)

```
  Country leader          Council-led team / Amanda            Country leader
  ┌───────────┐  submit   ┌─────────────────────┐  decision   ┌───────────────┐
  │  Drafting  │ ───────▶ │  Under review        │ ─────────▶ │ Approved       │
  │            │          │  (Amanda decides)    │            │  or Denied     │
  └───────────┘           └─────────────────────┘            └───────────────┘
       ▲                          handoff email                      │
       │                        with link to page                    │
       └──────────────── (if denied, leader reads the note) ─────────┘
```

**The rule that makes "whose turn is it?" unambiguous:** every project shows a
single **current stage** and **who it's waiting on**. On each handoff:

1. The project's stage flips (e.g. *Under review* → *Approved*).
2. The **activity trail** records who did what, when (same table pattern expenses use).
3. The **next person gets an email with a button to their page** — so a handoff is
   never silent. This is exactly what `notify.approverNewExpenses` /
   `notify.submitterApproved` already do for expenses; we add project versions.

---

## 1. Knowing it's your part + the handoff email  *(reuses existing email+link)*

- On the leader's page and the council's queue, each project shows a **status chip**
  ("Waiting on the council" / "Approved — reports due" / "Denied — please read").
- The moment a project moves to the next person, that person is emailed a
  brand-styled note with a **CTA button that deep-links to the exact screen** they
  need. Reimbly already builds these (`shell({heading, intro, rows, cta, ctaLabel})`).
- Optional iPhone/browser push on the same events (already supported, feature-flagged).

## 2. Denial → a window for Amanda to write why  *(near-clone of "Send report back")*

- When Amanda hits **Deny**, a window opens requiring a **reason** before it saves —
  the same shape as today's "Send report back" note box (`kick-back` / `decide-batch`
  already capture an approver note; a denial is that pattern with a required reason).
- Saving the denial: flips the project to **Denied**, stores the reason + who wrote
  it + when in the activity trail, and…
- …**emails the country leader** with the council's note and a **link back to their
  page** to read it in full — the same mechanism as `notify.submitterSentBack`
  (which already sends "here's the note, here's the link").

## 3. Report-due letters — midterm & final  *(new: the email engine on a schedule)*

- When a project is **approved**, it gets a **midterm** and a **final** report due date.
- Each leader gets a **letter** (email) telling them both dates up front, and a
  **reminder** as each date approaches (and if it passes unmet).
- This is the one net-new piece: a small **scheduled job** that each day finds
  projects with a report due soon and sends the letter. The email itself is the
  existing branded template with a link to the leader's page.

---

## Recommended defaults (change any of these — they're just my starting guess)

- **Where it lives:** *Build into Reimbly.* Reuse the existing Google sign-in, the
  email/push system, the activity trail, and per-person pages, adding a **Projects**
  area beside expenses. Standing up a separate app would duplicate all of that.
- **The chain:** leader submits → council-led team reviews → Amanda records the
  decision. One review step, three roles. (Add more handoffs later if needed.)
- **Who denies:** Amanda records decisions for the council; the denial reason is
  required before a denial can save.
- **Report due dates:** *timed from approval* — e.g. **midterm 6 months after,
  final 12 months after** approval. (Alternatives: fixed calendar deadlines for
  everyone, or typed in by hand per project.)

## Open questions for Mel

- **Into Reimbly, or a separate app?** (Recommend: into Reimbly.)
- Is the chain really just leader → council/Amanda, or are there more stops?
- Should **any council member** be able to deny, or only Amanda?
- How are the **midterm/final due dates** set — months after approval, fixed
  calendar dates, or entered by hand? What intervals?
- Does an **approval** also get a note/letter (a congrats + next-steps), or only
  denials get a written reason?
- Do projects carry a **budget / dollar amount**, or are they just proposals with a
  status? (Affects whether this ties into the expense side at all.)

## Build checklist (when confirmed)

1. Add a **Projects** table (title, leader, stage, decision, decision reason,
   decided-by/on, midterm-due, final-due) — mirrors the Expenses/Reports shape.
2. **Leader's page:** propose a project, see each project's stage chip + the
   council's note when denied.
3. **Council queue:** list projects *Under review*; open one; **Approve** or
   **Deny** (Deny opens the required-reason window).
4. **Handoff notifications:** on submit → email the council; on decision → email the
   leader with a link to their page (reuse `lib/notify.js`).
5. **Report-due dates** set on approval; **scheduled daily job** sends midterm/final
   letters + reminders.
6. Activity trail entries for submit / review / approve / deny / report-sent, so the
   whole history is visible (same table pattern as expenses).
7. Tests for stage transitions and that a denial can't save without a reason.

See also: [notify.js] email/push engine, [EMAIL-RECEIPTS.md](EMAIL-RECEIPTS.md) and
[EXTERNAL-SERVICES.md](EXTERNAL-SERVICES.md) (Resend — the email service these
letters go through; already documented).
