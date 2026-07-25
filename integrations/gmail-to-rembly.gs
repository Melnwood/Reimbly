/**
 * Gmail → Rembly
 * ----------------
 * Finds receipt and invoice emails in your Gmail and files them into Rembly.
 * For every matching email it sends the attachments (and the email text) to
 * Rembly, which reads each receipt with Claude and creates a Submitted expense
 * for you to review under "My expenses". Nothing is auto-approved.
 *
 * It works two ways, and you can use either or both:
 *   • Automatic — it searches your mail for anything that looks like a receipt
 *     or invoice (see SWEEP_QUERY) and files it. No labeling needed.
 *   • Manual — anything you drop into a Gmail label called "Rembly" is filed too,
 *     for the ones the search misses.
 *
 * Every email it files gets a "Rembly/Filed" label, so it's never imported
 * twice — and Rembly's own duplicate check catches anything that slips through.
 *
 * ── One-time setup (about 10 minutes) ──────────────────────────────────────
 * 1. Go to https://script.google.com → New project. Paste this whole file in.
 * 2. In CONFIG below, set SECRET to the same value you put in Netlify's
 *    INBOUND_EMAIL_SECRET. (ENDPOINT_URL is already your site; change it if your
 *    address is different.)
 * 3. Run "backfillReceipts" once and grant the permissions it asks for. This
 *    sweeps your existing mail. If it logs that it hit the per-run limit, just
 *    run it again — it picks up where it left off — until it says 0 new.
 * 4. Run "installHourlyTrigger" once so new receipts keep filing on their own.
 *
 * To also catch things by hand: make a Gmail label called "Rembly" and drag any
 * receipt email into it (or add a Gmail filter that labels them automatically).
 */

var CONFIG = {
  ENDPOINT_URL: 'https://reimbly.netlify.app/api/inbound-email',
  SECRET: 'PASTE-THE-SAME-SECRET-AS-NETLIFY',

  SOURCE_LABEL: 'Rembly',        // drop an email here to file it by hand
  DONE_LABEL: 'Rembly/Filed',    // added once an email is filed (don't rename)

  // 'inbox'  → receipts are HELD until a YNAB row claims them (the #2 flow).
  // 'expense'→ each receipt becomes a Submitted expense right away.
  MODE: 'inbox',

  // What counts as a receipt/invoice worth filing. Requires an attachment to
  // keep newsletters out, and covers several JV languages. Edit to taste.
  KEYWORDS: 'receipt OR invoice OR faktura OR "účtenka" OR paragon OR rachunek OR Rechnung OR factura OR "order confirmation" OR "tax invoice" OR "payment received"',

  BACKFILL_WINDOW: 'newer_than:1y', // how far back the one-time sweep looks
  RECENT_WINDOW: 'newer_than:2d',   // how far back the hourly run looks
  MAX_THREADS: 40,                  // per run (Apps Script has a ~6 min limit)
  MAX_ATTACH_MB: 8,                 // skip attachments bigger than Rembly accepts
};

// ── Entry points ───────────────────────────────────────────────────────────

// Run once (and re-run until it logs 0 new) to sweep your existing mail.
function backfillReceipts() {
  var q = 'has:attachment (' + CONFIG.KEYWORDS + ') ' + CONFIG.BACKFILL_WINDOW;
  var n = fileMatching_(q) + fileMatching_('label:' + searchLabel_(CONFIG.SOURCE_LABEL));
  Logger.log('Backfill: filed %s new thread(s) this run.', n);
  if (n >= CONFIG.MAX_THREADS) Logger.log('Hit the per-run limit — run backfillReceipts again to continue.');
}

// Installed on an hourly trigger — files new receipts as they arrive.
function processRemblyReceipts() {
  var recent = 'has:attachment (' + CONFIG.KEYWORDS + ') ' + CONFIG.RECENT_WINDOW;
  var n = fileMatching_(recent) + fileMatching_('label:' + searchLabel_(CONFIG.SOURCE_LABEL));
  if (n) Logger.log('Hourly: filed %s new thread(s).', n);
}

function installHourlyTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'processRemblyReceipts') ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger('processRemblyReceipts').timeBased().everyHours(1).create();
  Logger.log('Hourly filing is on. Rembly will pick up new receipts automatically.');
}

// ── Worker ──────────────────────────────────────────────────────────────────

// File every thread matching `query` that we haven't filed yet. Returns a count.
function fileMatching_(query) {
  var done = GmailApp.getUserLabelByName(CONFIG.DONE_LABEL) || GmailApp.createLabel(CONFIG.DONE_LABEL);
  var me = Session.getEffectiveUser().getEmail();
  var full = query + ' -label:' + searchLabel_(CONFIG.DONE_LABEL);
  var threads = GmailApp.search(full, 0, CONFIG.MAX_THREADS);
  var filed = 0;

  for (var t = 0; t < threads.length; t++) {
    var thread = threads[t];
    var messages = thread.getMessages();
    var okAll = true;
    var createdCount = 0;

    for (var m = 0; m < messages.length; m++) {
      var msg = messages[m];
      var attachments = [];
      var atts = msg.getAttachments({ includeInlineImages: false, includeAttachments: true });
      for (var a = 0; a < atts.length; a++) {
        if (atts[a].getBytes().length > CONFIG.MAX_ATTACH_MB * 1024 * 1024) continue; // too big for Rembly
        attachments.push({
          filename: atts[a].getName(),
          contentType: atts[a].getContentType(),
          base64: Utilities.base64Encode(atts[a].getBytes()),
        });
      }

      var payload = {
        secret: CONFIG.SECRET,
        mode: CONFIG.MODE, // 'inbox' holds the receipt; 'expense' files it now
        from: me, // the expense belongs to you, the inbox owner
        name: '',
        subject: msg.getSubject(),
        receivedAt: Utilities.formatDate(msg.getDate(), 'UTC', 'yyyy-MM-dd'),
        text: msg.getPlainBody(),
        attachments: attachments,
      };

      try {
        var res = UrlFetchApp.fetch(CONFIG.ENDPOINT_URL, {
          method: 'post',
          contentType: 'application/json',
          payload: JSON.stringify(payload),
          muteHttpExceptions: true,
        });
        var code = res.getResponseCode();
        if (code >= 300) {
          okAll = false;
          Logger.log('Rembly error %s: %s', code, res.getContentText());
        } else {
          try { createdCount += (JSON.parse(res.getContentText()).created || 0); } catch (e) {}
        }
      } catch (e) {
        okAll = false;
        Logger.log('Rembly POST failed: ' + e);
      }
    }

    // Mark filed on success so we never re-import it. (We mark even when Claude
    // found nothing to create, so the sweep doesn't loop on unreadable mail.)
    if (okAll) { thread.addLabel(done); filed++; }
    if (createdCount) Logger.log('Filed "%s" → %s expense(s).', thread.getFirstMessageSubject(), createdCount);
  }
  return filed;
}

// Gmail search treats "/" in a nested label as "-", e.g. Rembly/Filed → rembly-filed.
function searchLabel_(name) { return name.replace(/\//g, '-'); }
