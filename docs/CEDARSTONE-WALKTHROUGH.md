# Reimbly → CedarStone: the Intacct hand-off (meeting walkthrough)

A step-by-step script for walking Olivia Lightner (CedarStone) through how Reimbly
produces the Intacct upload, using the two files she sent (Aug 2026). Walk it top
to bottom; the **"Confirm with Olivia"** items are the questions to settle in the
meeting. Grounded in her own **ExpWire batch 146** so she recognizes everything.

Reference docs: [INTACCT-UPLOAD-FORMAT.md](INTACCT-UPLOAD-FORMAT.md) ·
[chart-of-accounts/fund-dimensions.csv](chart-of-accounts/fund-dimensions.csv) ·
her originals in [chart-of-accounts/source/](chart-of-accounts/source/).

---

## At a glance (what to open with)

Reimbly is replacing ExpenseWire. CedarStone's side doesn't change: you still get a
single Excel journal entry per pay run, in the exact ExpWire column format, and load
it into Intacct the same way. Four things to show:

1. It **matches your ExpWire format** — same columns.
2. It **balances every time** — bank clearing credit + fee + expense debits.
3. Every **dimension comes straight from your fund listing**.
4. It's **validated against your own batch 146** — line for line.

---

## Step 1 — What you sent, and what we did with it

- **`JV ExpenseWire example_2.xlsx`** (your corrected sample). This told us the
  **credit side**: the whole batch total is **credited to bank clearing `1100000`**,
  and the **wire fee is debited to `7111100`**. That's now exactly how Reimbly builds
  the file.
- **`JV Intacct Fund listing with Dimensions.xlsx`** (all active funds). This is the
  **dimensions source**. For every fund, its *Ministry Type* and *Country* become the
  journal entry's department and class. Reimbly now fills those automatically.

---

## Step 2 — The file Reimbly hands you

- **One journal entry per pay run**, as an **Excel file**, delivered **within a day of
  payment** — same as today.
- **Same columns, same order** as your ExpWire batch tab (`DONOTIMPORT, JOURNAL, DATE,
  … ACCT_NO, DEPT_ID, MEMO, DEBIT, CREDIT, … GLENTRY_PROJECTID, GLENTRY_CLASSID …`).
- **Shape of every batch:**
  - **Line 1** — the whole total, **credited** to bank clearing `1100000`.
  - **Line 2** — the **wire fee**, debited to `7111100` (only when there's a fee).
  - **Lines 3+** — one **debit** line per expense.

---

## Step 3 — A real example: your batch 146

The file Reimbly produces for this batch (your own numbers):

| Line | Account | Dept (DEPT_ID) | Memo | Debit | Credit | Project | Class |
|---|---|---|---|--:|--:|---|---|
| 1 | `1100000` | 710-General Fund | EW Batch 146 | | **2,269.09** | 10000 | 00-JV Wide and USA |
| 2 | `7111100` | 710-General Fund | Fee for EW Batch 146 | 2.50 | | 10000 | 00-JV Wide and USA |
| 3 | `8392000` | 110-USA Staff | EW2722 – Driving Malenovice→Tallinn | 621.00 | | 210730 | 07-Estonia |
| 4 | `8396000` | 110-USA Staff | EW2725 – Parking, airport pickup | 2.32 | | 210730 | 07-Estonia |
| … | … | … | … | … | | … | … |
| — | `8396000` | 110-USA Staff | EW2826 – Fuel on a rental | 75.84 | | 032170 | 03-Slovakia |

(47 rows total: the two bank lines + 45 expenses.)

---

## Step 4 — It balances

Total **credit** = total **debit**, every time:

> **$2,269.09 credited** to the bank  =  **$2.50** fee  +  **$2,266.59** of expenses.

If any line is ever missing its account, fund, or class, Reimbly flags it on download
rather than shipping a half-coded entry.

---

## Step 5 — Every dimension comes from your fund listing

The account a person spends from **is** their fund, so no extra coding is needed. From
your listing:

| Your fund listing column | Becomes (in the upload) |
|---|---|
| Fund ID | `GLENTRY_PROJECTID` |
| Ministry Type ID | `DEPT_ID` |
| Country ID | `GLENTRY_CLASSID` |
| Entity ID | `LOCATION` (`JV NFP → JV NFP--Josiah Venture`) |

**Example:** fund **`210730` – Garrett & Brittney Haas** → dept **110-USA Staff**,
class **07-Estonia**. That's exactly what shows on lines 3–4 above.

---

## Step 6 — We validated it against your own file

We fed your batch 146 expenses through Reimbly and compared the result to your
`example_2` file: **all 47 rows match** — accounts, departments, projects, classes —
and the **$2,269.09 balance is exact**. So a real batch should load the same way yours
does.

---

## Step 7 — Confirm with Olivia (the decisions to settle)

1. **General Fund project number.** Your upload file shows the General Fund project as
   **`10000`** (no leading zero); the fund listing writes it **`010000`**. Reimbly emits
   `10000` to match the file that imports cleanly. **Is `10000` the right key in Intacct?**
2. **The wire fee.** Reimbly lets us type the wire fee per run so the batch matches what
   leaves the bank. **Is that the right approach — or does CedarStone supply the fee?**
3. **Delivery cadence.** Excel, one JE per pay run, within a day of payment; expenses in
   by the **2nd**, your close on the **20th**. **Still correct?**
4. **Receipts & audit.** Receipts required over **$50**, itemized, retained **7 years**.
   **How does CedarStone want to reach them** for audit — a link per line, a zip per batch?
5. **Chart of accounts / fund listing ownership.** CedarStone stays the owner. **How will
   you send us updates** (new funds, recoded dimensions, new GL codes) so we stay in step?
6. **Currency.** The JE carries the **USD** value at the day's exchange rate; the original
   amount is kept alongside to match the receipt. **Confirm USD is what the JE should show.**
7. **Anything else in the file?** e.g. `REFERENCE_NO`, vendor detail — **is anything missing**
   for how you post or reconcile?

---

## Step 8 — Going forward

- Reimbly produces the JE; CedarStone loads it into Intacct — unchanged workflow.
- CedarStone owns the chart of accounts and the fund→dimensions listing; we regenerate
  from whatever you send.
- Same cadence and receipt rules as today.
