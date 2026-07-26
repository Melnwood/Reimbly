# Design: self-serve household invites (future — not built yet)

> **Status: planned, not implemented.** The live JV app is unchanged. This is the
> ready-to-build plan for when Rembly is used beyond Josiah Venture, where an
> account owner needs to add their own household member (e.g. a spouse) who is
> **not** on the same email domain. Nothing here is wired up yet.

## The goal

Let a signed-in person add someone to their **reimbursement household** themselves,
from a menu under their own name — capturing three things:

- **Email**
- **Full name**
- **Relationship** (e.g. Spouse, Assistant)

Once added, that person can sign in with their own Google account **on any email
domain** and shares the household's pooled expenses and reports — exactly like Mel
& Amy do today. They're a normal member: they submit and see the shared pool, but
get no admin powers and only ever join the inviter's household.

The household *pooling* already exists (the `Household` field on Staff). The two
missing pieces are (1) a self-serve invite screen and (2) letting an invited
outside-domain email through sign-in.

## The one real change: sign-in

Today `netlify/functions/lib/google.js` allows a sign-in only when the email is on
`ALLOWED_DOMAIN` (e.g. `josiahventure.com`) or in the `ALLOWED_EMAILS` env list.
An outside spouse can't get in without an admin editing a Netlify setting.

**Change:** also allow a sign-in when a **Staff record already exists** for that
email. Inviting someone *is* what creates their record, so the invite grants
access; randoms still can't get in (no invite → no record → blocked).

- In `verifyRequest`: after the domain / `ALLOWED_EMAILS` checks fail, look the
  email up in Staff. If a record exists, allow; otherwise 403 as now.
- Keep `ensureStaff` from **auto-creating** a record for a disallowed domain — only
  a real invite (or the domain/allow-list) may create one. Otherwise the gate and
  auto-provisioning would cancel each other out. Practically: `ensureStaff` should
  only create for allowed-domain / allow-listed emails; invited outside emails get
  their record from the invite flow, not from first sign-in.
- One extra DB read per request (email → Staff). Cache if it matters.

Security notes:
- Only people you deliberately add get in; there's no open sign-up.
- An invited member joins **only** the inviter's household and has member-level
  rights (no approvals, no People management, no mileage/rate editing).
- Consider whether an invited member may themselves invite others. Simplest v1:
  no — only the household "owner" invites.

## Data model (Airtable, Staff table)

- **Household** — already exists; the invite sets the new member's value to the
  inviter's household key (make it unique per household, e.g. an id, not a surname).
- **Relationship** — *new* single-line text (Spouse, Assistant, …). Display only.
- Optional **Invited By** (link to Staff) and **Invited On** (date) for an audit
  trail of who added whom.

## Backend (new/edited functions)

- `household.js` (new): 
  - `GET` — list the caller's household members (name, email, relationship).
  - `POST add` — validate email + name; create a Staff record with the caller's
    household, `Role = Staff`, the relationship, and Invited By/On. Reject if the
    email already belongs to a *different* household.
  - `POST remove` — take someone out of the household (clear their household, or
    deactivate). Decide whether their past expenses stay visible to the household.
- `lib/google.js` — the sign-in change above.
- `lib/domain.js` — `shapeExpense`/people helpers already expose household; add
  `relationship` where members are listed.

## Frontend

- Under the account menu (the "Name ▾" dropdown), add **"My household"**.
- A small screen/modal:
  - List current members with their relationship and a remove control.
  - **➕ Add someone** form: Email, Full name, Relationship. On save, call
    `household.js add`, then refresh the list and tell them the person can now sign
    in with their own Google account.
- Reuse the pooled-view work already shipped (name tags on rows, shared reports).

## What NOT to do now

- Do **not** loosen the live JV sign-in gate. JV stays domain-locked until this is
  deliberately turned on for a multi-tenant build.
- This assumes a broader multi-tenant model eventually (each owner = an account).
  That larger design — billing, per-account isolation, org vs. household — is out
  of scope here; this doc covers only the household-member invite within one owner.

## Build checklist (when the time comes)

1. Add `Relationship` (+ optional `Invited By`/`Invited On`) to Staff.
2. Change `verifyRequest` to allow an existing-Staff email; stop `ensureStaff`
   auto-creating for disallowed domains.
3. Add `household.js` (list / add / remove) with household-scoped auth.
4. Add the "My household" screen under the account menu.
5. Tests: invited outside email can sign in; can't invite into someone else's
   household; a random outside email is still blocked; removed member loses access.
