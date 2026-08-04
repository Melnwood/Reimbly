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

> **Status — export built (v3), balanced & fully coded.** Management → **Paid** has
> a **"Download for Intacct & start paying"** button (Finance only). It builds the
> .xlsx in this exact column format from the payable batch. `lib/intacct.js` maps
> the fields; `export-intacct.js` reads Airtable and writes the workbook with the
> `xlsx` package.
>
> **Now complete (Aug 2026), from Olivia's example_2 + fund listing):**
> - **Balances.** The JE opens with a **credit to bank clearing `1100000`** for the
>   whole batch total, then a **debit to bank fee `7111100`** for the wire fee (only
>   when there is one), then one **debit line per expense**. Total debit = total
>   credit, every time (`je.balanced`).
> - **Every dimension filled.** `DEPT_ID`, `GLENTRY_PROJECTID`, and
>   `GLENTRY_CLASSID` are derived from the **fund** each expense is booked to, via
>   CedarStone's fund→dimensions listing (`lib/fund-dimensions.js`, generated from
>   [chart-of-accounts/fund-dimensions.csv](chart-of-accounts/fund-dimensions.csv)).
>   The bank/fee lines use the General Fund's dimensions (`710-General Fund` /
>   project `10000` / `00-JV Wide and USA`), matching Olivia's file.
> - **Validated** against Olivia's `JV-ExpenseWire-example-2.xlsx` — the builder
>   reproduces all 47 rows of batch 146 (accounts, depts, projects, classes) and the
>   $2,269.09 balance exactly. See `test/intacct.test.js`.
>
> Any line still missing a GL account / fund / class (e.g. an unknown fund code) is
> reported back on export instead of shipping half-coded.
>
> **The wire fee** is entered in a "Wire fee $" box next to the download button and
> passed to the export (`fee`); default `0` means no fee line and the credit equals
> the expense total. It's saved on the batch (Expenses → **Batch Fee**) so a
> re-download reproduces the file exactly.
>
> **Won't ship half-coded (v4).** The download builds the file first and, if any line
> is missing its GL account / fund / class, it **stops and lists exactly which
> expense (and whose) to fix — nothing is committed** (no batch id, nothing moved to
> "waiting to be paid"). Only a fully-coded batch goes out. `lib/fund-dimensions.js`
> covers 252 of 256 pickable accounts; `npm run check:funds` names the rest.
>
> **A Summary sheet** rides along in the workbook (second tab): batch, date, #
> reports/people, expense total, wire fee, total credited, and **Balanced: Yes** — so
> CedarStone can eyeball completeness and balance on open. `Journal Entry` stays the
> first tab (the one they import).
>
> **Re-download a past batch.** The Paid screen's waiting cards have a **Download
> again** button (`redownload-intacct`) that rebuilds the exact file for that batch —
> same label, date, and saved wire fee — without changing anything. For a lost file
> or a second copy for CedarStone.
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
- **Gap — now closed.** Each expense's **Fund** (`DEPT_ID`), **Project**
  (`GLENTRY_PROJECTID`), and **Class** (`GLENTRY_CLASSID`) are derived from the
  fund it's booked to, using CedarStone's fund→dimensions listing
  (`lib/fund-dimensions.js`). The account a person picks *is* the fund, so no extra
  data entry is needed. An explicit Fund/Class on the expense still overrides the
  lookup if CedarStone ever recodes one.

## Open questions — answered by Olivia (email + example_2, Aug 2026)

1. **The credit side. ✅ Confirmed.** The whole batch total is **credited to bank
   clearing `1100000`** (line 1). The bank/wire **fee is debited to `7111100`**
   (line 2), memo `Fee for <batch>`. In example_2, batch 146 = $2,269.09 credit,
   $2.50 fee + $2,266.59 of expense debits. The JE nets to zero.
2. **DEBIT currency. ✅** Amounts are **USD**.
3. **MEMO convention. ✅** `EW<report#> -<description>` (e.g. `EW2722 -Driving from…`).
4. **Fund listing → dimensions. ✅** Olivia sent the full active-fund listing with
   dimensions (required for import). Each Fund ID's **Ministry Type → `DEPT_ID`** and
   **Country → `GLENTRY_CLASSID`**; the Fund ID itself is the `GLENTRY_PROJECTID`.
   Captured in [chart-of-accounts/fund-dimensions.csv](chart-of-accounts/fund-dimensions.csv)
   and `lib/fund-dimensions.js`.

**One nuance to confirm with Olivia:** the General Fund's project shows as **`10000`**
(no leading zero) in her upload file, while the fund listing writes it **`010000`**.
The exporter emits `10000` to match the file that imports cleanly; worth a one-line
confirmation that Intacct keys the General Fund project on `10000`.

**Sources** (Olivia Lightner, CedarStone), saved in [chart-of-accounts/source/](chart-of-accounts/source/):
`JV-ExpenseWire-example-2.xlsx` (the corrected sample upload) and
`JV-Intacct-Fund-listing-with-Dimensions.xlsx` (all active funds + dimensions).
