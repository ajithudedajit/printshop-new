const Payment = require('../models/Payment');
const Poll = require('../models/Poll');
const User = require('../models/User');
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');

const PAYMENTS_FILE = path.join(__dirname, '../../data/payments.json');
const USERS_FILE = path.join(__dirname, '../../data/users.json');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '../../uploads')),
  filename: (req, file, cb) => cb(null, `pay_${Date.now()}_${file.originalname}`)
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}
function requireCR(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  if (req.session.role !== 'cr') return res.status(403).json({ error: 'CR only' });
  next();
}

function readUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return []; }
}

function validateTxnId(txnId) {
  if (!txnId) return false;
  const clean = txnId.trim();
  if (clean.length < 8 || clean.length > 64) return false;
  return /^[a-zA-Z0-9_\-]+$/.test(clean);
}

function fileHash(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(buf).digest('hex');
  } catch { return null; }
}

// Submit payment
router.post('/submit-payment', requireAuth, upload.single('screenshot'), async (req, res) => {
  try {
    const { pollId, transactionId, copies } = req.body;
    if (!pollId || !transactionId) return res.status(400).json({ error: 'Poll ID and Transaction ID required' });
    if (!validateTxnId(transactionId)) return res.status(400).json({ error: 'Invalid transaction ID' });

    const poll = await Poll.findById(pollId);
    if (!poll) return res.status(404).json({ error: 'Poll not found' });

    const numCopies = parseInt(copies) || 1;
    const amount = poll.pricePerCopy * (poll.totalPages || 1) * numCopies;

    let status = 'pending';
    let fraudFlags = [];

    const dupTxn = await Payment.findOne({ transactionId: transactionId.trim() });
    if (dupTxn) { status = 'fraud'; fraudFlags.push('duplicate_transaction_id'); }

    let screenshotHash = null;
    if (req.file) {
      screenshotHash = fileHash(req.file.path);
      const dupHash = await Payment.findOne({ screenshotHash });
      if (dupHash) { if (status !== 'fraud') status = 'suspicious'; fraudFlags.push('duplicate_screenshot'); }
    }

    const existing = await Payment.findOne({ pollId, userId: req.session.userId, status: { $nin: ['rejected', 'fraud'] } });
    if (existing) return res.status(409).json({ error: 'Already paid' });

    const payment = await Payment.create({
      userId: req.session.userId, pollId,
      transactionId: transactionId.trim(), amount, copies: numCopies,
      screenshot: req.file ? `/uploads/${req.file.filename}` : null,
      screenshotHash, status, fraudFlags, submittedAt: new Date()
    });

    const participant = poll.participants.find(p => p.userId === req.session.userId);
    if (participant) {
      participant.paymentStatus = status === 'fraud' ? 'fraud' : status === 'suspicious' ? 'suspicious' : 'pending_review';
      participant.paymentId = payment._id;
      await poll.save();
    }

    if (status === 'pending') {
      const user = await User.findOne({ id: req.session.userId });
      if (user && !user.badges?.includes('on_time_payer')) {
        if (!user.badges) user.badges = [];
        user.badges.push('on_time_payer');
        await user.save();
      }
    }

    res.json({ success: true, payment });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Server error' }); }
});

// My payments (student)
router.get('/my-payments', requireAuth, async (req, res) => {
  try {
    const payments = await Payment.find({ userId: req.session.userId });
    const polls = await Poll.find();
    const result = payments.map(p => {
      const poll = polls.find(pl => pl._id.toString() === p.pollId);
      return { ...p._doc, id: p._id.toString(), pollSubject: poll ? poll.subject : 'Poll' };
    });
    res.json(result);
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// Student dashboard stats
router.get('/student-dashboard', requireAuth, async (req, res) => {
  try {
    const payments = await Payment.find({ userId: req.session.userId });
    const polls = await Poll.find();
    const activePollsCount = polls.filter(p => p.status === 'active').length;
    const joinedPolls = polls.filter(p => p.participants?.some(part => part.userId === req.session.userId));
    const verifiedPayments = payments.filter(p => p.status === 'verified');
    const pendingPayments = payments.filter(p => p.status === 'pending' || p.status === 'pending_review');
    const totalSpent = verifiedPayments.reduce((s, p) => s + (p.amount || 0), 0);

    res.json({
      activePolls: activePollsCount,
      joinedPolls: joinedPolls.length,
      verifiedPayments: verifiedPayments.length,
      pendingPayments: pendingPayments.length,
      totalSpent,
      recentPayments: payments.slice(-5).reverse().map(p => {
        const poll = polls.find(pl => pl._id.toString() === p.pollId);
        return { ...p._doc, id: p._id.toString(), pollSubject: poll ? poll.subject : 'Poll' };
      })
    });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// Payments for a poll (CR)
router.get('/payments/:pollId', requireCR, async (req, res) => {
  try {
    const payments = await Payment.find({ pollId: req.params.pollId });
    const users = readUsers();
    const poll = await Poll.findById(req.params.pollId);
    const result = payments.map(p => {
      const user = users.find(u => u.id === p.userId);
      return { ...p._doc, id: p._id.toString(), userName: user?.name || 'Unknown', userEmail: user?.email || '', pollSubject: poll?.subject || 'Poll' };
    });
    res.json(result);
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// Review payment (CR)
router.post('/review-payment/:id', requireCR, async (req, res) => {
  try {
    const { action } = req.body;
    const validActions = ['verified', 'rejected', 'suspicious'];
    if (!validActions.includes(action)) return res.status(400).json({ error: 'Invalid action' });
    const payment = await Payment.findById(req.params.id);
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    payment.status = action;
    payment.reviewedAt = new Date();
    payment.reviewedBy = req.session.userId;
    await payment.save();
    // Update poll participant status
    const poll = await Poll.findById(payment.pollId);
    if (poll) {
      const participant = poll.participants.find(p => p.userId === payment.userId);
      if (participant) { participant.paymentStatus = action; await poll.save(); }
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// Dashboard stats (CR)
router.get('/dashboard', requireCR, async (req, res) => {
  try {
    const polls = await Poll.find({ createdBy: req.session.userId });
    const allPolls = await Poll.find();
    const payments = await Payment.find();
    const users = readUsers();

    const stats = {
      totalPolls: polls.length,
      activePolls: polls.filter(p => p.status === 'active').length,
      totalStudents: users.filter(u => u.role === 'student').length,
      totalPayments: payments.length,
      verified: payments.filter(p => p.status === 'verified').length,
      suspicious: payments.filter(p => ['suspicious', 'fraud'].includes(p.status)).length,
      totalRevenue: payments.filter(p => p.status === 'verified').reduce((s, p) => s + p.amount, 0),
      recentPolls: polls.slice(-5).reverse()
    };
    res.json(stats);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

// Report for poll
router.get('/report/:pollId', requireCR, async (req, res) => {
  try {
    const poll = await Poll.findById(req.params.pollId);
    if (!poll) return res.status(404).json({ error: 'Poll not found' });
    const payments = await Payment.find({ pollId: req.params.pollId });
    const users = readUsers();
    const report = {
      poll: { subject: poll.subject, pricePerCopy: poll.pricePerCopy, status: poll.status, createdAt: poll.createdAt, expiryTime: poll.expiryTime },
      summary: {
        totalParticipants: poll.participants.length,
        totalRevenue: payments.filter(p => p.status === 'verified').reduce((s, p) => s + p.amount, 0),
        verifiedPayments: payments.filter(p => p.status === 'verified').length,
        pendingPayments: payments.filter(p => p.status === 'pending').length,
        suspiciousPayments: payments.filter(p => ['suspicious', 'fraud'].includes(p.status)).length,
        totalCopies: poll.participants.reduce((s, p) => s + (p.copies || 1), 0)
      },
      payments: payments.map(p => {
        const user = users.find(u => u.id === p.userId);
        return { ...p._doc, id: p._id.toString(), userName: user?.name || 'Unknown', userEmail: user?.email || '' };
      })
    };
    res.json(report);
  } catch (err) { console.error(err); res.status(500).json({ error: 'Server error' }); }
});

module.exports = router;
