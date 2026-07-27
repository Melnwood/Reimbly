# Design: Funds & Categories — matching JV's real two-level coding (the right way)

> **Status: planned. This is the durable fix for how expenses get coded.** It
> replaces a naming mix-up in the base (below) with the same two-level model JV's
> accounting system uses: pick a **Fund**, then a **Category (GL code)** valid for it.

## The problem we're fixing

The live **"JV Expenses"** base grew a naming mismatch:

- The table called **`Accounts`** actually holds the **145 GL expense codes**
  (`8392000 Travel Automobile`, `7412101 President Travel-Lodging`, …). Those are
  **categories**, not accounts — and the app's "Account" picker shows them, which is
  why a category like "Travel Automobile" appeared in an "Account" field.
- JV's real **Funds / Expense Types** (`002060 Mel & Amy Ellenwood`,
  `010000 General Fund`, `510173 People & Culture`, …) are **not in the app**. The
  `Teams` table was meant for this but holds only placeholder samples.
- A legacy **`Categories`** table holds ten friendly names (Meals, Lodging…),
  largely unused.

So the app has the *categories* (mislabeled "Account") but not the *funds*.

## The correct model

Every expense is coded with **two** things, exactly like the accounting screen:

1. **Fund / Expense Type** — *which pot of money* (`010000 General Fund`,
   `002060 Mel & Amy Ellenwood`, …). Picked first.
2. **Category** — *what kind of expense*, the GL code (`8392000 Travel Automobile`).
   Picked second, and **filtered to the codes valid for that fund**.

**Fund → category rule (data-driven, extensible).** Each fund and each category
carries a **Category Set**. Today there are two sets:

| Fund | Category Set | Codes |
|---|---|---|
| General Fund (010000) | `General Fund` | 7-series |
| Every other fund | `Ministry` | 8-series |

The picker shows categories whose set matches the chosen fund's set. It's a field,
not hardcoded 7-vs-8 logic, so a third set (or a fund that switches sets) is just
data later — no code change.

## Airtable changes — additive and non-destructive

Nothing is deleted or renamed; existing expenses keep working. We only **add**:

1. **`Funds` table** — `Code`, `Name`, `Category Set` (single-select:
   General Fund / Ministry). Seeded with the known funds; add rows anytime.
2. **`Category Set`** single-select on the existing `Accounts` (GL-code) table —
   populated `7… → General Fund`, `8… → Ministry` (from the code's leading digit,
   one-time).
3. **`Fund`** link field on `Expenses` → `Funds`.

The `Accounts` table keeps its name internally (renaming it would touch a lot of
code for no user benefit); the app just **labels it "Category"** everywhere the
person sees it. The legacy `Categories` and `Teams` tables are left untouched for
now and retired later once nothing references them.

## App changes

- **Add expense form:** a **Fund** picker first (required), then the **Category**
  picker (the existing GL-code list, relabeled from "Account"), filtered to the
  fund's set, type-to-search. The inline editor (My reports) gets the same two.
- **Storage:** `submit-expense` / `update-expense` store both the `Fund` link and
  the `Category` (GL code) link, validating the category belongs to the fund's set.
- **Everywhere "Account" shows** (dashboard grouping, review, CSV export, audit):
  relabel to "Category" / add "Fund" so the words match the accounting system.
- **Access control:** the existing "restricted account / Allowed Accounts" mechanism
  moves to **Funds** (some funds are visible only to granted people) — this is the
  natural home for "who can charge to General Fund vs a ministry account."

## Migration & rollout (safe order)

1. Add the three Airtable pieces above; tag the 145 categories by set; seed Funds.
2. Ship the app changes behind the new Fund picker.
3. Existing expenses keep their category; they simply gain a Fund when next edited
   (or we backfill a best-guess fund in a one-time pass if wanted).

## What's needed from Mel

- The **full list of Funds** (code + name). Six are known so far:
  `001119 Selah · 002060 Mel & Amy Ellenwood · 010000 General Fund ·
  510173 People & Culture · 510188 Counseling Support · 510194 Donor Relations`.
  The framework works with these now; more are just new rows.
- Confirm any funds **other than General Fund** that should use the 7-series
  (assumption: only General Fund does).

## Build checklist

1. Create `Funds` table + `Category Set` field on Accounts + `Fund` link on Expenses.
2. Tag the 145 GL codes by set (7→General Fund, 8→Ministry). Seed known funds.
3. `options` returns funds (visible to the person) + categories with their set.
4. Form: Fund picker → filtered Category picker (type-to-search); store both.
5. Inline editor: same two pickers.
6. Relabel "Account" → "Category" and surface "Fund" across dashboard/review/audit/CSV.
7. Move restricted-access from accounts to funds.
8. Tests: fund→category set filtering; category rejected if it doesn't match the fund.
