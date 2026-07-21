# Reimbly × Sage Intacct — Integration Brief

*Prepared July 2026 · research / for investigation · share with Cedarstone and JV finance/IT*

One coded, receipt-attached expense flowing from a staff member's phone all the
way into Intacct — with each person seeing only the accounts and dimensions that
apply to them.

## The short version

- **Sync down:** Reimbly can pull your chart of accounts **and** dimensions
  (department, location, project, class, etc.) directly from Intacct, so the
  pickers in the app always match Intacct exactly — no more manual account
  uploads.
- **Push up:** When an expense is approved, Reimbly can write it into Intacct —
  fully coded, with the receipt attached — as an Employee Expense Report or an
  AP Bill. Cedarstone reviews in Intacct instead of re-keying a spreadsheet.
- **Per-person profiles:** Limit each user to just their relevant accounts and
  dimension values. This is the fix for the "enormous drop-downs" and the
  miscoding they cause. Account-level limits are **already live in Reimbly**;
  dimensions are the natural next step.
- **Two API paths** exist (modern REST, GA Feb 2025; and the older,
  fuller-coverage XML). A hybrid is normal. The main prerequisite is Intacct API
  access and a sandbox company.

## Why it's worth doing

Today the monthly hand-off is a spreadsheet that someone at Cedarstone re-enters
into Intacct — slow, and every re-key is a chance to mis-code. A direct
connection removes that step and makes Intacct the single source of truth:

- **One source of truth.** Accounts and dimensions live in Intacct; Reimbly
  mirrors them. When Cedarstone adds or retires a code, it shows up in the app
  automatically — nothing to maintain twice.
- **No re-keying.** Approved expenses land in Intacct already coded, with the
  receipt attached.
- **Fewer errors.** Because each person only sees their own accounts and
  dimensions, the wrong code mostly can't be picked in the first place.
- **Faster close.** Cedarstone reviews finished transactions instead of
  assembling them.

## How the connection works

Two directions, worth thinking about separately — the "read" side is low-risk
and useful on its own, well before you ever write anything back.

### ← Pull · Reimbly reads Intacct (keep the pickers in sync)

- Read the **GL chart of accounts** on a schedule.
- Read **dimension values** — department, location, project, class, employee,
  plus any custom dimensions.
- Reimbly's account & dimension menus always match Intacct — **no manual
  uploads**.
- Retired codes disappear from the app automatically.

### → Push · Reimbly writes to Intacct (send finished, coded expenses)

- On approval, create an **Employee Expense Report** (or an **AP Bill**).
- Coded to the GL account **+ the right dimensions**.
- Attach the **receipt** as a supporting document / electronic receipt
  (Intacct `create_supdoc` / newer electronic-receipts API).
- Optionally read the **paid status** back into Reimbly to close the loop.

## Which API

Intacct exposes two developer interfaces. Neither choice is a trap — most real
integrations use a bit of both.

| | REST API | XML / Web Services |
|---|---|---|
| **Status** | Generally available since 2025 R1 (Feb 2025); where Sage is putting new work | Mature, still supported; no longer getting new schema features |
| **Format** | JSON, stateless, OAuth 2.0 | XML documents, session-based |
| **Auth** | Register an app in the Sage Developer Portal → Client ID/Secret | Web Services sender ID + password, plus a dedicated Web Services user in the company |
| **Coverage** | Growing, but not every object yet | Broadest object coverage today (incl. some expense/project areas) |
| **Best for** | Clean, modern reads/writes | Anything REST doesn't cover yet |

**Recommendation:** plan for a hybrid. Use REST where it covers the object; fall
back to XML (e.g. `create_supdoc` for receipt attachments, or expense-report
specifics) where it's more complete.

## Per-user profiles: the dimension fix

This is the piece that directly answers JV's request — and it's mostly built.
Reimbly already lets you mark accounts as **restricted** and grant them to
specific people (the executive general-fund accounts we just set up work exactly
this way). The extension is to apply the same idea to **every** dimension.

A person's profile would carry not just their accounts but their
**department(s), location(s), and project(s)**. When they submit, each dropdown
is pre-filtered to just those — so a field worker in one country sees a handful
of options, not the whole org. Shorter menus, and the wrong dimension
combination is far harder to pick. Because Reimbly reads these values from
Intacct (the "pull" above), the lists are always the real, current ones.

## A sensible order to build it

Each phase is independently useful — you get value from phase 1 long before
anything writes back to Intacct.

1. **Read-only account & dimension sync** *(low risk)* — Reimbly pulls the chart
   of accounts and dimension values from Intacct on a schedule. Kills the manual
   account uploads immediately; nothing is written back, so there's no risk to
   your books.
2. **Per-user account & dimension profiles** *(low risk)* — extend today's
   restricted-account model to departments, locations, and projects.
   Dramatically shorter dropdowns and far less miscoding — all still read-only
   against Intacct.
3. **One-way push into a sandbox** *(needs testing)* — write approved expenses
   into an Intacct *test* company as expense reports/AP bills with receipts
   attached. Validate the coding and the attachment flow with Cedarstone before
   touching live data.
4. **Go live + reconcile** *(sign-off)* — turn on the push to the live company,
   with Reimbly's existing audit and duplicate checks as the gate. Optionally
   read paid status back so "Reimbursed" in Reimbly reflects Intacct.

## What we'd need from Cedarstone & JV

A handful of answers scopes the whole thing. These are the questions to take
into the investigation:

- **Which modules are on?** Is the Employee Expenses module enabled, or do
  reimbursements go through AP as vendor bills? This decides the target object.
- **Which dimensions does JV actually use?** Department, location, project,
  class, and any custom dimensions — and which are required on an expense line.
- **Are staff set up as Employees in Intacct?** Expense reports post against
  employee records; AP bills post against vendors. We match on that.
- **Who owns API access?** Provisioning a Web Services sender ID / registering a
  REST app, creating a dedicated integration user, and a sandbox company —
  typically your Intacct admin or implementation partner.
- **Where does final approval live?** Does Intacct run its own approval
  workflow, or is Reimbly's approval the final word before posting?
- **Coding rules to enforce?** Any account × dimension combinations that are
  required or forbidden, so Reimbly can prevent bad coding up front.

## Bottom line

The read-only sync and the per-user dimension profiles are high-value and
low-risk, and lean directly on what Reimbly already does. The write-back to
Intacct is the bigger lift and the part that needs Cedarstone, a sandbox, and
API credentials — so it's worth scoping that conversation early.

## Sources

- Sage Intacct Developer — [API reference](https://developer.intacct.com/api/),
  [Expense Reports](https://developer.intacct.com/api/employee-expenses/expense-reports/),
  [AP Bills](https://developer.intacct.com/api/accounts-payable/bills/),
  [Attachments](https://developer.intacct.com/api/company-console/attachments/)
- Sage Developer — [Electronic receipts (expenses)](https://developer.sage.com/intacct/docs/openapi/ee/expenses.electronic-receipt/tag/Electronic-receipts/)
- Knit — [Sage Intacct API integration guide: REST, XML & auth (2026)](https://www.getknit.dev/blog/sage-intacct-api-integration-guide-in-depth)
- Apideck — [Sage Intacct API guide (SOAP/XML vs REST)](https://help.apideck.com/en/articles/5871298)

*Third-party summaries corroborate the vendor docs but aren't official; anything
version-specific (object coverage, edition features) should be confirmed against
your own Intacct instance and Sage's current docs during the investigation.*
