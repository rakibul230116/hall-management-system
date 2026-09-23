const db = require('../config/db');
const bcrypt = require('bcryptjs');

// GET /auth/login
exports.getLogin = (req, res) => {
  res.render('auth/login', { title: 'Login' });
};

// POST /auth/login
exports.postLogin = async (req, res) => {
  const { email, password } = req.body;
  try {
    const [rows] = await db.query('SELECT * FROM users WHERE email = ? AND status = "active"', [email]);
    if (!rows.length) {
      req.flash('error', 'Invalid email or password.');
      return res.redirect('/auth/login');
    }
    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      req.flash('error', 'Invalid email or password.');
      return res.redirect('/auth/login');
    }
    req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role, student_id: user.student_id };
    if (user.role === 'admin') return res.redirect('/admin/dashboard');
    return res.redirect('/student/dashboard');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Server error. Try again.');
    res.redirect('/auth/login');
  }
};

// GET /auth/register
exports.getRegister = (req, res) => {
  res.render('auth/register', { title: 'Register' });
};

// POST /auth/register
exports.postRegister = async (req, res) => {
  const { name, email, password, student_id, phone, department, session, gender } = req.body;
  try {
    const [existing] = await db.query('SELECT id FROM users WHERE email = ? OR student_id = ?', [email, student_id]);
    if (existing.length) {
      req.flash('error', 'Email or Student ID already exists.');
      return res.redirect('/auth/register');
    }
    const hashed = await bcrypt.hash(password, 10);
    await db.query(
      'INSERT INTO users (name, email, password, student_id, phone, department, session, gender) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [name, email, hashed, student_id, phone, department, session, gender]
    );
    req.flash('success', 'Registration successful! Please login.');
    res.redirect('/auth/login');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Registration failed. Try again.');
    res.redirect('/auth/register');
  }
};

// GET /auth/logout
exports.logout = (req, res) => {
  req.session.destroy();
  res.redirect('/auth/login');
};
