# Plan: merge the Intacct coding model into the live app

> **Decision (Mel):** keep this full-featured live app and fold in the accounting-
> correct model built on the other computer. Both builds share one Airtable base
> ("JV Expenses"); this plan unifies them into one app + one data model.

## What each build contributed

- **Live app (this repo):** the whole product — reports, review, timing, receipts,
  mileage, people, paid/export. Codes an expense with a single **Account** (really
  a GL code) from the **Accounts** table, which holds the **full 145 real GL codes**.
- **Intacct build (other computer):** the correct accounting *dimensions*, added to
  the base — a **Funds** table (`DEPT_ID`, e.g. `710-General Fund`, with a
  **Required GL Prefix** like `7`), a **Projects** table (`PROJECTID` + `Class`), an
  **Allowed Funds** access list on Staff, and a **Sage Intacct journal-entry CSV
  generator** (`_intacct.js`). Its own GL list (Categories → GL Account No) is only
  3 rows — not the source of truth.

## The unified model

Each expense is coded with three dimensions, exactly what the Intacct export needs:

| On the expense | Comes from | Intacct field |
|---|---|---|
| **Fund** (required) | `Funds` table (`710-General Fund`) | `DEPT_ID` |
| **GL account** (required) | `Accounts` table (`8394000`) — the code *is* the account no. | `ACCT_NO` |
| **Project** (optional) | `Projects` table | `GLENTRY_PROJECTID` + `GLENTRY_CLASSID` (Class) |

**Canonical GL source = the `Accounts` table** (populated, and `Code` = `ACCT_NO`).
The friendly `Categories` table and the `Teams` table are **retired for coding**
(kept only until nothing references them).

**Fund → GL rule:** the GL picker is filtered to the fund's **Required GL Prefix**
(General Fund → codes starting `7`; funds with no prefix → the rest, i.e. `8…`).
Enforced on submit, so an expense can't be coded to a GL that its fund disallows.

## Build phases (each ships on its own)

1. **Fund → GL picker on the form.** Add a **Fund** picker (from `Funds`), then the
   **GL account** picker (the existing Accounts list, relabeled "Category/GL account"),
   filtered by the fund's Required GL Prefix, type-to-search. Store `Fund` + `Account`
   links on the expense. Inline editor (My reports) gets the same. — *This is the
   thing Mel keeps asking for.*
2. **Project (optional).** Add a Project picker; store `Project`. Class derives via
   the base's existing lookup.
3. **Intacct export.** Port `_intacct.js` into the Paid/Export flow so a pay run
   produces the real Sage Intacct JE CSV (ACCT_NO/DEPT_ID/PROJECTID/CLASS + the
   balancing clearing line). Replaces / augments today's plain CSV export.
4. **Access & cleanup.** Move restricted-fund access to **Allowed Funds** on Staff;
   retire the redundant Categories/Teams coding paths and the reverted chart CSVs.

## Open decisions for Mel (needed before Phase 1 touches the base)

1. **Fund list.** The `Funds` table has three: `710-General Fund`, `133-Field
   Ministry`, `132-National Projs`. But your accounting screen showed `010000 General
   Fund`, `002060 Mel & Amy Ellenwood`, `510173 People & Culture`… — different
   numbers. **Which is the real fund list for coding?** (One is likely Intacct
   `DEPT_ID`; the other a different view.) I need the authoritative list + which
   funds require the `7` prefix.
2. **Confirm `Accounts` as the GL source** (recommended — it's the populated one and
   its Code is the Intacct ACCT_NO), rather than the Intacct build's empty Categories
   list.
3. **Is Project required or optional** at submit time?

## Guardrail: one session at a time

Both builds edit the **same live base**. To stop them overwriting each other, do this
migration from **one** Claude session/computer at a time until it's consolidated.
