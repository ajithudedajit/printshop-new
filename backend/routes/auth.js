const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, '../../data/users.json');

function readUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); }
  catch { return []; }
}
function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// Signup — now includes college/dept/semester/section
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password, role, college, department, semester, section } = req.body;
    if (!name || !email || !password || !role) return res.status(400).json({ error: 'All fields required' });
    if (!college || !department || !semester || !section) return res.status(400).json({ error: 'College details required' });
    const users = readUsers();
    if (users.find(u => u.email === email)) return res.status(409).json({ error: 'Email already registered' });
    const hashed = await bcrypt.hash(password, 10);
    const user = {
      id: uuidv4(), name, email, password: hashed, role,
      college, department, semester, section,
      createdAt: new Date().toISOString(), badges: []
    };
    users.push(user);
    writeUsers(users);
    req.session.userId = user.id;
    req.session.role = user.role;
    res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role, college, department, semester, section } });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const users = readUsers();
    const user = users.find(u => u.email === email);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });
    
    // Check if user has active delegation
    let effectiveRole = user.role;
    if (user.role === 'student' && user.delegatedBy) {
      const expiry = user.delegationExpiry ? new Date(user.delegationExpiry) : null;
      if (expiry && expiry > new Date()) {
        effectiveRole = 'cr'; // temp CR powers
      } else {
        // Delegation expired, clean it up
        user.delegatedBy = null;
        user.delegationExpiry = null;
        writeUsers(users);
      }
    }
    
    req.session.userId = user.id;
    req.session.role = effectiveRole;
    req.session.realRole = user.role;
    res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, role: effectiveRole, realRole: user.role, college: user.college, department: user.department, semester: user.semester, section: user.section, badges: user.badges || [] } });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// Google Login
router.post('/google-login', async (req, res) => {
  try {
    const { email, name, googleId, role, college, department, semester, section } = req.body;
    if (!email || !name) return res.status(400).json({ error: 'Missing Google profile data' });
    const users = readUsers();
    let user = users.find(u => u.email === email);
    if (!user) {
      if (!role || !college || !department || !semester || !section) {
        return res.status(400).json({ error: 'NEED_PROFILE', message: 'Please complete your profile' });
      }
      user = { id: uuidv4(), name, email, password: null, googleId, role: role || 'student', college, department, semester, section, createdAt: new Date().toISOString(), badges: [] };
      users.push(user);
      writeUsers(users);
    }
    req.session.userId = user.id;
    req.session.role = user.role;
    res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role, college: user.college, department: user.department, semester: user.semester, section: user.section, badges: user.badges || [] } });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

// Get current user
router.get('/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  const users = readUsers();
  const user = users.find(u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: 'User not found' });
  
  let effectiveRole = user.role;
  if (user.role === 'student' && user.delegatedBy) {
    const expiry = user.delegationExpiry ? new Date(user.delegationExpiry) : null;
    if (expiry && expiry > new Date()) effectiveRole = 'cr';
  }
  
  res.json({ id: user.id, name: user.name, email: user.email, role: effectiveRole, realRole: user.role, college: user.college, department: user.department, semester: user.semester, section: user.section, badges: user.badges || [] });
});

// ===== DELEGATE CR (CR delegates to a student when absent) =====
router.post('/delegate-cr', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  if (req.session.role !== 'cr') return res.status(403).json({ error: 'Only CR can delegate' });
  
  const { studentId, hours } = req.body;
  if (!studentId) return res.status(400).json({ error: 'Student ID required' });
  
  const users = readUsers();
  const crUser = users.find(u => u.id === req.session.userId);
  const student = users.find(u => u.id === studentId);
  
  if (!student) return res.status(404).json({ error: 'Student not found' });
  if (student.role !== 'student') return res.status(400).json({ error: 'Can only delegate to a student' });
  
  // Check same class
  if (crUser && (crUser.section !== student.section || crUser.department !== student.department || crUser.semester !== student.semester)) {
    return res.status(400).json({ error: 'Can only delegate to students in your section' });
  }
  
  const durationHours = parseInt(hours) || 8;
  const expiry = new Date(Date.now() + durationHours * 60 * 60 * 1000);
  
  student.delegatedBy = req.session.userId;
  student.delegationExpiry = expiry.toISOString();
  writeUsers(users);
  
  res.json({ success: true, message: `Delegated CR powers to ${student.name} until ${expiry.toLocaleString()}` });
});

// ===== REVOKE DELEGATION =====
router.post('/revoke-delegation', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  
  const users = readUsers();
  // Find any student delegated by this CR
  const delegated = users.filter(u => u.delegatedBy === req.session.userId);
  delegated.forEach(u => {
    u.delegatedBy = null;
    u.delegationExpiry = null;
  });
  writeUsers(users);
  res.json({ success: true, message: 'Delegation revoked' });
});

// ===== GET CLASSMATES (for delegation UI) =====
router.get('/classmates', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  if (req.session.role !== 'cr') return res.status(403).json({ error: 'CR only' });
  
  const users = readUsers();
  const cr = users.find(u => u.id === req.session.userId);
  if (!cr) return res.status(404).json({ error: 'User not found' });
  
  const classmates = users
    .filter(u => u.role === 'student' && u.department === cr.department && u.semester === cr.semester && u.section === cr.section)
    .map(u => ({ id: u.id, name: u.name, email: u.email }));
  
  res.json(classmates);
});

module.exports = router;
