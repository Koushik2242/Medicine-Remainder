// backend/server.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const User = require('./models/User');
const Medication = require('./models/Medication');

const app = express();

/* ---------- Firebase Admin (push) ---------- */
const admin = require('firebase-admin');
try {
  if (!admin.apps.length) {
    const serviceAccount = require('./firebase-service-account.json');
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
} catch (e) {
  console.warn('firebase-admin init:', e.message);
}

/* ---------- Middleware (CORS + JSON) ---------- */
/* CORS must be before any routes */
const corsOptions = {
  origin: ['http://localhost:5500'], // your frontend origin
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};
app.use(cors(corsOptions));
// NOTE: do NOT add app.options('*' or '/api/*') — it breaks on path-to-regexp
app.use(express.json());

/* ---------- DB Connect ---------- */
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✅ Connected to MongoDB');
    // start reminder job after DB is ready
    require('./reminder');
  })
  .catch((err) => console.error('❌ MongoDB connection error:', err));

/* ---------- Auth Helpers ---------- */
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

function authMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const [type, token] = header.split(' ');
    if (type !== 'Bearer' || !token) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

/* ---------- Routes ---------- */

// Health
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Signup
app.post('/api/signup', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required' });
    }
    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ message: 'Email already in use' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({ email, passwordHash });

    return res.json({ message: 'User created', userId: user._id });
  } catch (err) {
    console.error('Signup error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required' });
    }
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(401).json({ message: 'Invalid credentials' });

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '7d' });
    return res.json({ token });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Example protected route
app.get('/api/profile', authMiddleware, async (req, res) => {
  const user = await User.findById(req.userId).select('-passwordHash');
  return res.json({ user });
});

// Save FCM device token
app.post('/api/save-fcm-token', authMiddleware, async (req, res) => {
  try {
    const { fcmToken } = req.body || {};
    if (!fcmToken) return res.status(400).json({ message: 'Missing fcmToken' });

    await User.findByIdAndUpdate(req.userId, { fcmToken }, { new: true });
    return res.json({ message: 'FCM token saved' });
  } catch (err) {
    console.error('save-fcm-token error:', err);
    return res.status(500).json({ message: 'Error saving FCM token' });
  }
});

/* ---------- Medications CRUD ---------- */

// Create
app.post('/api/medications', authMiddleware, async (req, res) => {
  try {
    const {
      name,
      dose,
      instructions,
      nextDose,        // ISO string
      frequencyHours,  // number
      scheduleType,    // 'daily' | 'twice-daily' | 'every-x-hours' | 'weekly'
      times = [],      // array of "HH:MM" or ["D:HH:MM"] for weekly
      sideEffects = '',
    } = req.body || {};

    if (!name || !dose) {
      return res.status(400).json({ message: 'name and dose are required' });
    }

    const med = await Medication.create({
      userId: req.userId,
      name,
      dose,
      instructions: instructions || '',
      nextDose: nextDose ? new Date(nextDose) : new Date(),
      frequencyHours: Number.isFinite(+frequencyHours) ? +frequencyHours : 0,
      scheduleType: scheduleType || 'daily',
      times: Array.isArray(times) ? times : [],
      sideEffects,
      active: true,
      missedDoses: [],
    });

    return res.json({ medication: med });
  } catch (err) {
    console.error('Create medication error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// List (user’s meds)
app.get('/api/medications', authMiddleware, async (req, res) => {
  try {
    const meds = await Medication.find({ userId: req.userId }).sort({ createdAt: -1 });
    return res.json(meds);
  } catch (err) {
    console.error('List medications error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// Update (persist edits)
app.put('/api/medications/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const fields = ['name','dose','instructions','sideEffects','scheduleType','times','frequencyHours','nextDose','active'];
    const update = {};
    for (const k of fields) if (k in req.body) update[k] = req.body[k];

    const med = await Medication.findOneAndUpdate(
      { _id: id, userId: req.userId },
      update,
      { new: true }
    );
    if (!med) return res.status(404).json({ message: 'Medication not found' });
    res.json({ medication: med });
  } catch (err) {
    console.error('Update medication error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Delete
app.delete('/api/medications/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const med = await Medication.findOne({ _id: id, userId: req.userId });
    if (!med) return res.status(404).json({ message: 'Medication not found' });

    await med.deleteOne();
    return res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Delete medication error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

/* ---------- Test Push (one copy, after middleware) ---------- */
app.post('/api/test-push', authMiddleware, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user?.fcmToken) return res.status(400).json({ message: 'No FCM token on user' });

    await admin.messaging().send({
      token: user.fcmToken,
      notification: { title: 'Test push ✅', body: 'Hello from your Medication Reminder API' },
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('test-push error:', e);
    res.status(500).json({ message: 'Failed to send push', error: String(e) });
  }
});

/* ---------- Start ---------- */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 API up on http://localhost:${PORT}`));
