// backend/reminder.js
require('dotenv').config();
const mongoose = require('mongoose');
const cron = require('node-cron');
const nodemailer = require('nodemailer');

const admin = require('./firebaseAdmin');           // ✅ shared initialized admin
const Medication = require('./models/Medication');
const User = require('./models/User');

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

// ---- Start cron after DB is connected ----
async function start() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI not set');
    return;
  }

  try {
    mongoose.set('strictQuery', true);
    await mongoose.connect(uri, {
      // these options are fine for Mongoose 8; omit legacy ones
    });
    console.log('✅ Worker: Connected to MongoDB');
  } catch (err) {
    console.error('❌ Worker: MongoDB connection error:', err);
    return; // don’t start cron without DB
  }

  // ---- Cron: every minute, notify once per dose (atomic) ----
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();
      const inOneMinute = new Date(now.getTime() + 60 * 1000);

      const dueMeds = await Medication.find({
        active: true,
        nextDose: { $gte: now, $lte: inOneMinute },
      }).populate('userId');

      for (const med of dueMeds) {
        const user = med.userId;

        // atomic claim (notify once per exact nextDose)
        const claimed = await Medication.findOneAndUpdate(
          {
            _id: med._id,
            nextDose: med.nextDose,
            $or: [
              { notifiedFor: { $exists: false } },
              { notifiedFor: null },
              { notifiedFor: { $ne: med.nextDose } },
            ],
          },
          { $set: { notifiedFor: med.nextDose, lastNotifiedAt: new Date() } },
          { new: true }
        );

        if (!claimed) continue;

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

  console.log('⏱️ Worker: Cron scheduled (every minute)');
}

start();
