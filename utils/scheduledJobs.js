const db = require('../config/db');

/**
 * Cleans up previous-day meal menus.
 * Spec requirement: "Previous day's meal menu automatically deletes."
 *
 * IMPORTANT: a menu can't simply be hard-deleted once a student has bought
 * a token for it — meal_tokens.menu_id is a foreign key into meal_menus,
 * and receipts/purchase history need menu_date/items/price to stay intact.
 * Deleting it anyway throws ER_ROW_IS_REFERENCED and crashes the job.
 *
 * So the real behaviour is:
 *  - Menus from a previous day with NO linked token purchases: hard-deleted
 *    (nothing depends on them, safe to remove).
 *  - Menus from a previous day WITH linked purchases: kept in the table
 *    (so receipts keep working) but marked unavailable so they vanish from
 *    the student "buy a meal" listing, which is the actual user-facing
 *    requirement here.
 */
async function deleteOldMenus(io) {
  try {
    const [hasAvailableCol] = await db.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'meal_menus' AND COLUMN_NAME = 'available'`
    );
    if (!hasAvailableCol.length) {
      // Migration hasn't been run yet — skip silently rather than crashing
      // the whole server. The dashboard/menus pages will still work using
      // whatever columns already exist.
      return;
    }

    // 1) Menus from before today with zero purchases: safe to hard-delete.
    const [deleteResult] = await db.query(`
      DELETE m FROM meal_menus m
      LEFT JOIN meal_tokens t ON t.menu_id = m.id
      WHERE m.menu_date < CURDATE() AND t.id IS NULL
    `);

    // 2) Menus from before today that DO have purchases: keep the row,
    // just hide it from "buy a meal" going forward.
    const [hideResult] = await db.query(
      'UPDATE meal_menus SET available=0 WHERE menu_date < CURDATE() AND available=1'
    );

    const total = (deleteResult.affectedRows || 0) + (hideResult.affectedRows || 0);
    if (total > 0) {
      console.log(`🧹 Menu cleanup: deleted ${deleteResult.affectedRows} unused, hid ${hideResult.affectedRows} purchased.`);
      if (io) io.emit('menu:changed', {});
    }
  } catch (err) {
    // Never let a background job crash the whole server.
    console.error('deleteOldMenus error:', err.message);
  }
}

/**
 * Marks notices as expired once their expiry_date has passed, and emits a
 * real-time event so any open notice board updates without a refresh.
 * Spec requirement: "Automatic notice expiration."
 */
async function expireNotices(io) {
  try {
    const [hasExpiryCol] = await db.query(
      `SELECT 1 FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notices' AND COLUMN_NAME = 'expiry_date'`
    );
    if (!hasExpiryCol.length) return; // migration not run yet — skip silently

    const [result] = await db.query(
      'UPDATE notices SET status="expired" WHERE expiry_date IS NOT NULL AND expiry_date < CURDATE() AND status != "expired"'
    );
    if (result.affectedRows > 0) {
      console.log(`📢 Auto-expired ${result.affectedRows} notice(s).`);
      if (io) io.emit('notice:changed', {});
    }
  } catch (err) {
    console.error('expireNotices error:', err.message);
  }
}

/**
 * Starts all scheduled background jobs. Call once from app.js after the
 * server is listening. Uses setInterval rather than a cron package to
 * avoid adding another dependency for a coursework-scale app.
 */
function startScheduledJobs(io) {
  const HOUR = 60 * 60 * 1000;

  // Run once immediately on startup (covers the case where the server was
  // off overnight), then repeat every hour.
  deleteOldMenus(io);
  expireNotices(io);

  setInterval(() => deleteOldMenus(io), HOUR);
  setInterval(() => expireNotices(io), HOUR);
}

module.exports = { startScheduledJobs, deleteOldMenus, expireNotices };
