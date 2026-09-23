const db = require('../config/db');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const { getCoreStats, broadcastStats } = require('../utils/stats');

// Dashboard
exports.getDashboard = async (req, res) => {
  try {
    const stats = await getCoreStats();
    const [[{ pendingComplaints }]] = await db.query('SELECT COUNT(*) AS pendingComplaints FROM complaints WHERE status="pending"');
    const [[{ totalRevenue }]] = await db.query('SELECT COALESCE(SUM(amount),0) AS totalRevenue FROM payments WHERE status="paid"');
    const [recentStudents] = await db.query('SELECT * FROM users WHERE role="student" ORDER BY created_at DESC LIMIT 5');
    const [recentNotices] = await db.query('SELECT n.*, u.name AS posted_by_name FROM notices n JOIN users u ON n.posted_by=u.id ORDER BY n.created_at DESC LIMIT 5');
    res.render('admin/dashboard', {
      title: 'Admin Dashboard',
      stats: { ...stats, pendingComplaints, totalRevenue },
      recentStudents,
      recentNotices
    });
  } catch (err) {
    console.error(err);
    res.render('admin/dashboard', { title: 'Admin Dashboard', stats: {}, recentStudents: [], recentNotices: [] });
  }
};

// JSON endpoint the dashboard can poll as a fallback if the Socket.io
// connection ever drops, so the cards never go stale.
exports.getDashboardStats = async (req, res) => {
  try {
    const stats = await getCoreStats();
    res.json({ ok: true, stats });
  } catch (err) {
    res.json({ ok: false, message: 'Could not load stats.' });
  }
};

