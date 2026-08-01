# Call notes — Olivia (Cedarstone), Aug 5/6

Prep for the Zoom with Olivia Lightner (and maybe Susan Lange). Keep it friendly —
this is mostly "here's what we built, and two things we need from you." Details and
the exact upload format live in [INTACCT-UPLOAD-FORMAT.md](INTACCT-UPLOAD-FORMAT.md).

---

## 1. What Rembly already does (good news to share)

Olivia asked several questions in her email — the app now answers most of them:

- **Receipts** are attached to each expense and stored in the app; approvers and
  auditors can view every one. Receipts are **required over $50**, and if someone
  truly has none they must sign a "no receipt" declaration — nothing bare gets
  submitted.
- **Fund / expense-code access** works just like ExpenseWire: each person can be
  limited to the accounts they're allowed to use, and each account can be limited
  to specific expense codes. General Fund is locked to 7xxxxxx codes and to the
  few people allowed to spend from it.
- **Web-based for audits:** it's a website (works on any phone — Apple or Android —
  and installs to the home screen). Finance/auditors can review approvals, open
  receipts, and export the data.
- **Coding:** every expense is coded (account → category) and carries the original
  amount **and** the USD value at the day's rate.
- **The Intacct hand-off:** Rembly now produces your exact **Journal-Entry Excel
  file** ("ExpWire batch" format). *(Show her the file — this is the headline.)*

Be honest about one in-progress item: **multi-level approval / approval tree** —
today it's a single approver (the person's upline). Ask if a deeper approval chain
is needed and for whom.

---

## 2. What we need from Cedarstone (the two asks)

These are the only things standing between "almost" and a file that uploads clean.

### ★ Ask A — the account → fund → class list

To finish coding each line, every account needs its **fund (DEPT_ID)** and its
**class (CLASSID)** — e.g. *Ukraine European Partner Ministry (430028)* → fund
**132-National Projs**, class **08-Ukraine**. Staff never type these; the app looks
them up from the account. We only have a few loaded so far.

> **Ask:** "Can you send the full list of our accounts with each one's **fund
> (DEPT_ID)** and **class (CLASSID)**? Once I have that, every expense codes itself
> and the export comes out complete."

(This likely already exists in your Intacct chart / a dimensions export.)

### ★ Ask B — how the Journal Entry balances

The sample you sent shows the expense **debit** lines. A JE also needs the
offsetting **credit** so it nets to zero.

> **Ask:** "Which account gets **credited** for the batch total — is it the
> `1100000` cash/clearing line? And the `7111100` bank-fee line at the top — how
> should that be figured? I want the JE to balance on upload."

Quick confirms while you're there:
- **DEBIT amounts are always in USD?** (looks that way in the sample)
- **MEMO** format — is `EW<report#> - <description>` what you want in the memo?

---

## 3. Answers to give back (she asked you these)

1. **Where are receipts stored/filed?** In the app, attached to each expense;
   viewable for audit. (Ask her preferred way to hand receipts over at pay time —
   files alongside the sheet, a combined PDF, or a link?)
2. **How are expenses paid?** Same as today — Cedarstone/ExpenseWire runs the ACH;
   Rembly hands off the coded batch and tracks what's been paid.
3. **Web platform for research/audits?** Yes — covered above.
4. **Multiple approval levels / tree?** Single approver today; ask what they need.
5. **Restrict users to funds/codes like EW?** Yes — built.
6. **Banking info?** Rembly doesn't store bank details or move money; that stays in
   your payment process. Confirm that's fine.
7. **Apple + Android app?** It's a web app that works on both and installs to the
   home screen (no app-store download needed).

---

## 4. Nice to close on

- **Cadence:** per pay run, file within a day of payment, expenses in by the 2nd,
  close on the 20th — confirm we've got that right.
- **Corrections:** she mentioned a similar upload with original + correcting info —
  worth a sentence on how they want re-sends handled.
- **Longer term:** would they want Rembly to push straight into Intacct (skip the
  spreadsheet) once this is proven? (She said "possibly.")
