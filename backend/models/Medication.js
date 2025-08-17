// backend/models/Medication.js
const mongoose = require('mongoose');

const medicationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    name: { type: String, required: true },
    dose: { type: String, required: true },
    instructions: { type: String, default: '' },

    // scheduling
    nextDose: { type: Date, index: true },       // when the next dose should be taken
    frequencyHours: { type: Number, default: 0 },// every X hours if used
    scheduleType: {                              
      type: String,
      enum: ['daily', 'twice-daily', 'every-x-hours', 'weekly'],
      default: 'daily',
    },
    times: { type: [String], default: [] },      // e.g. ["08:00","20:00"] or ["3:08:30"] for weekly
    sideEffects: { type: String, default: '' },

    // status
    active: { type: Boolean, default: true },
    missedDoses: {
      type: [
        {
          timestamp: Date,        // when we recorded it missed
          scheduledTime: Date,    // what the dose time was
        },
      ],
      default: [],
    },

    // notification dedupe
    notifiedFor: { type: Date, default: null },   // which nextDose we already notified for
    lastNotifiedAt: { type: Date, default: null },// when we sent last reminder
  },
  { timestamps: true }
);

module.exports = mongoose.model('Medication', medicationSchema);
