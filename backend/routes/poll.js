const express = require('express');
const router = express.Router();
const multer = require('multer');

const Poll = require('../models/Poll');
const User = require('../models/User');

// ================= MULTER =================
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads'),
  filename: (req, file, cb) => cb(null, `qr_${Date.now()}_${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// ================= AUTH =================
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

function requireCR(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  if (req.session.role !== 'cr') return res.status(403).json({ error: 'CR only' });
  next();
}

// ================= CREATE POLL =================
router.post('/create-poll', requireCR, upload.single('qrImage'), async (req, res) => {
  try {
    const { subject, pricePerCopy, expiryMinutes, description, totalPages } = req.body;

    if (!subject || !pricePerCopy || !expiryMinutes) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const expiryTime = new Date(Date.now() + parseInt(expiryMinutes) * 60000);

    const poll = new Poll({
      subject,
      pricePerCopy: parseFloat(pricePerCopy),
      totalPages: parseInt(totalPages) || 0,
      description: description || '',
      expiryTime,
      createdBy: req.session.userId,
      qrImage: req.file ? `/uploads/${req.file.filename}` : null,
      participants: [],
      status: 'active'
    });

    await poll.save();

    res.json({ success: true, poll });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ================= GET ALL POLLS =================
router.get('/polls', requireAuth, async (req, res) => {
  try {
    const polls = await Poll.find();

    const now = new Date();

    for (let p of polls) {
      if (p.status === 'active' && new Date(p.expiryTime) < now) {
        p.status = 'expired';
        await p.save();
      }
    }

    res.json(polls);

  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ================= GET SINGLE POLL =================
router.get('/polls/:id', requireAuth, async (req, res) => {
  try {
    const poll = await Poll.findById(req.params.id);

    if (!poll) return res.status(404).json({ error: 'Poll not found' });

    res.json(poll);

  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// ================= JOIN POLL =================
router.post('/join-poll', requireAuth, async (req, res) => {
  try {
    const { pollId, copies } = req.body;

    if (!pollId) return res.status(400).json({ error: 'Poll ID required' });

    const poll = await Poll.findById(pollId);
    if (!poll) return res.status(404).json({ error: 'Poll not found' });

    if (poll.status !== 'active') {
      return res.status(400).json({ error: 'Poll is not active' });
    }

    if (new Date(poll.expiryTime) < new Date()) {
      return res.status(400).json({ error: 'Poll has expired' });
    }

    const existing = poll.participants.find(p => p.userId === req.session.userId);
    if (existing) {
      return res.status(409).json({ error: 'Already joined this poll' });
    }

    const numCopies = parseInt(copies) || 1;

    poll.participants.push({
      userId: req.session.userId,
      copies: numCopies,
      paymentStatus: 'pending',
      paymentId: null
    });

    await poll.save();

    // 🎯 EARLY BIRD BADGE
    if (poll.participants.length <= 3) {
      const user = await User.findOne({ id: req.session.userId });
      if (user) {
        if (!user.badges) user.badges = [];
        if (!user.badges.includes('early_bird')) {
          user.badges.push('early_bird');
          await user.save();
        }
      }
    }

    res.json({ success: true, queuePosition: poll.participants.length });

  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ================= CLOSE POLL =================
router.post('/close-poll/:id', requireCR, async (req, res) => {
  try {
    const poll = await Poll.findById(req.params.id);

    if (!poll) return res.status(404).json({ error: 'Poll not found' });

    poll.status = 'closed';
    poll.closedAt = new Date();

    await poll.save();

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;