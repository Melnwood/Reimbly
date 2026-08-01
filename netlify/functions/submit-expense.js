'use strict';

// Create an expense for the signed-in person, linking it to their Staff record,
// the chosen Category, and the Currency (which drives the base's automatic
// "Amount (USD)" formula). Then upload the receipt via Airtable's content API.

const { ok, error, methodGuard, parseBody } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const airtable = require('./lib/airtable');
const {
  TABLES,
  STATUS,
  EVENTS,
  DEFAULT_PAYMENT_METHOD,
  ensureStaff,
  resolveCurrencyId,
  accountAccessFor,
  getMileageRate,
  round2,
  displayMaps,
  shapeExpense,
  logActivity,
  staffById,
  getReportById,
  reportOwnedBy,
  householdScope,
} = require('./lib/domain');
const { isValidCategory, accountName } = require('./lib/coding');
const notify = require('./lib/notify');

const MAX_RECEIPT_BYTES = 8 * 1024 * 1024; // ~8 MB decoded

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

const today = () => new Date().toISOString().slice(0, 10);

exports.handler = async (event) => {
  const guard = methodGuard(event, 'POST');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const { id: staffId, record: staffRec } = await ensureStaff(user);
    const { ids: householdIds } = await householdScope(staffRec);
    const body = parseBody(event);

    let description = String(body.description || '').trim();
    const merchant = String(body.merchant || '').trim();
    const account = String(body.account || '').trim();       // the GL category code
    const expenseAccount = String(body.expenseAccount || '').trim(); // the fund/account
    const date = String(body.date || '').trim();
    const purpose = String(body.purpose || '').trim();
    const mileage = body.mileage && typeof body.mileage === 'object' ? body.mileage : null;

    // A mileage expense computes its amount from distance × rate (in the rate's
    // currency); a regular one takes the amount/currency straight from the form.
    let amount;
    let currency;
    let currencyId;
    const mileageFields = {};
    if (mileage) {
      const distance = Number(mileage.distance);
      if (!isFinite(distance) || distance <= 0) throw badRequest('Enter the distance you drove.');
      const rate = await getMileageRate(String(mileage.rateId || '').trim());
      if (!rate || !rate.active) throw badRequest('Please pick a mileage rate.');
      if (rate.rate == null || !rate.currencyId) throw badRequest('That mileage rate is misconfigured in Airtable (needs a rate and a currency).');
      amount = round2(distance * rate.rate);
      currencyId = rate.currencyId;
      mileageFields.Distance = distance;
      mileageFields['Distance Unit'] = rate.unit;
      mileageFields['Mileage Rate'] = rate.rate;
      if (!description) description = `Mileage: ${distance} ${rate.unit}`;
    } else {
      amount = Number(body.amount);
      currency = String(body.currency || 'USD').trim().toUpperCase();
      if (!isFinite(amount) || amount <= 0) throw badRequest('Amount must be greater than zero.');
      currencyId = await resolveCurrencyId(currency);
      if (!currencyId) throw badRequest(`Currency "${currency}" isn't set up in the base yet.`);
    }

    if (!description) throw badRequest('Please add a short description.');
    if (!date) throw badRequest('Please pick the date of the expense.');
    if (!expenseAccount) throw badRequest('Please choose the account to charge this to.');
    if (!accountName(expenseAccount)) throw badRequest('That account isn’t recognised.');
    if (!account) throw badRequest('Please choose an expense category.');
    if (!isValidCategory(expenseAccount, account)) throw badRequest('That category isn’t valid for this account.');

    const receipt = validateReceipt(body.receipt);

    const access = await accountAccessFor(user.email);
    const acct = access.accounts.find((a) => String(a.code) === account);
    if (!acct) throw badRequest(`Account "${account}" isn't in the chart of accounts.`);
    if (!access.visibleIds.has(acct.id)) {
      const err = new Error('You don’t have access to that account.');
      err.statusCode = 403;
      throw err;
    }
    const accountId = acct.id;

    // Optional: drop this new expense straight into one of the person's reports.
    // A brand-new expense that's going into a report starts Unsubmitted (Draft)
    // so it waits for the report to be submitted; a stand-alone expense goes
    // straight to Pending approval as before.
    const reportId = String(body.reportId || '').trim();
    let reportLink = null;
    if (reportId) {
      const report = await getReportById(reportId);
      if (!report || !reportOwnedBy(report, householdIds)) {
        const err = new Error('That isn’t one of your reports.');
        err.statusCode = 403;
        throw err;
      }
      reportLink = reportId;
    }

    const fields = {
      Description: description,
      'Expense Date': date,
      Amount: amount,
      'Payment Method': DEFAULT_PAYMENT_METHOD,
      Status: reportLink ? STATUS.DRAFT : STATUS.SUBMITTED,
      'Submitted On': today(),
      Submitter: [staffId],
      Currency: [currencyId],
      Account: [accountId],
      ...mileageFields,
    };
    if (reportLink) fields.Report = [reportLink];
    fields['Expense Account'] = `${expenseAccount} – ${accountName(expenseAccount)}`;
    if (merchant) fields.Merchant = merchant;
    if (purpose) fields['Business Purpose'] = purpose;
    // Time read off the photo (HH:MM) — helps tell apart repeat charges like tolls.
    const timeIn = /^(\d{1,2}):(\d{2})$/.exec(String(body.time || '').trim());
    if (timeIn && Number(timeIn[1]) < 24) fields['Receipt Time'] = `${timeIn[1].padStart(2, '0')}:${timeIn[2]}`;
    // Provenance: a manual entry that arrives with a photo is "taken by a
    // picture"; one typed in by hand has no receipt. sourceOf() reads this.
    if (receipt) fields.Notes = fields.Notes ? `${fields.Notes}\nAdded by photo` : 'Added by photo';

    // Soft duplicate heads-up — same person, same amount, same day. Never blocks.
    let dupWarning = null;
    try {
      const emailEsc = user.email.toLowerCase().replace(/'/g, "\\'");
      const existing = await airtable.findFirst(TABLES.EXPENSES, {
        filterByFormula: `AND(LOWER(ARRAYJOIN({Submitter Email})) = '${emailEsc}', {Amount} = ${amount}, {Expense Date} = '${date}')`,
      });
      if (existing) {
        dupWarning = `Heads up: you already have an expense for ${amount}${currency ? ` ${currency}` : ''} on ${date}. If this isn’t a duplicate, you’re all set.`;
      }
    } catch (e) {
      // best-effort; a failed check must never block a submission
    }

    const created = await airtable.createRecord(TABLES.EXPENSES, fields);
    // Only log a "Submitted" event for a stand-alone expense. One added to a
    // report is still Unsubmitted — it'll be logged when the report is submitted.
    if (!reportLink) await logActivity({ expenseId: created.id, event: EVENTS.SUBMITTED, user });
    else await logActivity({ expenseId: created.id, event: EVENTS.IMPORTED, user, note: 'Added to a report' });

    let receiptWarning = null;
    if (receipt) {
      try {
        await airtable.uploadAttachment(created.id, 'Receipt', receipt);
      } catch (e) {
        console.error('[reimbly] receipt upload failed', e);
        receiptWarning = 'Your expense was saved, but the receipt did not attach. You can add it in Airtable.';
      }
    }

    // Re-read so the response reflects the receipt and the computed Amount (USD).
    const [fresh, maps] = await Promise.all([
      airtable.findFirst(TABLES.EXPENSES, {
        filterByFormula: `RECORD_ID() = '${created.id}'`,
      }),
      displayMaps(),
    ]);

    const shaped = shapeExpense(fresh || created, maps);

    // Let the approver know something's waiting (best-effort) — but only for a
    // stand-alone expense. One in a report waits for the report to be submitted.
    if (!reportLink) {
      try {
        const uplineId = Array.isArray(staffRec.fields && staffRec.fields.Upline) ? staffRec.fields.Upline[0] : null;
        if (uplineId) {
          const approver = await staffById(uplineId);
          await notify.approverNewExpense({ approver, submitterName: user.name, expense: shaped });
        }
      } catch (e) {
        console.error('[rembly] submit notify failed', e && e.message);
      }
    }

    return ok({ expense: shaped, warning: receiptWarning || dupWarning });
  } catch (err) {
    return error(err);
  }
};

function validateReceipt(receipt) {
  if (!receipt) return null;
  const { filename, contentType, base64 } = receipt;
  if (!base64) return null;
  if (!filename || !contentType) {
    throw badRequest('Receipt is missing its filename or type.');
  }
  const approxBytes = Math.floor((base64.length * 3) / 4);
  if (approxBytes > MAX_RECEIPT_BYTES) {
    throw badRequest('Receipt is too large (max 8 MB). Try a photo instead of a scan.');
  }
  return { filename, contentType, base64 };
}
