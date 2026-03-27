const mongoose = require('mongoose');

const participantSchema = new mongoose.Schema({
  userId: String,
  copies: Number,
  paymentStatus: String,
  paymentId: String
});

const pollSchema = new mongoose.Schema({
  subject: String,
  pricePerCopy: Number,
  totalPages: Number,
  expiryTime: String,
  createdBy: String,
  participants: [participantSchema],
  status: String
});

module.exports = mongoose.model('Poll', pollSchema);