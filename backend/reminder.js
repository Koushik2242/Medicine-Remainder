// backend/reminder.js
const cron = require('node-cron');
const nodemailer = require('nodemailer');
const admin = require('firebase-admin');
const Medication = require('./models/Medication');
const User = require('./models/User');

// ---- Firebase Admin (safe init) ----
// ---- Firebase Admin (safe init) ----
const admin = require('./server'); // import the initialized admin

try {
  if (!admin.apps.length) {
    const svc = process.env.FIREBASE_SERVICE_ACCOUNT_JSON
      ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
      : require('./firebase-service-account.json'); // local dev fallback

    admin.initializeApp({ credential: admin.credential.cert(svc) });
  }
} catch (e) {
  console.warn('firebase-admin init:', e.message);
}


// ---- Email (optional) ----
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'your@gmail.com',
    pass: process.env.EMAIL_PASS || 'app-password',
  },
});

// ---- Helpers ----
async function sendEmailReminder(user, med) {
  if (!user?.email) return;
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER || 'your@gmail.com',
      to: user.email,
      subject: `Medication Reminder: ${med.name}`,
      text: `It's time to take ${med.name} (${med.dose}). ${med.instructions || ''}`,
    });
  } catch (e) {
    console.warn('sendMail error:', e.message);
  }
}

async function sendPushReminder(user, med) {
  if (!user?.fcmToken) return;
  try {
    await admin.messaging().send({
      token: user.fcmToken,
      notification: {
        title: `Time for ${med.name}`,
        body: `${med.dose}${med.instructions ? ` – ${med.instructions}` : ''}`,
      },
    });
  } catch (e) {
    console.warn('sendPush error:', e.message);
  }
}

// ---- Cron: every minute, notify once per dose (atomic) ----
cron.schedule('* * * * *', async () => {
  try {
    const now = new Date();
    const inOneMinute = new Date(now.getTime() + 60 * 1000);

    // due meds in the next minute
    const dueMeds = await Medication.find({
      active: true,
      nextDose: { $gte: now, $lte: inOneMinute },
    }).populate('userId'); // userId is ref: 'User'

    for (const med of dueMeds) {
      const user = med.userId;

      // ATOMIC CLAIM: only notify once for THIS exact nextDose
      const claimed = await Medication.findOneAndUpdate(
        {
          _id: med._id,
          nextDose: med.nextDose, // still the same (client may have moved it)
          $or: [
            { notifiedFor: { $exists: false } },
            { notifiedFor: null },
            { notifiedFor: { $ne: med.nextDose } },
          ],
        },
        { $set: { notifiedFor: med.nextDose, lastNotifiedAt: new Date() } },
        { new: true }
      );

      if (!claimed) {
        // already notified for this dose OR nextDose moved → skip
        continue;
      }

      await sendPushReminder(user, med);
      await sendEmailReminder(user, med);

      console.log(
        `🔔 Reminder sent for "${med.name}" to ${user?.email || 'push only'} @ ${new Date().toISOString()}`
      );
    }
  } catch (err) {
    console.error('Cron job error:', err);
  }
});


