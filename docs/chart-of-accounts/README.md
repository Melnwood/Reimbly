# JV chart of accounts — expense categories (staging)

These are the **GL expense-category codes** JV uses in the accounting system, captured
so Rembly's category picker can match them. The goal: when someone enters an expense,
they pick their **Expense Type** (the fund/account) and then an **Expense Category**
(the GL code) that's *valid for that fund* — the same two-level coding the accounting
system uses.

## The key rule: categories depend on the account

The valid category list is **not** universal — it depends on which **Expense Type
(account)** the expense is charged to. As of this capture there are **two sets**:

| Account (Expense Type) | Category set | File |
|---|---|---|
| **General Fund (010000)** | 7-series (HQ / org-level) | [`general-fund-categories.csv`](general-fund-categories.csv) |
| **Every other account** (ministry accounts, Selah, field accounts…) | 8-series (field ministry) | [`standard-ministry-categories.csv`](standard-ministry-categories.csv) |

So the picker should show the 7-series **only** when the account is the General Fund,
and the 8-series for everything else.

## Status & accuracy caveat

**Captured from screenshots of the accounting system — verify before it goes live.**
Screenshots scroll, so the **top and bottom edges of each list may be clipped**:

- General Fund list captured `7111000` → `7425000`.
- Standard ministry list captured `8147000` → `8580000` — there may be 8-series codes
  **above 8147000** that weren't on screen.

The clean way to finalize is a **CSV export of both lists from the accounting system**
(one file, columns: fund + code + name). That's also exactly what the CedarStone /
Intacct work needs — see [`../INTACCT-INTEGRATION.md`](../INTACCT-INTEGRATION.md) and
[`../CEDARSTONE-QUESTIONS.md`](../CEDARSTONE-QUESTIONS.md). Until then, these CSVs are the
working source; correct any code here and it flows into Rembly on the next load.

## Fund → Intacct dimensions (from CedarStone, Aug 2026)

Olivia Lightner (CedarStone) sent the **authoritative listing of all active funds
with their Intacct dimensions** — required for the JE upload. It's captured here:

- [`fund-dimensions.csv`](fund-dimensions.csv) — 1,033 funds, human-readable.
- [`source/JV-Intacct-Fund-listing-with-Dimensions.xlsx`](source/) — Olivia's original.
- Generated into code as [`../../netlify/functions/lib/fund-dimensions.js`](../../netlify/functions/lib/fund-dimensions.js)
  (regenerate from the CSV; don't hand-edit).

**When CedarStone sends an updated listing:** save it as `fund-dimensions.csv` here
(columns: Fund ID, Fund name, Fund type, Ministry Type ID, Country ID, Entity ID),
then run:

```
npm run gen:funds     # rebuild lib/fund-dimensions.js from the CSV
npm run check:funds   # list any accounts people can pick that the listing doesn't cover
```

`check:funds` is the safety net: it names any pickable account with no dimensions
(as of this listing, 4 — e.g. "JV HR", "Emils Rolavs"). Those are exactly the lines
the Intacct download will refuse to ship half-coded, so send the list back to
CedarStone to get their dimensions (or retire the account).

Each **Fund ID** (the support/project account a person spends from — the same code
as the Accounts/Expense Type list above) carries the dimensions the upload needs:

| Listing column | Becomes (Intacct upload) |
|---|---|
| Fund ID | `GLENTRY_PROJECTID` (the General Fund shows as `10000`, others keep 6 digits) |
| Ministry Type ID | `DEPT_ID` (e.g. `110-USA Staff`, `132-National Projs`) |
| Country ID | `GLENTRY_CLASSID` (e.g. `07-Estonia`, `00-JV Wide and USA`) |
| Entity ID | `LOCATION` (`JV NFP` → `JV NFP--Josiah Venture`) |

This closes the old "each expense still needs its fund/project/class" gap: the
export now fills all three dimensions straight from the fund. See
[`../INTACCT-UPLOAD-FORMAT.md`](../INTACCT-UPLOAD-FORMAT.md). Also in `source/` is
**JV-ExpenseWire-example-2.xlsx** — Olivia's corrected sample upload the exporter
is validated against.

## How this maps into Rembly

- Rembly already has **Accounts** (= Expense Type, code + name) and **Categories**
  (= Expense Category, with a GL Code). This adds an **account → category-set** link so
  the category dropdown filters to the right list, and makes the picker **type-to-search**
  (start typing "lodging" or "7412") since the lists are long.
