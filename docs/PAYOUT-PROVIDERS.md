# Paying reimbursements: the "middle man" payout options (research)

> **Status: research / decision-support** (Aug 2026). Companion to
> [BILLDOTCOM.md](BILLDOTCOM.md). No provider chosen or connected yet.

**What we're looking for:** a service that takes the approved reimbursements from
Reimbly, lets each staff member enter *their own* bank details, and pays them out —
across JV's countries (Central & Eastern Europe + US, many currencies). The
question Mel asked: **what does it cost per person?**

**The one thing to understand about cost:** it's almost always **per payment**, not
a flat per-employee fee. Two levers dominate:

1. a small **per-payment fee**, and
2. the **FX (currency-conversion) markup** — and *this* is where most of the money
   goes when paying euros, koruna, złoty, hryvnia, etc. It ranges from ~0.4%
   (Wise) to 3–4% (PayPal). On JV's cross-border payments, FX is the real cost.

So the way to keep it cheap: **pay each person once per month (one batch)** to
minimize per-payment fees, and pick a provider with a **low FX markup**.

## The shortlist

| Provider | Staff self-enter bank details? | Reach / FX | Indicative cost | Fit for JV |
|---|---|---|---|---|
| **Trolley** (was Payment Rails) | **Yes** — a portal where each person adds bank + tax details | 210+ countries; FX added | ~$49/mo + **~1% intl, $4 min per payment** + FX | **Closest match** to "middle man w/ self-onboarding"; has an API Reimbly can push to |
| **Wise Business** | Partly — you hold/collect the details (Reimbly already does); upload a batch (CSV, up to 1,000) | Local rails in EU (SEPA) & US; **best FX (~0.3–0.7%)** | **No monthly fee**; small fixed fee + low FX | **Lowest cost**; great for Europe; less of a "recipient portal" |
| **Tipalti** | Yes — supplier/employee self-onboarding | 196 countries / 120 currencies | **$249/mo** Mass Payments + **$3–5 global ACH** ($26 SWIFT) + **1.9–3% FX**; real deployments $15k–150k/yr | Powerful, but **enterprise-priced — likely too much for JV now** |
| **Payoneer** | Yes — self-serve onboarding | Global | **~3% per transaction** | Pricey to send; better for *receiving* |
| **PayPal Payouts / Hyperwallet** | Hyperwallet is enterprise-only (can't self-sign-up); PayPal Payouts pays to PayPal accounts | Global | PayPal ~**2% + 3–4% FX** | Expensive FX; recipients need PayPal |
| **Bill.com** | Yes — vendor onboarding | US + international | Per-payment varies (quote) | Keep in the mix **only** for the existing Bill.com → Intacct pipe (less work for CedarStone) |

## What this means for JV

- **If the priority is self-service + compliance + hands-off** (staff manage their
  own details, tax/verification handled for you, one clean API into Reimbly):
  **Trolley** is the closest fit to what Mel described. The catch is the **$4-minimum
  per payment** — on a small reimbursement that's a big percentage, so batching
  monthly matters.
- **If the priority is lowest cost:** **Wise Business** — tiny fees, the best FX into
  Europe, no monthly fee. Reimbly already collects each person's bank details, so it
  can hand Wise a batch. Less of a "they onboard themselves in a portal" experience,
  but the cheapest by a clear margin.
- **Bill.com** stays interesting *not* on price but because it already flows into
  Intacct — which is the "less work for CedarStone" win (see BILLDOTCOM.md).
- **Tipalti / Payoneer / PayPal:** capable but more expensive; park them unless a
  specific need appears.

## Caveats before choosing

- Published per-payment numbers for Trolley/Tipalti/Hyperwallet are **indicative** —
  exact figures come from a sales quote for JV's volume and countries.
- **Check country/currency coverage for JV's actual list** — especially **Ukraine
  (UAH)** and any smaller markets; not every provider pays everywhere.
- These platforms handle **KYC / payee verification / tax forms** — that's real value
  beyond moving money (it takes risk off JV).
- Whichever we pick, Reimbly feeds it the same way it feeds Intacct/Bill.com: an
  **API push** or a **batch file**, carrying the coding we already produce.

## Suggested next step

Get quotes from **two**: **Trolley** (best self-service fit) and **Wise Business**
(lowest cost), each with JV's country list and rough monthly volume. Compare the
all-in cost per person on a typical month against **Bill.com**, whose edge is the
Intacct pipe rather than price. Then Reimbly connects to the winner by API or file.

---

*Sources (Aug 2026):* Tipalti pricing — g2.com, vendr.com, multientityaccounting.com;
Trolley pricing — g2.com, trolley.com; Wise Business — wise.com/us/pricing/business;
Payoneer vs Hyperwallet / PayPal Payouts — tipalti.com, localbridge.com, wise.com blog.
Figures are indicative and change; confirm with each provider.