// ── STUDENTS ──
exports.getStudents = async (req, res) => {
  const { search } = req.query;
  let query = 'SELECT u.*, ra.room_id, r.room_number FROM users u LEFT JOIN room_allocations ra ON u.id=ra.student_id AND ra.status="active" LEFT JOIN rooms r ON ra.room_id=r.id WHERE u.role="student"';
  const params = [];
  if (search) { query += ' AND (u.name LIKE ? OR u.student_id LIKE ? OR u.email LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  query += ' ORDER BY u.created_at DESC';
  const [students] = await db.query(query, params);
  res.render('admin/students', { title: 'Manage Students', students, search });
};

exports.getEditStudent = async (req, res) => {
  const [rows] = await db.query('SELECT * FROM users WHERE id=? AND role="student"', [req.params.id]);
  if (!rows.length) return res.json({ ok: false, message: 'Student not found.' });
  res.json({ ok: true, student: rows[0] });
};

exports.updateStudent = async (req, res) => {
  const { name, email, student_id, phone, department, session: sessionVal, gender } = req.body;
  try {
    const fields = ['name=?', 'email=?', 'student_id=?', 'phone=?', 'department=?', 'session=?', 'gender=?'];
    const params = [name, email, student_id || null, phone || null, department || null, sessionVal || null, gender || 'male'];

    if (req.file) {
      fields.push('photo=?');
      params.push(req.file.filename);
      // Best-effort cleanup of the old photo so uploads/profiles doesn't grow unbounded
      const [old] = await db.query('SELECT photo FROM users WHERE id=?', [req.params.id]);
      if (old.length && old[0].photo) {
        const oldPath = path.join(__dirname, '..', 'public', 'uploads', 'profiles', old[0].photo);
        fs.unlink(oldPath, () => {}); // ignore errors — file may not exist
      }
    }

    params.push(req.params.id);
    await db.query(`UPDATE users SET ${fields.join(', ')} WHERE id=?`, params);
    await broadcastStats(req.app.get('io'));
    const io = req.app.get('io');
    if (io) io.emit('student:updated', { id: Number(req.params.id) });
    req.flash('success', 'Student updated successfully.');
  } catch (err) {
    console.error(err);
    req.flash('error', err.code === 'ER_DUP_ENTRY' ? 'Email or Student ID already in use.' : 'Update failed.');
  }
  res.redirect('/admin/students');
};

exports.deleteStudent = async (req, res) => {
  try {
    // Clean up dependent rows first to avoid FK constraint failures
    await db.query('UPDATE room_allocations SET status="vacated", vacated_date=CURDATE() WHERE student_id=? AND status="active"', [req.params.id]);
    const [allocRows] = await db.query('SELECT room_id FROM room_allocations WHERE student_id=? AND vacated_date=CURDATE()', [req.params.id]);
    for (const row of allocRows) {
      await db.query('UPDATE rooms SET occupied=GREATEST(occupied-1,0), status="available" WHERE id=?', [row.room_id]);
    }
    const [photoRows] = await db.query('SELECT photo FROM users WHERE id=?', [req.params.id]);
    await db.query('DELETE FROM users WHERE id=? AND role="student"', [req.params.id]);
    if (photoRows.length && photoRows[0].photo) {
      const photoPath = path.join(__dirname, '..', 'public', 'uploads', 'profiles', photoRows[0].photo);
      fs.unlink(photoPath, () => {});
    }
    await broadcastStats(req.app.get('io'));
    req.flash('success', 'Student deleted.');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not delete student — they may have existing payment or due records.');
  }
  res.redirect('/admin/students');
};

exports.updateStudentStatus = async (req, res) => {
  await db.query('UPDATE users SET status=? WHERE id=?', [req.body.status, req.params.id]);
  await broadcastStats(req.app.get('io'));
  req.flash('success', 'Student status updated.');
  res.redirect('/admin/students');
};

// ── ROOMS ──
exports.getRooms = async (req, res) => {
  const [rooms] = await db.query('SELECT r.*, (SELECT COUNT(*) FROM room_allocations ra WHERE ra.room_id=r.id AND ra.status="active") AS current_occupants FROM rooms r ORDER BY r.room_number');
  res.render('admin/rooms', { title: 'Room Management', rooms });
};

exports.addRoom = async (req, res) => {
  const { room_number, floor, capacity, type } = req.body;
  try {
    await db.query('INSERT INTO rooms (room_number, floor, capacity, type) VALUES (?, ?, ?, ?)', [room_number, floor, capacity, type]);
    await broadcastStats(req.app.get('io'));
    req.app.get('io')?.emit('room:changed', {});
    req.flash('success', 'Room added successfully.');
  } catch { req.flash('error', 'Room number already exists.'); }
  res.redirect('/admin/rooms');
};

exports.getEditRoom = async (req, res) => {
  const [rows] = await db.query('SELECT * FROM rooms WHERE id=?', [req.params.id]);
  if (!rows.length) return res.json({ ok: false, message: 'Room not found.' });
  res.json({ ok: true, room: rows[0] });
};

exports.updateRoom = async (req, res) => {
  const { room_number, floor, capacity, type } = req.body;
  try {
    const [[room]] = await db.query('SELECT occupied FROM rooms WHERE id=?', [req.params.id]);
    if (!room) { req.flash('error', 'Room not found.'); return res.redirect('/admin/rooms'); }

    // Guard: never let capacity drop below the number of students already
    // occupying the room — that would silently create an over-capacity room.
    if (Number(capacity) < room.occupied) {
      req.flash('error', `Cannot set capacity to ${capacity} — ${room.occupied} student(s) are already assigned to this room. Transfer them out first.`);
      return res.redirect('/admin/rooms');
    }

    const fields = ['room_number=?', 'floor=?', 'capacity=?', 'type=?', 'status=IF(occupied>=?,"full","available")'];
    const params = [room_number, floor, capacity, type, capacity];

    if (req.file) {
      fields.push('photo=?');
      params.push(req.file.filename);
      const [old] = await db.query('SELECT photo FROM rooms WHERE id=?', [req.params.id]);
      if (old.length && old[0].photo) {
        fs.unlink(path.join(__dirname, '..', 'public', 'uploads', 'rooms', old[0].photo), () => {});
      }
    }

    params.push(req.params.id);
    await db.query(`UPDATE rooms SET ${fields.join(', ')} WHERE id=?`, params);
    await broadcastStats(req.app.get('io'));
    req.app.get('io')?.emit('room:changed', { id: Number(req.params.id) });
    req.flash('success', 'Room updated successfully.');
  } catch (err) {
    console.error(err);
    req.flash('error', err.code === 'ER_DUP_ENTRY' ? 'Room number already exists.' : 'Update failed.');
  }
  res.redirect('/admin/rooms');
};

exports.deleteRoom = async (req, res) => {
  const [[room]] = await db.query('SELECT occupied, photo FROM rooms WHERE id=?', [req.params.id]);
  if (room && room.occupied > 0) {
    req.flash('error', `Cannot delete this room — it still has ${room.occupied} student(s) assigned. Transfer or vacate them first.`);
    return res.redirect('/admin/rooms');
  }
  await db.query('DELETE FROM rooms WHERE id=?', [req.params.id]);
  if (room && room.photo) {
    fs.unlink(path.join(__dirname, '..', 'public', 'uploads', 'rooms', room.photo), () => {});
  }
  await broadcastStats(req.app.get('io'));
  req.app.get('io')?.emit('room:changed', {});
  req.flash('success', 'Room deleted.');
  res.redirect('/admin/rooms');
};

// ── SEAT ALLOCATION (auto-generates due on allocation) ──
exports.getAllocations = async (req, res) => {
  const [allocations] = await db.query(`
    SELECT ra.*, u.name AS student_name, u.student_id, r.room_number
    FROM room_allocations ra JOIN users u ON ra.student_id=u.id JOIN rooms r ON ra.room_id=r.id
    WHERE ra.status='active' ORDER BY r.room_number, ra.seat_number`);
  const [unallocated] = await db.query(`SELECT * FROM users WHERE role='student' AND status='active' AND id NOT IN (SELECT student_id FROM room_allocations WHERE status='active')`);
  const [availableRooms] = await db.query(`SELECT * FROM rooms WHERE status != 'maintenance' AND occupied < capacity ORDER BY room_number`);
  res.render('admin/allocations', { title: 'Seat Allocation', allocations, unallocated, availableRooms });
};

exports.allocateSeat = async (req, res) => {
  const { student_id, room_id, seat_number, allocated_date, due_amount, due_date } = req.body;
  try {
    const [[room]] = await db.query('SELECT * FROM rooms WHERE id=?', [room_id]);
    if (!room) { req.flash('error', 'Room not found.'); return res.redirect('/admin/allocations'); }
    if (room.occupied >= room.capacity) {
      req.flash('error', `Room ${room.room_number} is already full (${room.occupied}/${room.capacity}). Cannot assign another student.`);
      return res.redirect('/admin/allocations');
    }
    if (Number(seat_number) > room.capacity || Number(seat_number) < 1) {
      req.flash('error', `Seat number must be between 1 and ${room.capacity} for this room.`);
      return res.redirect('/admin/allocations');
    }
    const [[seatTaken]] = await db.query('SELECT id FROM room_allocations WHERE room_id=? AND seat_number=? AND status="active"', [room_id, seat_number]);
    if (seatTaken) {
      req.flash('error', `Seat ${seat_number} in Room ${room.room_number} is already occupied.`);
      return res.redirect('/admin/allocations');
    }

    await db.query('INSERT INTO room_allocations (student_id, room_id, seat_number, allocated_date) VALUES (?, ?, ?, ?)', [student_id, room_id, seat_number, allocated_date]);
    await db.query('UPDATE rooms SET occupied=occupied+1, status=IF(occupied+1>=capacity,"full","available") WHERE id=?', [room_id]);
    // Auto-generate due for current month
    const now = new Date();
    const monthName = now.toLocaleString('en-US', { month: 'long' });
    const year = now.getFullYear();
    const amount = due_amount || 2000;
    const dDate = due_date || new Date(now.getFullYear(), now.getMonth() + 1, 7).toISOString().split('T')[0];
    await db.query('INSERT IGNORE INTO monthly_dues (student_id, month, year, amount, due_date) VALUES (?, ?, ?, ?, ?)', [student_id, monthName, year, amount, dDate]);
    await broadcastStats(req.app.get('io'));
    req.app.get('io')?.emit('room:changed', {});
    req.flash('success', 'Seat allocated and monthly due generated automatically.');
  } catch (e) { console.error(e); req.flash('error', 'Allocation failed. Seat may already be taken.'); }
  res.redirect('/admin/allocations');
};

exports.vacateSeat = async (req, res) => {
  const [rows] = await db.query('SELECT * FROM room_allocations WHERE id=?', [req.params.id]);
  if (rows.length) {
    await db.query('UPDATE room_allocations SET status="vacated", vacated_date=CURDATE() WHERE id=?', [req.params.id]);
    await db.query('UPDATE rooms SET occupied=GREATEST(occupied-1,0), status="available" WHERE id=?', [rows[0].room_id]);
    await broadcastStats(req.app.get('io'));
    req.app.get('io')?.emit('room:changed', {});
    req.flash('success', 'Seat vacated.');
  }
  res.redirect('/admin/allocations');
};

// Transfer a student to a different room/seat in one atomic-ish step:
// vacate the old allocation, then allocate the new one — but only if the
// destination room actually has free capacity. Guards against ever putting
// more students in a room than its capacity allows.
exports.transferSeat = async (req, res) => {
  const { allocation_id, new_room_id, new_seat_number } = req.body;
  try {
    const [[current]] = await db.query('SELECT * FROM room_allocations WHERE id=? AND status="active"', [allocation_id]);
    if (!current) { req.flash('error', 'Active allocation not found.'); return res.redirect('/admin/allocations'); }

    const [[destRoom]] = await db.query('SELECT * FROM rooms WHERE id=?', [new_room_id]);
    if (!destRoom) { req.flash('error', 'Destination room not found.'); return res.redirect('/admin/allocations'); }

    if (Number(destRoom.id) !== Number(current.room_id) && destRoom.occupied >= destRoom.capacity) {
      req.flash('error', `Room ${destRoom.room_number} is already full (${destRoom.occupied}/${destRoom.capacity}). Choose another room.`);
      return res.redirect('/admin/allocations');
    }

    // Vacate old seat
    await db.query('UPDATE room_allocations SET status="vacated", vacated_date=CURDATE() WHERE id=?', [allocation_id]);
    await db.query('UPDATE rooms SET occupied=GREATEST(occupied-1,0), status="available" WHERE id=?', [current.room_id]);

    // Allocate new seat
    await db.query('INSERT INTO room_allocations (student_id, room_id, seat_number, allocated_date) VALUES (?, ?, ?, CURDATE())', [current.student_id, new_room_id, new_seat_number]);
    await db.query('UPDATE rooms SET occupied=occupied+1, status=IF(occupied+1>=capacity,"full","available") WHERE id=?', [new_room_id]);

    await broadcastStats(req.app.get('io'));
    req.app.get('io')?.emit('room:changed', {});
    req.flash('success', `Student transferred to Room ${destRoom.room_number}, Seat ${new_seat_number}.`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Transfer failed — that seat may already be taken.');
  }
  res.redirect('/admin/allocations');
};

// ── MONTHLY DUES ──
exports.getDues = async (req, res) => {
  const { month, year } = req.query;
  let query = `SELECT md.*, u.name, u.student_id FROM monthly_dues md JOIN users u ON md.student_id=u.id WHERE 1=1`;
  const params = [];
  if (month) { query += ' AND md.month=?'; params.push(month); }
  if (year) { query += ' AND md.year=?'; params.push(year); }
  query += ' ORDER BY md.year DESC, md.month DESC, u.name';
  const [dues] = await db.query(query, params);
  const [students] = await db.query('SELECT id, name, student_id FROM users WHERE role="student" AND status="active"');
  res.render('admin/dues', { title: 'Monthly Dues', dues, students, month, year });
};

exports.addDue = async (req, res) => {
  const { student_id, month, year, amount, due_date } = req.body;
  try {
    await db.query('INSERT INTO monthly_dues (student_id, month, year, amount, due_date) VALUES (?, ?, ?, ?, ?)', [student_id, month, year, amount, due_date]);
    await broadcastStats(req.app.get('io'));
    req.flash('success', 'Due added.');
  } catch { req.flash('error', 'Due already exists for this student/month.'); }
  res.redirect('/admin/dues');
};

exports.generateDues = async (req, res) => {
  const { month, year, amount, due_date } = req.body;
  const [students] = await db.query('SELECT id FROM users WHERE role="student" AND status="active"');
  let added = 0;
  for (const s of students) {
    try { await db.query('INSERT IGNORE INTO monthly_dues (student_id, month, year, amount, due_date) VALUES (?, ?, ?, ?, ?)', [s.id, month, year, amount, due_date]); added++; } catch {}
  }
  await broadcastStats(req.app.get('io'));
  req.flash('success', `Generated dues for ${added} students.`);
  res.redirect('/admin/dues');
};

exports.markDuePaid = async (req, res) => {
  const { payment_method, transaction_id } = req.body;
  await db.query('UPDATE monthly_dues SET status="paid", paid_on=NOW() WHERE id=?', [req.params.id]);
  const [rows] = await db.query('SELECT * FROM monthly_dues WHERE id=?', [req.params.id]);
  if (rows.length) {
    const due = rows[0];
    await db.query('INSERT INTO payments (student_id, payment_type, amount, month, year, payment_method, transaction_id, status) VALUES (?, "hall_fee", ?, ?, ?, ?, ?, "paid")',
      [due.student_id, due.amount, due.month, due.year, payment_method || 'cash', transaction_id || null]);
  }
  await broadcastStats(req.app.get('io'));
  req.flash('success', 'Marked as paid.');
  res.redirect('/admin/dues');
};

// ── NOTICES ──
exports.getNotices = async (req, res) => {
  const [notices] = await db.query('SELECT n.*, u.name AS posted_by_name FROM notices n JOIN users u ON n.posted_by=u.id ORDER BY n.created_at DESC');
  res.render('admin/notices', { title: 'Notice Board', notices });
};

exports.addNotice = async (req, res) => {
  const { title, content, priority, image_url, publish_date, expiry_date } = req.body;
  const image_filename = req.file ? req.file.filename : null;
  await db.query(
    'INSERT INTO notices (title, content, posted_by, priority, image_url, image_filename, publish_date, expiry_date, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, "active")',
    [title, content, req.session.user.id, priority, image_url || null, image_filename, publish_date || null, expiry_date || null]
  );
  req.app.get('io')?.emit('notice:changed', {});
  req.flash('success', 'Notice posted.');
  res.redirect('/admin/notices');
};

exports.deleteNotice = async (req, res) => {
  const [rows] = await db.query('SELECT image_filename FROM notices WHERE id=?', [req.params.id]);
  await db.query('DELETE FROM notices WHERE id=?', [req.params.id]);
  if (rows.length && rows[0].image_filename) {
    fs.unlink(path.join(__dirname, '..', 'public', 'uploads', 'notices', rows[0].image_filename), () => {});
  }
  req.app.get('io')?.emit('notice:changed', {});
  req.flash('success', 'Notice deleted.');
  res.redirect('/admin/notices');
};

// ── COMPLAINTS ──
exports.getComplaints = async (req, res) => {
  const { status } = req.query;
  let query = 'SELECT c.*, u.name AS student_name, u.student_id FROM complaints c JOIN users u ON c.student_id=u.id';
  const params = [];
  if (status) { query += ' WHERE c.status=?'; params.push(status); }
  query += ' ORDER BY c.created_at DESC';
  const [complaints] = await db.query(query, params);
  res.render('admin/complaints', { title: 'Complaints', complaints, filter: status });
};

exports.replyComplaint = async (req, res) => {
  const { admin_reply, status } = req.body;
  await db.query('UPDATE complaints SET admin_reply=?, status=?, replied_at=NOW() WHERE id=?', [admin_reply, status, req.params.id]);
  req.flash('success', 'Reply sent.');
  res.redirect('/admin/complaints');
};

// ── MEAL MENU ──
exports.getMenus = async (req, res) => {
  const [menus] = await db.query('SELECT m.*, u.name AS created_by_name FROM meal_menus m JOIN users u ON m.created_by=u.id ORDER BY m.menu_date DESC, FIELD(m.meal_type,"breakfast","lunch","dinner")');
  res.render('admin/menus', { title: 'Meal Menus', menus });
};

exports.addMenu = async (req, res) => {
  const { menu_date, meal_type, items, price } = req.body;
  try {
    await db.query('INSERT INTO meal_menus (menu_date, meal_type, items, price, created_by) VALUES (?, ?, ?, ?, ?)', [menu_date, meal_type, items, price, req.session.user.id]);
    req.flash('success', 'Menu added.');
  } catch { req.flash('error', 'Menu already exists for this date and meal type.'); }
  res.redirect('/admin/menus');
};

exports.deleteMenu = async (req, res) => {
  await db.query('DELETE FROM meal_menus WHERE id=?', [req.params.id]);
  req.flash('success', 'Menu deleted.');
  res.redirect('/admin/menus');
};

// ── PAYMENTS (kept separate per spec: Hall Payment vs Dining Payment) ──
exports.getPayments = async (req, res) => {
  // Legacy combined view, still available if anything links to it directly.
  const [payments] = await db.query('SELECT p.*, u.name, u.student_id FROM payments p JOIN users u ON p.student_id=u.id ORDER BY p.payment_date DESC');
  res.render('admin/payments', { title: 'Payment Records', payments });
};

exports.getHallPayments = async (req, res) => {
  const [payments] = await db.query(
    'SELECT p.*, u.name, u.student_id FROM payments p JOIN users u ON p.student_id=u.id WHERE p.payment_type="hall_fee" ORDER BY p.payment_date DESC'
  );
  const [[{ totalHallRevenue }]] = await db.query('SELECT COALESCE(SUM(amount),0) AS totalHallRevenue FROM payments WHERE payment_type="hall_fee" AND status="paid"');
  res.render('admin/hall-payments', { title: 'Hall Payment History', payments, totalHallRevenue });
};

exports.getDiningPayments = async (req, res) => {
  const [payments] = await db.query(
    'SELECT p.*, u.name, u.student_id FROM payments p JOIN users u ON p.student_id=u.id WHERE p.payment_type="dining" ORDER BY p.payment_date DESC'
  );
  const [[{ totalDiningRevenue }]] = await db.query('SELECT COALESCE(SUM(amount),0) AS totalDiningRevenue FROM payments WHERE payment_type="dining" AND status="paid"');
  res.render('admin/dining-payments', { title: 'Dining Payment History', payments, totalDiningRevenue });
};

// ── REPORTS ──
exports.getReports = async (req, res) => {
  const [[{ totalPaid }]] = await db.query('SELECT COALESCE(SUM(amount),0) AS totalPaid FROM payments WHERE status="paid"');
  const [[{ unpaidCount }]] = await db.query('SELECT COUNT(*) AS unpaidCount FROM monthly_dues WHERE status="unpaid"');
  const [[{ unpaidAmount }]] = await db.query('SELECT COALESCE(SUM(amount),0) AS unpaidAmount FROM monthly_dues WHERE status="unpaid"');
  const [paymentsByType] = await db.query('SELECT payment_type, SUM(amount) AS total FROM payments WHERE status="paid" GROUP BY payment_type');
  const [monthlyPayments] = await db.query('SELECT month, year, SUM(amount) AS total FROM payments WHERE status="paid" GROUP BY year, month ORDER BY year DESC, month DESC LIMIT 12');
  res.render('admin/reports', { title: 'Reports', totalPaid, unpaidCount, unpaidAmount, paymentsByType, monthlyPayments });
};

// ── ADMINISTRATION SECTION (Provost / Assistant Provost / Staff) ──
exports.getAdministration = async (req, res) => {
  const [people] = await db.query('SELECT * FROM administration ORDER BY FIELD(role_type,"provost","assistant_provost","staff","contact"), display_order, id');
  res.render('admin/administration', { title: 'Administration', people });
};

exports.addAdminPerson = async (req, res) => {
  const { role_type, name, designation, department, phone, email, display_order } = req.body;
  try {
    const photo = req.file ? req.file.filename : null;
    await db.query(
      'INSERT INTO administration (role_type, name, designation, department, phone, email, photo, display_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [role_type, name, designation || null, department || null, phone || null, email || null, photo, display_order || 0]
    );
    req.flash('success', `${name} added to Administration.`);
  } catch (err) {
    console.error(err);
    req.flash('error', 'Could not add this person.');
  }
  res.redirect('/admin/administration');
};

exports.getEditAdminPerson = async (req, res) => {
  const [rows] = await db.query('SELECT * FROM administration WHERE id=?', [req.params.id]);
  if (!rows.length) return res.json({ ok: false, message: 'Not found.' });
  res.json({ ok: true, person: rows[0] });
};

exports.updateAdminPerson = async (req, res) => {
  const { role_type, name, designation, department, phone, email, display_order } = req.body;
  try {
    const fields = ['role_type=?', 'name=?', 'designation=?', 'department=?', 'phone=?', 'email=?', 'display_order=?'];
    const params = [role_type, name, designation || null, department || null, phone || null, email || null, display_order || 0];

    if (req.file) {
      fields.push('photo=?');
      params.push(req.file.filename);
      const [old] = await db.query('SELECT photo FROM administration WHERE id=?', [req.params.id]);
      if (old.length && old[0].photo) {
        fs.unlink(path.join(__dirname, '..', 'public', 'uploads', 'administration', old[0].photo), () => {});
      }
    }

    params.push(req.params.id);
    await db.query(`UPDATE administration SET ${fields.join(', ')} WHERE id=?`, params);
    req.flash('success', 'Updated successfully.');
  } catch (err) {
    console.error(err);
    req.flash('error', 'Update failed.');
  }
  res.redirect('/admin/administration');
};

exports.deleteAdminPerson = async (req, res) => {
  const [rows] = await db.query('SELECT photo FROM administration WHERE id=?', [req.params.id]);
  await db.query('DELETE FROM administration WHERE id=?', [req.params.id]);
  if (rows.length && rows[0].photo) {
    fs.unlink(path.join(__dirname, '..', 'public', 'uploads', 'administration', rows[0].photo), () => {});
  }
  req.flash('success', 'Removed.');
  res.redirect('/admin/administration');
};

// ── CONTACT & LOCATION SETTINGS ──
exports.getSettings = async (req, res) => {
  const [[settings]] = await db.query('SELECT * FROM hall_settings WHERE id=1');
  res.render('admin/settings', { title: 'Contact & Location', settings: settings || {} });
};

exports.updateSettings = async (req, res) => {
  const { address, phone, email, map_embed_url, facebook_url, website_url } = req.body;
  await db.query(
    `INSERT INTO hall_settings (id, address, phone, email, map_embed_url, facebook_url, website_url)
     VALUES (1, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE address=VALUES(address), phone=VALUES(phone), email=VALUES(email),
       map_embed_url=VALUES(map_embed_url), facebook_url=VALUES(facebook_url), website_url=VALUES(website_url)`,
    [address, phone, email, map_embed_url || null, facebook_url || null, website_url || null]
  );
  req.flash('success', 'Contact & location info updated.');
  res.redirect('/admin/settings');
};
