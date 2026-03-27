const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  userId: String,
  pollId: String,
  transactionId: String,
  amount: Number,
  copies: Number,
  screenshot: String,
  screenshotHash: String,
  status: String,
  fraudFlags: [String],
  submittedAt: Date,
  reviewedAt: Date,
  reviewedBy: String
});

module.exports = mongoose.model('Payment', paymentSchema);