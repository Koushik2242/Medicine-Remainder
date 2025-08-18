// backend/firebaseAdmin.js
const admin = require('firebase-admin');

try {
  if (!admin.apps.length) {
    const svc = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
      ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
      : require('./firebase-service-account.json'); // local dev fallback (gitignored)

    admin.initializeApp({ credential: admin.credential.cert(svc) });
  }
} catch (e) {
  console.warn('firebase-admin init:', e.message);
}

module.exports = admin;
