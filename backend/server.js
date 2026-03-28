require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
connectDB();

const PORT = process.env.PORT || 3000;

// ================= FILE SETUP =================
['data', 'uploads'].forEach(dir => {
  const p = path.join(__dirname, '..', dir);
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
});
['users.json', 'polls.json', 'payments.json'].forEach(file => {
  const p = path.join(__dirname, '../data', file);
  if (!fs.existsSync(p)) fs.writeFileSync(p, '[]');
});

// ================= CORS (RENDER SAFE) =================
const allowedOrigins = process.env.ALLOWED_ORIGIN
  ? [process.env.ALLOWED_ORIGIN]
  : ['http://localhost:3000'];

app.use(cors({
  origin: function (origin, callback) {
    // Allow no-origin requests (same-origin) and listed origins
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('CORS blocked: ' + origin));
  },
  credentials: true
}));

app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// ================= SESSION (RENDER SAFE) =================
app.use(session({
  secret: process.env.SESSION_SECRET || 'printshop-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // true on Render (HTTPS)
    httpOnly: true,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

// ================= STATIC =================
app.use(express.static(path.join(__dirname, '../frontend')));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ================= ROUTES =================
app.use('/api', require('./routes/auth'));
app.use('/api', require('./routes/poll'));
app.use('/api', require('./routes/payment'));

// ================= SPA FALLBACK =================
app.use((req, res) => {
  if (!req.path.startsWith('/api') && !req.path.startsWith('/uploads')) {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
  }
});

// ================= START =================
app.listen(PORT, () => {
  console.log(`🚀 PrintShop running on port ${PORT}`);
});
