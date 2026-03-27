const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  id: String,
  name: String,
  email: String,
  password: String,
  googleId: String,
  role: { type: String, enum: ['student', 'cr'], default: 'student' },
  badges: [String],
  // Academic info
  college: String,
  department: String,
  semester: String,
  section: String,
  // Delegation: CR can delegate their powers to a student when absent
  delegatedTo: String,        // userId of the student acting as temp CR
  delegatedBy: String,        // userId of the real CR
  delegationExpiry: Date,     // auto-expires
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema);
