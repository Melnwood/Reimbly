'use strict';

// Who am I? Verifies the Google sign-in, ensures a Staff record exists, and
// returns the caller's profile + role so the UI knows which tabs to show.

const { ok, error, methodGuard } = require('./lib/http');
const { verifyRequest } = require('./lib/google');
const { ensureStaff, isApprover, notifyChannelsOf, emailIntakeOn, gmailConnected } = require('./lib/domain');
const { configured: gmailConfigured } = require('./lib/gmail');

exports.handler = async (event) => {
  const guard = methodGuard(event, 'GET');
  if (guard) return guard;

  try {
    const user = await verifyRequest(event.headers);
    const { role, record } = await ensureStaff(user);
    return ok({
      email: user.email,
      name: user.name,
      role,
      canApprove: isApprover(role),
      defaultAccount: (record && record.fields && record.fields['Default Account']) || '',
      reminderChannels: notifyChannelsOf(record && record.fields),
      emailIntake: emailIntakeOn(record && record.fields),
      // One-tap Gmail: whether it's available (admin set it up) and connected.
      gmailAvailable: gmailConfigured(),
      gmailConnected: gmailConnected(record && record.fields),
    });
  } catch (err) {
    return error(err);
  }
};
