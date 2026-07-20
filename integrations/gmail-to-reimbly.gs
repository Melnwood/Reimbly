/**
 * Gmail → Reimbly
 * ----------------
 * Automatically files receipt emails into Reimbly. It watches a Gmail label,
 * and for every email in it, sends the attachments (and the email text) to
 * Reimbly, which reads each receipt with Claude and creates a Submitted expense
 * for you to review under "My expenses".
 *
 * ── One-time setup (about 10 minutes) ──────────────────────────────────────
 * 1. In Gmail, make a label called "Reimbly" (Settings → Labels → Create).
 *    Optionally add a filter so receipts get labeled automatically, e.g.
 *    matching "receipt OR invoice OR objednávka" → Apply label "Reimbly".
 * 2. Go to https://script.google.com → New project. Paste this whole file in.
 * 3. Set CONFIG below: ENDPOINT_URL (your Netlify site + /api/inbound-email)
 *    and SECRET (the same value you put in Netlify's INBOUND_EMAIL_SECRET).
 * 4. Run "processReimblyReceipts" once and grant the permissions it asks for.
 * 5. Run "installHourlyTrigger" once so it keeps checking on its own.
 *
 * From then on: label a receipt email "Reimbly" (or let your filter do it) and
 * it shows up in Reimbly within the hour. Filed emails get a "Reimbly/Filed"
 * label so they're never imported twice.
 */

var CONFIG = {
  ENDPOINT_URL: 'https://reimbly.netlify.app/api/inbound-email',
  SECRET: 'PASTE-THE-SAME-SECRET-AS-NETLIFY',
  SOURCE_LABEL: 'Reimbly',
  DONE_LABEL: 'Reimbly/Filed',
  MAX_THREADS: 25, // per run
};

function processReimblyReceipts() {
  var source = GmailApp.getUserLabelByName(CONFIG.SOURCE_LABEL);
  if (!source) throw new Error('Create a Gmail label called "' + CONFIG.SOURCE_LABEL + '" first.');
  var done = GmailApp.getUserLabelByName(CONFIG.DONE_LABEL) || GmailApp.createLabel(CONFIG.DONE_LABEL);
  var me = Session.getEffectiveUser().getEmail();

  // Threads in the source label that we haven't filed yet.
  var threads = GmailApp.search('label:' + CONFIG.SOURCE_LABEL + ' -label:' + CONFIG.DONE_LABEL.replace('/', '-'), 0, CONFIG.MAX_THREADS);
  for (var t = 0; t < threads.length; t++) {
    var thread = threads[t];
    var messages = thread.getMessages();
    var okAll = true;

    for (var m = 0; m < messages.length; m++) {
      var msg = messages[m];
      var attachments = [];
      var atts = msg.getAttachments({ includeInlineImages: false, includeAttachments: true });
      for (var a = 0; a < atts.length; a++) {
        attachments.push({
          filename: atts[a].getName(),
          contentType: atts[a].getContentType(),
          base64: Utilities.base64Encode(atts[a].getBytes()),
        });
      }

      var payload = {
        secret: CONFIG.SECRET,
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
        if (res.getResponseCode() >= 300) {
          okAll = false;
          Logger.log('Reimbly error %s: %s', res.getResponseCode(), res.getContentText());
        }
      } catch (e) {
        okAll = false;
        Logger.log('Reimbly POST failed: ' + e);
      }
    }

    if (okAll) thread.addLabel(done); // mark filed so we don't re-import it
  }
}

function installHourlyTrigger() {
  // Remove any existing triggers for this function first.
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'processReimblyReceipts') ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger('processReimblyReceipts').timeBased().everyHours(1).create();
}
