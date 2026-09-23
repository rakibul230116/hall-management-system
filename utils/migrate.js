const mysql = require('mysql2/promise');

/**
 * Plain-JS schema migrations. No DELIMITER blocks, no stored procedures —
 * mysql2's query() executes one real SQL statement at a time and does NOT
 * understand "DELIMITER //", which is a MySQL *CLI* convenience, not real
 * SQL. Trying to send a DELIMITER-based .sql file through mysql2 silently
 * fails ("error near 'DELIMITER //'"), which is exactly what happened
 * before. Doing the "does this column exist" check here in JS instead
 * sidesteps that whole class of problem.
 *
 * Each migration step is independently safe to re-run: it checks
 * information_schema first and only runs the ALTER/CREATE if needed.
 */

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length > 0;
}

async function indexExists(conn, table, indexName) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, indexName]
  );
  return rows.length > 0;
}

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return rows.length > 0;
}

async function addColumnIfMissing(conn, table, column, definition) {
  if (await columnExists(conn, table, column)) return;
  await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  console.log(`  + added column ${table}.${column}`);
}

/**
 * Runs every migration step. Each step is wrapped in its own try/catch so
 * one failure (e.g. a column that already exists in a slightly different
 * form) doesn't block every other fix from applying.
 */
async function runStage2Migration(conn) {
  const steps = [
    // Student/room photo + audit columns
    () => addColumnIfMissing(conn, 'users', 'photo', 'VARCHAR(255) DEFAULT NULL'),
    () => addColumnIfMissing(conn, 'rooms', 'photo', 'VARCHAR(255) DEFAULT NULL'),
    () => addColumnIfMissing(conn, 'users', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'),
    () => addColumnIfMissing(conn, 'rooms', 'updated_at', 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'),

    // Seat double-booking guard (generated column + unique index)
    async () => {
      if (await columnExists(conn, 'room_allocations', 'active_seat_key')) return;
      await conn.query(`
        ALTER TABLE room_allocations
        ADD COLUMN active_seat_key VARCHAR(40)
        GENERATED ALWAYS AS (IF(status='active', CONCAT(room_id,'-',seat_number), NULL)) VIRTUAL
      `);
      console.log('  + added room_allocations.active_seat_key');
    },
    async () => {
      if (await indexExists(conn, 'room_allocations', 'unique_active_seat')) return;
      await conn.query(`ALTER TABLE room_allocations ADD UNIQUE KEY unique_active_seat (active_seat_key)`);
      console.log('  + added unique index unique_active_seat');
    },

    // Notice scheduling
    () => addColumnIfMissing(conn, 'notices', 'publish_date', 'DATE DEFAULT NULL'),
    () => addColumnIfMissing(conn, 'notices', 'expiry_date', 'DATE DEFAULT NULL'),
    () => addColumnIfMissing(conn, 'notices', 'status', "VARCHAR(20) DEFAULT 'active'"),
    () => addColumnIfMissing(conn, 'notices', 'image_filename', 'VARCHAR(255) DEFAULT NULL'),

    // Meal menu auto-hide support
    () => addColumnIfMissing(conn, 'meal_menus', 'available', 'TINYINT(1) DEFAULT 1'),

    // Repair complaints.category — fixes "Data truncated for column 'category'"
    // on installs where this table ended up with a narrower/different
    // definition than schema.sql.
    async () => {
      await conn.query(
        `ALTER TABLE complaints MODIFY COLUMN category ENUM('water','electricity','food','maintenance','security','other') DEFAULT 'other'`
      );
      console.log('  + repaired complaints.category column definition');
    },

    // Administration section
    async () => {
      if (await tableExists(conn, 'administration')) return;
      await conn.query(`
        CREATE TABLE administration (
          id INT AUTO_INCREMENT PRIMARY KEY,
          role_type ENUM('provost','assistant_provost','staff','contact') NOT NULL,
          name VARCHAR(150) NOT NULL,
          designation VARCHAR(150) DEFAULT NULL,
          department VARCHAR(150) DEFAULT NULL,
          phone VARCHAR(30) DEFAULT NULL,
          email VARCHAR(150) DEFAULT NULL,
          photo VARCHAR(255) DEFAULT NULL,
          display_order INT DEFAULT 0,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      console.log('  + created table administration');
    },

    // Contact & Location settings (single-row table)
    async () => {
      if (!(await tableExists(conn, 'hall_settings'))) {
        await conn.query(`
          CREATE TABLE hall_settings (
            id INT PRIMARY KEY DEFAULT 1,
            address TEXT DEFAULT NULL,
            phone VARCHAR(30) DEFAULT NULL,
            email VARCHAR(150) DEFAULT NULL,
            map_embed_url TEXT DEFAULT NULL,
            facebook_url VARCHAR(255) DEFAULT NULL,
            website_url VARCHAR(255) DEFAULT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
          )
        `);
        console.log('  + created table hall_settings');
      }
      await conn.query(
        `INSERT IGNORE INTO hall_settings (id, address, phone, email) VALUES (1, ?, ?, ?)`,
        [
          'July-6 Hall, Pabna University of Science & Technology, Shibpur, Pabna-6600, Bangladesh',
          '+880-XXX-XXXXXXX',
          'july6hall@pust.ac.bd'
        ]
      );
    }
  ];

  for (const step of steps) {
    try {
      await step();
    } catch (err) {
      console.error(`  ⚠️  migration step failed: ${err.message}`);
      // keep going — one failed step shouldn't block the rest
    }
  }
}

/**
 * Connects to the database and runs all migrations. Tracks completion in
 * a `_migrations` table so this is a no-op on every restart after the
 * first successful run, while still being safe to re-run at any time.
 */
async function runPendingMigrations() {
  let connection;
  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME
    });
  } catch (err) {
    console.error('⚠️  Could not connect to run migrations:', err.message);
    return;
  }

  try {
    await connection.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        filename VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const MIGRATION_NAME = 'stage2_photos_and_crud';
    const [applied] = await connection.query('SELECT 1 FROM _migrations WHERE filename = ?', [MIGRATION_NAME]);

    if (applied.length > 0) {
      // Already marked applied — but still re-verify nothing is missing,
      // in case the database was reset or modified manually in between.
      console.log('🔎 Verifying schema is up to date...');
      await runStage2Migration(connection);
      return;
    }

    console.log('🔧 Applying database migration (stage2_photos_and_crud)...');
    await runStage2Migration(connection);
    await connection.query('INSERT INTO _migrations (filename) VALUES (?)', [MIGRATION_NAME]);
    console.log('✅ Migration complete.');
  } catch (err) {
    console.error('⚠️  Migration runner error:', err.message);
  } finally {
    await connection.end();
  }
}

module.exports = { runPendingMigrations };
