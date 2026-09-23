const db = require('../config/db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// Dashboard
exports.getDashboard = async (req, res) => {
  const userId = req.session.user.id;
  try {
    const [[student]] = await db.query('SELECT u.*, ra.room_id, ra.seat_number, r.room_number FROM users u LEFT JOIN room_allocations ra ON u.id=ra.student_id AND ra.status="active" LEFT JOIN rooms r ON ra.room_id=r.id WHERE u.id=?', [userId]);
    const [[{ unpaidDues }]] = await db.query('SELECT COUNT(*) AS unpaidDues FROM monthly_dues WHERE student_id=? AND status="unpaid"', [userId]);
    const [[{ unpaidAmount }]] = await db.query('SELECT COALESCE(SUM(amount),0) AS unpaidAmount FROM monthly_dues WHERE student_id=? AND status="unpaid"', [userId]);
    const [recentNotices] = await db.query(
      'SELECT * FROM notices WHERE (publish_date IS NULL OR publish_date <= CURDATE()) AND status != "expired" ORDER BY created_at DESC LIMIT 5'
    );
    const [myComplaints] = await db.query('SELECT * FROM complaints WHERE student_id=? ORDER BY created_at DESC LIMIT 3', [userId]);
    const [todayMenus] = await db.query('SELECT * FROM meal_menus WHERE menu_date=CURDATE() ORDER BY FIELD(meal_type,"breakfast","lunch","dinner")');
    res.render('student/dashboard', { title: 'My Dashboard', student, unpaidDues, unpaidAmount, recentNotices, myComplaints, todayMenus });
  } catch (err) {
    console.error(err);
    res.render('student/dashboard', { title: 'My Dashboard', student: req.session.user, unpaidDues: 0, unpaidAmount: 0, recentNotices: [], myComplaints: [], todayMenus: [] });
  }
};

// Profile GET
exports.getProfile = async (req, res) => {
  const [[student]] = await db.query('SELECT u.*, ra.room_id, ra.seat_number, r.room_number FROM users u LEFT JOIN room_allocations ra ON u.id=ra.student_id AND ra.status="active" LEFT JOIN rooms r ON ra.room_id=r.id WHERE u.id=?', [req.session.user.id]);
  res.render('student/profile', { title: 'My Profile', student });
};

// Profile POST — update (now supports photo upload + opens in a modal on the frontend)
exports.updateProfile = async (req, res) => {
  const { name, phone, department, session: sessionVal } = req.body;
  try {
    const fields = ['name=?', 'phone=?'];
    const params = [name, phone || null];
    if (department !== undefined) { fields.push('department=?'); params.push(department || null); }
    if (sessionVal !== undefined) { fields.push('session=?'); params.push(sessionVal || null); }

    if (req.file) {
      fields.push('photo=?');
      params.push(req.file.filename);
      const [old] = await db.query('SELECT photo FROM users WHERE id=?', [req.session.user.id]);
      if (old.length && old[0].photo) {
        fs.unlink(path.join(__dirname, '..', 'public', 'uploads', 'profiles', old[0].photo), () => {});
      }
    }

    params.push(req.session.user.id);
    await db.query(`UPDATE users SET ${fields.join(', ')} WHERE id=?`, params);
    req.session.user.name = name;

    const io = req.app.get('io');
    if (io) io.emit('student:updated', { id: req.session.user.id });

    req.flash('success', 'Profile updated successfully.');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not update profile.');
  }
  res.redirect('/student/profile');
};

// Change password
exports.changePassword = async (req, res) => {
  const { current_password, new_password } = req.body;
  const [[user]] = await db.query('SELECT * FROM users WHERE id=?', [req.session.user.id]);
  const match = await bcrypt.compare(current_password, user.password);
  if (!match) { req.flash('error', 'Current password is incorrect.'); return res.redirect('/student/profile'); }
  const hashed = await bcrypt.hash(new_password, 10);
  await db.query('UPDATE users SET password=? WHERE id=?', [hashed, req.session.user.id]);
  req.flash('success', 'Password changed successfully.');
  res.redirect('/student/profile');
};

// Notices
exports.getNotices = async (req, res) => {
  const [notices] = await db.query(
    'SELECT n.*, u.name AS posted_by_name FROM notices n JOIN users u ON n.posted_by=u.id WHERE (n.publish_date IS NULL OR n.publish_date <= CURDATE()) AND n.status != "expired" ORDER BY n.priority DESC, n.created_at DESC'
  );
  res.render('student/notices', { title: 'Notice Board', notices });
};

// Complaints
exports.getComplaints = async (req, res) => {
  const [complaints] = await db.query('SELECT * FROM complaints WHERE student_id=? ORDER BY created_at DESC', [req.session.user.id]);
  res.render('student/complaints', { title: 'My Complaints', complaints });
};

exports.submitComplaint = async (req, res) => {
  const { subject, description, category } = req.body;
  await db.query('INSERT INTO complaints (student_id, subject, description, category) VALUES (?, ?, ?, ?)', [req.session.user.id, subject, description, category]);
  req.flash('success', 'Complaint submitted successfully.');
  res.redirect('/student/complaints');
};

// Meals & Tokens
exports.getMenus = async (req, res) => {
  const { date } = req.query;
  const targetDate = date || new Date().toISOString().split('T')[0];
  const [menus] = await db.query('SELECT * FROM meal_menus WHERE menu_date=? ORDER BY FIELD(meal_type,"breakfast","lunch","dinner")', [targetDate]);
  const [myTokens] = await db.query('SELECT mt.*, mm.menu_date, mm.meal_type FROM meal_tokens mt JOIN meal_menus mm ON mt.menu_id=mm.id WHERE mt.student_id=? ORDER BY mt.purchase_date DESC LIMIT 15', [req.session.user.id]);
  res.render('student/meals', { title: 'Dining', menus, myTokens, targetDate });
};

// Buy token with bKash or cash
exports.buyToken = async (req, res) => {
  const { menu_id, quantity, payment_method, bkash_number, bkash_txn } = req.body;
  try {
    const [[menu]] = await db.query('SELECT * FROM meal_menus WHERE id=?', [menu_id]);
    if (!menu) { req.flash('error', 'Menu not found.'); return res.redirect('/student/meals'); }
    const qty = parseInt(quantity) || 1;
    const total = menu.price * qty;
    const token_code = 'TK' + Date.now() + crypto.randomInt(100, 999);
    await db.query('INSERT INTO meal_tokens (student_id, menu_id, token_code, quantity, total_amount) VALUES (?, ?, ?, ?, ?)', [req.session.user.id, menu_id, token_code, qty, total]);
    const txnId = payment_method === 'bkash' ? (bkash_txn || 'BKASH-' + Date.now()) : null;
    await db.query('INSERT INTO payments (student_id, payment_type, amount, payment_method, transaction_id, status) VALUES (?, "dining", ?, ?, ?, "paid")',
      [req.session.user.id, total, payment_method || 'cash', txnId]);
    req.flash('success', `✅ Token purchased! Code: ${token_code}. Amount: ৳${total}. Download your receipt from the table below.`);
  } catch (err) { console.error(err); req.flash('error', 'Token purchase failed.'); }
  res.redirect('/student/meals');
};

// Download a PDF receipt for a meal token purchase
exports.downloadMealReceipt = async (req, res) => {
  try {
    const [[token]] = await db.query(
      'SELECT mt.*, mm.menu_date, mm.meal_type, mm.items, mm.price FROM meal_tokens mt JOIN meal_menus mm ON mt.menu_id=mm.id WHERE mt.id=? AND mt.student_id=?',
      [req.params.id, req.session.user.id]
    );
    if (!token) { req.flash('error', 'Receipt not found.'); return res.redirect('/student/meals'); }
    const [[student]] = await db.query('SELECT name, student_id FROM users WHERE id=?', [req.session.user.id]);
    const { streamMealReceipt } = require('../utils/receipts');
    streamMealReceipt(res, {
      token,
      menu: { menu_date: token.menu_date, meal_type: token.meal_type, items: token.items, price: token.price },
      student
    });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not generate receipt.');
    res.redirect('/student/meals');
  }
};

// Dues & Payments — pay due via bKash
exports.getDues = async (req, res) => {
  const [dues] = await db.query('SELECT * FROM monthly_dues WHERE student_id=? ORDER BY year DESC, month DESC', [req.session.user.id]);
  const [payments] = await db.query('SELECT * FROM payments WHERE student_id=? ORDER BY payment_date DESC', [req.session.user.id]);
  res.render('student/dues', { title: 'My Dues & Payments', dues, payments });
};

// Download a PDF receipt for a hall fee payment
exports.downloadHallReceipt = async (req, res) => {
  try {
    const [[payment]] = await db.query(
      'SELECT * FROM payments WHERE id=? AND student_id=? AND payment_type="hall_fee"',
      [req.params.id, req.session.user.id]
    );
    if (!payment) { req.flash('error', 'Receipt not found.'); return res.redirect('/student/dues'); }
    const [[student]] = await db.query('SELECT name, student_id FROM users WHERE id=?', [req.session.user.id]);
    const { streamHallPaymentReceipt } = require('../utils/receipts');
    streamHallPaymentReceipt(res, { payment, student });
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not generate receipt.');
    res.redirect('/student/dues');
  }
};

exports.payDue = async (req, res) => {
  const { bkash_number, bkash_txn, payment_method } = req.body;
  const dueId = req.params.id;
  const [[due]] = await db.query('SELECT * FROM monthly_dues WHERE id=? AND student_id=?', [dueId, req.session.user.id]);
  if (!due) { req.flash('error', 'Due not found.'); return res.redirect('/student/dues'); }
  if (due.status === 'paid') { req.flash('error', 'This due is already paid.'); return res.redirect('/student/dues'); }
  // For bKash: validate txn provided
  if (payment_method === 'bkash' && !bkash_txn) { req.flash('error', 'Please enter your bKash transaction ID.'); return res.redirect('/student/dues'); }
  await db.query('UPDATE monthly_dues SET status="paid", paid_on=NOW() WHERE id=?', [dueId]);
  const txnId = payment_method === 'bkash' ? bkash_txn : null;
  await db.query('INSERT INTO payments (student_id, payment_type, amount, month, year, payment_method, transaction_id, status) VALUES (?, "hall_fee", ?, ?, ?, ?, ?, "paid")',
    [req.session.user.id, due.amount, due.month, due.year, payment_method, txnId]);
  req.flash('success', `✅ Payment of ৳${due.amount} successful via ${payment_method.toUpperCase()}!`);
  res.redirect('/student/dues');
};

// ─── bKash Simulation ──────────────────────────────────────────────────────

const BKASH_MERCHANT_NUMBER = '01310247351';

// Helper: generate realistic bKash TxnID like "8DG10H9AR5"
function generateBkashTxnId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  for (let i = 0; i < 10; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

// GET /student/bkash/pay?type=due&id=X&amount=Y&label=Z
// GET /student/bkash/pay?type=token&menu_id=X&amount=Y&qty=N
exports.getBkashPay = async (req, res) => {
  const { type, id, amount, label, menu_id, qty } = req.query;
  res.render('student/bkash', {
    title: 'bKash Payment',
    merchantNumber: BKASH_MERCHANT_NUMBER,
    payType: type,       // 'due' | 'token'
    dueId: id || null,
    menuId: menu_id || null,
    amount: parseFloat(amount) || 0,
    label: label || '',
    qty: parseInt(qty) || 1,
  });
};

// POST /student/bkash/initiate — validates sender number, returns JSON for UI
// Normalize Bengali (Bangla) numerals to ASCII digits, in case the user
// typed the number using a Bangla keyboard/IME.
function toAsciiDigits(str) {
  const bn = '০১২৩৪৫৬৭৮৯';
  return String(str).replace(/[০-৯]/g, d => bn.indexOf(d));
}

exports.initiateBkash = async (req, res) => {
  let { sender_number, amount, pay_type, due_id, menu_id, qty } = req.body;
  sender_number = toAsciiDigits(sender_number || '').replace(/\D/g, '').trim();
  if (!sender_number || !/^01[3-9]\d{8}$/.test(sender_number)) {
    return res.json({ ok: false, message: 'Invalid bKash number. Please enter a valid 11-digit Bangladeshi mobile number.' });
  }
  if (sender_number === BKASH_MERCHANT_NUMBER) {
    return res.json({ ok: false, message: 'Sender number cannot be same as merchant number.' });
  }
  // Store pending payment in session
  req.session.bkashPending = { sender_number, amount: parseFloat(amount), pay_type, due_id, menu_id, qty: parseInt(qty)||1, initiatedAt: Date.now() };
  return res.json({ ok: true, merchantNumber: BKASH_MERCHANT_NUMBER, amount });
};

// POST /student/bkash/execute — simulate PIN check, finalize payment
exports.executeBkash = async (req, res) => {
  const { pin } = req.body;
  const pending = req.session.bkashPending;
  if (!pending) return res.json({ ok: false, message: 'Session expired. Please try again.' });
  if (!pin || pin.length < 4) return res.json({ ok: false, message: 'Incorrect PIN. Please try again.' });

  // Simulate processing delay handled client-side; here we commit the payment
  const txnId = generateBkashTxnId();
  const studentId = req.session.user.id;

  try {
    if (pending.pay_type === 'due' && pending.due_id) {
      const [[due]] = await db.query('SELECT * FROM monthly_dues WHERE id=? AND student_id=?', [pending.due_id, studentId]);
      if (!due) return res.json({ ok: false, message: 'Due record not found.' });
      if (due.status === 'paid') return res.json({ ok: false, message: 'This due is already paid.' });
      await db.query('UPDATE monthly_dues SET status="paid", paid_on=NOW() WHERE id=?', [pending.due_id]);
      await db.query(
        'INSERT INTO payments (student_id, payment_type, amount, month, year, payment_method, transaction_id, status) VALUES (?, "hall_fee", ?, ?, ?, "bkash", ?, "paid")',
        [studentId, due.amount, due.month, due.year, txnId]
      );
    } else if (pending.pay_type === 'token' && pending.menu_id) {
      const [[menu]] = await db.query('SELECT * FROM meal_menus WHERE id=?', [pending.menu_id]);
      if (!menu) return res.json({ ok: false, message: 'Menu not found.' });
      const qty = pending.qty;
      const total = menu.price * qty;
      const tokenCode = 'TK' + Date.now() + crypto.randomInt(100, 999);
      await db.query('INSERT INTO meal_tokens (student_id, menu_id, token_code, quantity, total_amount) VALUES (?, ?, ?, ?, ?)',
        [studentId, pending.menu_id, tokenCode, qty, total]);
      await db.query(
        'INSERT INTO payments (student_id, payment_type, amount, payment_method, transaction_id, status) VALUES (?, "dining", ?, "bkash", ?, "paid")',
        [studentId, total, txnId]
      );
      pending.tokenCode = tokenCode;
    }
    delete req.session.bkashPending;
    return res.json({ ok: true, txnId, amount: pending.amount, senderNumber: pending.sender_number, merchantNumber: BKASH_MERCHANT_NUMBER, tokenCode: pending.tokenCode || null });
  } catch (err) {
    console.error(err);
    return res.json({ ok: false, message: 'Payment processing failed. Please try again.' });
  }
};
