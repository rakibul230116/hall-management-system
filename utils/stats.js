const db = require('../config/db');

/**
 * Computes the 4 core dashboard stats required by the spec:
 *  - Total Students
 *  - Available Rooms   (rooms with status='available', i.e. not full/maintenance)
 *  - Occupied Seats     (sum of all currently-occupied seats across rooms)
 *  - Pending Payments   (count of monthly_dues rows with status='unpaid')
 *
 * Any controller that changes students, rooms, allocations, or dues should
 * call broadcastStats(io) afterwards so every connected dashboard updates
 * live, instead of requiring a page refresh.
 */
async function getCoreStats() {
  const [[{ totalStudents }]] = await db.query(
    'SELECT COUNT(*) AS totalStudents FROM users WHERE role="student"'
  );
  const [[{ availableRooms }]] = await db.query(
    'SELECT COUNT(*) AS availableRooms FROM rooms WHERE status="available"'
  );
  const [[{ totalRooms }]] = await db.query(
    'SELECT COUNT(*) AS totalRooms FROM rooms'
  );
  const [[{ occupiedSeats }]] = await db.query(
    'SELECT COALESCE(SUM(occupied),0) AS occupiedSeats FROM rooms'
  );
  const [[{ totalCapacity }]] = await db.query(
    'SELECT COALESCE(SUM(capacity),0) AS totalCapacity FROM rooms'
  );
  const [[{ pendingPayments }]] = await db.query(
    'SELECT COUNT(*) AS pendingPayments FROM monthly_dues WHERE status="unpaid"'
  );

  return {
    totalStudents,
    availableRooms,
    totalRooms,
    occupiedSeats,
    totalCapacity,
    pendingPayments
  };
}

/**
 * Recomputes stats and pushes them to every connected dashboard client
 * via the 'stats:update' Socket.io event. Safe to call even if io is
 * undefined (e.g. during a script/test run without a live server).
 */
async function broadcastStats(io) {
  try {
    const stats = await getCoreStats();
    if (io) io.emit('stats:update', stats);
    return stats;
  } catch (err) {
    console.error('broadcastStats error:', err.message);
    return null;
  }
}

module.exports = { getCoreStats, broadcastStats };
