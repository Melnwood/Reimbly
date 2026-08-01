# Intacct upload format — confirmed by Cedarstone

**Source:** Olivia Lightner (Managing Director, Integrated Services, Cedarstone),
email thread **"new app that i am building"** to Mel, 29–31 Jul 2026. Two
attachments, now saved in Mel's Google Drive:

- **JV ExpWire Example.xlsx** — [Drive](https://drive.google.com/file/d/1e12tRcPJDwa6KFxvMuNdH7dP7rM-fghR/view)
  - tab **AnalyticsOutput** = the raw export they pull from ExpenseWire.
  - tab **ExpWire batch 143** = **the exact file/format they upload into Intacct.**
- **JV Expense codes in EW.xlsx** — [Drive](https://drive.google.com/file/d/1yYnQcFPNG9naPut-YAenrCWdUQ7m8QIt/view)
  — the short list of usable expense (GL) codes + the ExpenseWire *User accounts*
  export showing how users are restricted to specific funds/codes.

Cedarstone owns and maintains the chart of accounts. Keep this doc in step if they
send a revised template. This is the master reference for building the export.

> **Status — export built (v1), live.** Management → **Paid** has an **"Export for
> Intacct (JE)"** button (Finance only). It builds the .xlsx in this exact column
> format from the payable batch (Approved + Waiting-to-be-paid), one debit line per
> expense. `lib/intacct.js` maps the fields; `export-intacct.js` reads Airtable and
> writes the workbook with the `xlsx` package. It fills everything Rembly reliably
> has — `JOURNAL`, `DATE`, `DESCRIPTION`, `LINE_NO`, `ACCT_NO` (GL code),
> `LOCATION_ID`, `MEMO`, `DEBIT` (USD), and `GLENTRY_PROJECTID` (the account code)
> — and pulls `DEPT_ID` / `GLENTRY_PROJECTID` / `GLENTRY_CLASSID` from the
> expense's Fund/Project links when present. Lines still missing a **fund** or
> **class** are reported back on export instead of shipping half-coded.
>
> **Still to finish** (needs the two open questions below answered): (a) populate
> Fund/Project/Class per expense so `DEPT_ID` and `GLENTRY_CLASSID` fill in for
> every line, and (b) add the balancing **credit line(s)** so the JE nets to zero.
>
> **Download = one payment batch (v2).** Downloading the Intacct file is now the
> hand-off, not just a read. It takes every **Approved** expense, stamps them with
> a **Payment Batch** id + **Exported On** time (both fields on the Expenses table),
> and moves them to **Waiting to be paid**. On the Paid screen each download shows
> as its own card with the date/time it was downloaded and a single **"Mark this
> download paid"** button that reimburses everyone in it at once (`mark-paid` with
> a `batchId`). The person-facing "My reports" screen shows the same lifecycle:
> On its way → (download) Reimbursing → (paid) Paid. The **Plain CSV** button is a
> read-only peek and moves nothing.

## How Cedarstone loads it (Olivia's answers)

- **Delivery:** an **Excel file** (their preferred method unless we do a direct
  Intacct sync). **Per pay run**, delivered **within a day of payment**. Expenses
  in by the **2nd** of the month; their close is the **20th**.
- **Booked as a Journal Entry (JE)** — *not* an Employee Expense Report and *not*
  an AP bill. (EW already tracks vendor detail; Intacct just gets the JE.)
- **Currency:** keep the **original amount** (to match the receipt) **and** the
  **USD** value at the **day's exchange rate**.
- **Receipts:** required **over $50**, itemized; retained **7 years**. Cedarstone
  needs easy access to them for audit.
- **Coding rule:** General Fund lines **must** use a **7xxxxxx** GL code; only a
  few people may spend from the General Fund; other funds are user-restricted too.
  (This is the account/category + access model Rembly already enforces.)

## The upload tab ("ExpWire batch 143") — one JE per batch

**Columns, in order:**

```
DONOTIMPORT, JOURNAL, DATE, REVERSEDATE, DESCRIPTION, REFERENCE_NO, LINE_NO,
ACCT_NO, LOCATION_ID, DEPT_ID, DOCUMENT, MEMO, DEBIT, CREDIT, SOURCEENTITY,
CURRENCY, EXCH_RATE_DATE, EXCH_RATE_TYPE_ID, EXCHANGE_RATE, STATE, ALLOCATION_ID,
BILLABLE, GLENTRY_PROJECTID, GLENTRY_CUSTOMERID, GLENTRY_CLASSID,
GLENTRY_EMPLOYEEID, GLENTRY_VENDORID
```

**One debit line per expense.** Values seen in the sample:

| Column | Value | Comes from (Rembly) |
| --- | --- | --- |
| `JOURNAL` | `EE` | constant (the JE journal symbol) |
| `DATE` | batch/paid date (e.g. `7/23/2026`) | the pay-run date |
| `DESCRIPTION` | `EW Batch 143` | `EW Batch <n>` — same on every line |
| `LINE_NO` | `1,2,3,…` | sequential |
| `ACCT_NO` | `8490000` | the expense's **Category** GL code |
| `LOCATION_ID` | `JV NFP--Josiah Venture` | constant |
| `DEPT_ID` | `132-National Projs` / `710-General Fund` | the **Fund** (Intacct DEPT_ID) |
| `MEMO` | `EW2827 -Cash for EU camps…` | `EW<report#> -<description>` |
| `DEBIT` | `668.21` | amount in **USD** |
| `GLENTRY_PROJECTID` | `430028` | the **Project** (= the ExpenseWire "Expense Type" number) |
| `GLENTRY_CLASSID` | `08-Ukraine` / `00-JV Wide and USA` | the **Class / country** (derives from the project) |

Everything else (`REVERSEDATE`, `REFERENCE_NO`, `DOCUMENT`, `CREDIT`,
`SOURCEENTITY`, `CURRENCY`, exch-rate fields, `STATE`, `ALLOCATION_ID`,
`BILLABLE`, `GLENTRY_CUSTOMERID`, `GLENTRY_EMPLOYEEID`, `GLENTRY_VENDORID`) is
blank on the expense lines in the sample.

### How the raw EW export maps in

From the **AnalyticsOutput** tab → the JE:

- `Expense Category (Custom)` **"8490000 - Camps General"** → `ACCT_NO` = `8490000`
- `Expense Type` **"430028 - Ukraine European Partner Ministry"** → `GLENTRY_PROJECTID` = `430028`
  (and the fund `132-National Projs` + class `08-Ukraine` follow from that project)
- `Expense Amount` → `DEBIT`  ·  `Expense Description` → `MEMO`  ·  `Paid Date` → `DATE`  ·  `Batch ID` → the batch number in `DESCRIPTION`

## What Rembly has vs. still needs

- **Have already:** amount (USD + original), description, date, and the **GL
  category code** (`ACCT_NO`). The **Expense Account** a person picks is usually
  the **Project** number (`GLENTRY_PROJECTID`).
- **Gap:** each expense also needs its **Fund** (`DEPT_ID`), **Project**
  (`GLENTRY_PROJECTID`), and **Class** (`GLENTRY_CLASSID`). The base already has
  Funds/Projects tables and Intacct dimension lookups (from the merge work); the
  live submit flow doesn't populate Fund/Project per expense yet. Closing that is
  the main build for a correct export.

## Open questions to confirm with Olivia (or from a real, non-sample batch)

1. **The credit side.** The sample shows only expense **debits** (plus a
   `1100000` line and a `7111100` fee line). Confirm the offsetting **CREDIT**
   (AP/cash clearing account `1100000` for the batch total?) and how the **bank
   fee** (`7111100`) is represented, so the JE balances.
2. **DEBIT currency** — confirm it's always **USD** (the sample amounts look USD).
3. **MEMO convention** — confirm the `EW<report#> -<description>` prefix.

A short Zoom with Olivia (she offered Wed Aug 5 / Thu Aug 6 AM MST) would settle
these; then the export can be built to load cleanly on the first try.
