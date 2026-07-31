# ExpenseWire exports — JV's real coding lists

JV's current expense system is **ExpenseWire**. These are cleaned exports of its two
coding lists (internal GUIDs/emails stripped), kept as the authoritative source for
what Rembly's pickers should offer.

## What each list is

- **[expense-types.csv](expense-types.csv)** — the **Expense Type** a person picks:
  their ministry account + purpose, e.g. `002060 – Mel & Amy Ellenwood – 1 – Ministry`,
  `010000 – General Fund`, `001119 – JV Selah`. **~256 accounts**, each often with
  variants (`-1-Ministry`, `-2-Ministry Mileage`, `-3-Home Assignment`, `-5-Conference`)
  → **405 rows** (145 are the mileage variants). Each Expense Type **rolls up to one
  GL Account** (the `gl_rollup` column).
- **[gl-accounts.csv](gl-accounts.csv)** — the **GL Account** rollup buckets an Expense
  Type maps to: `1010 – Staff-General`, `1101 – JV General`, `1151 – Camps`,
  `1015 – Staff-Home Assignment`, … (**18 in active use**). Derived from the Expense
  Type — the person doesn't pick this directly.

## How this resolves earlier confusion

- The **real fund/account list** people code to = these **Expense Types** (`0xxxxx`),
  *not* the Intacct department IDs (`710-General Fund`) a parallel build had guessed.
- **General Fund = Expense Type `010000`.**

## Still open (asked of Mel)

1. **The Expense Category (`7xxxxxx` / `8xxxxxx`) list.** An earlier ExpenseWire
   "Edit line item" screenshot showed a *second* picker — an Expense Category with GL
   codes like `7412101 President Travel-Lodging`, `8392000 Travel Automobile` — separate
   from the Expense Type. Those aren't in these two exports. Need that list (a third
   export) and confirmation of the two-picker flow (Expense Type **and** Category).
   ~145 of these are already loaded in the base's `Accounts` table from screenshots.
2. **Access:** with ~256 accounts (mostly per-staff), the app should show each person
   only their own Expense Types plus shared ones (e.g. General Fund). How is "who may
   use which account" defined?
