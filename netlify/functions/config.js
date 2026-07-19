'use strict';

// Public config the browser needs to start Google sign-in. Contains no secrets.

const { ok, error, methodGuard } = require('./lib/http');

exports.handler = async (event) => {
  const guard = methodGuard(event, 'GET');
  if (guard) return guard;

  try {
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    if (!googleClientId) {
      const err = new Error('Server is missing GOOGLE_CLIENT_ID.');
      err.statusCode = 500;
      throw err;
    }
    return ok({
      googleClientId,
      allowedDomain: process.env.ALLOWED_DOMAIN || '',
      appName: 'Reimbly',
    });
  } catch (err) {
    return error(err);
  }
};
