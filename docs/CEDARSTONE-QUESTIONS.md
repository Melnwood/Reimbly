# Questions for Cedarstone — how they interface with expenses

*A checklist to send Cedarstone (or walk through on a call) so Reimbly can fit
their process. The **★ ask-first** items matter most — their answers alone let
us tune the export, and later the Intacct integration, to match exactly.*

## How they want expenses delivered

- **★ What format do you want the monthly expense batch in — Excel, CSV, a PDF
  packet, or entered directly into Intacct?**
- **★ What exact fields do you need per expense?** (date, who spent it, amount,
  currency, GL account, any dimensions, business purpose, receipt)
- How do you want **receipts** — attached files, a link, one combined PDF, or
  already in Intacct?
- How often do you want the batch — monthly, per pay run, or continuously?
- Is there a **cutoff / deadline** each period we need to hit?

## How they code & enter it in Intacct

- **★ Do you enter reimbursements as Employee Expense Reports, or as AP / vendor
  Bills?** (this drives everything on our side)
- **★ Which dimensions do you code each line to — department, location, project,
  class, fund, custom — and which are required?**
- Are our staff set up in Intacct as **Employees, as Vendors, or not at all?**
- Any **account × dimension combinations that are required or not allowed** —
  coding rules we should enforce in the app so it arrives correct?
- Who owns the **chart of accounts** — if a code is added or retired, does that
  come from you?

## Approval, documentation & controls

- What do you need to see to consider an expense **"ready"** — receipt, business
  purpose, approver name, date, amount, coding?
- Is our **internal approval** enough, or do you need a specific approver
  signature / name on each one?
- What's your **receipt policy** — required over a dollar threshold? itemized?
  how long must we retain them?
- Any **spending rules** we should build in (per-diems, limits, non-reimbursable
  categories)?

## Reimbursement & currency

- How do staff **actually get paid back** — payroll, bank transfer, check — and
  who runs that, you or JV?
- Typical **timing** from submission to reimbursement?
- **★ How do you handle foreign currencies?** Do you want the original amount,
  USD, or both — and whose exchange rate do you use?
- How do **card / already-paid** expenses differ from out-of-pocket
  reimbursements in your process?

## Reconciliation & close

- How do you confirm you **got everything** for a period? (this is exactly what
  Reimbly's "check coverage" feature is for)
- When's your **month-end close**, and when do you need our expenses by?
- How do you want **corrections or rejections** handled after something's been
  sent?

## Integration (the bigger picture)

- Do you use Sage Intacct's **Employee Expenses module**, or AP bills, for these?
- Is there **API access / a sandbox**, and who owns the Intacct admin — you, JV,
  or an implementation partner?
- Would you be open to Reimbly **pushing coded, receipt-attached expenses
  straight into Intacct** instead of a spreadsheet?
- Any **other tools already feeding Intacct** we'd need to work alongside?

---

**If you only ask five things:** the delivery format + required fields,
expense-report-vs-AP-bill, which dimensions, and how they handle currency.

*See also [`INTACCT-INTEGRATION.md`](./INTACCT-INTEGRATION.md) for the technical
integration brief.*
