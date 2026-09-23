require('dotenv').config();


process.on('unhandledRejection', (reason) => {
  console.error('🔥 Unhandled Promise Rejection (server stayed alive):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('🔥 Uncaught Exception (server stayed alive):', err);
});

const express = require('express');
const asyncHandler = require('./middleware/asyncHandler');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const path = require('path');

const app = express();
const server = http.createServer(app); // wrap express app so Socket.io can attach to it
const io = new Server(server);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));

app.use(session({
  secret: process.env.SESSION_SECRET || 'july6hall_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

app.use(flash());

// Make io available to every controller via req.app.get('io')
app.set('io', io);

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  next();
});

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/admin', require('./routes/admin'));
app.use('/student', require('./routes/student'));

// Home page (landing page — no login required)
app.get('/', asyncHandler(async (req, res) => {
  const db = require('./config/db');
  let people = [];
  let settings = {};
  let notices = [];

  try {
    [people] = await db.query(
      'SELECT * FROM administration ORDER BY FIELD(role_type,"provost","assistant_provost","staff","contact"), display_order, id'
    );
  } catch (err) {
    // administration table may not exist yet if the migration hasn't run —
    // the homepage should still render with the default placeholder cards
    // rather than crash.
    console.error('Homepage: could not load administration:', err.message);
  }

  try {
    const [[row]] = await db.query('SELECT * FROM hall_settings WHERE id=1');
    settings = row || {};
  } catch (err) {
    console.error('Homepage: could not load hall_settings:', err.message);
  }

  try {
    [notices] = await db.query(
      'SELECT * FROM notices WHERE (publish_date IS NULL OR publish_date <= CURDATE()) AND status != "expired" ORDER BY priority DESC, created_at DESC LIMIT 3'
    );
  } catch (err) {
    console.error('Homepage: could not load notices:', err.message);
  }

  res.render('home/index', { title: 'July-6 Hall — PUST', people, settings, notices });
}));

// 404
app.use((req, res) => res.status(404).render('auth/404', { title: '404 Not Found' }));

// Global error handler — last line of defense. Without this, any
// unhandled rejection in a route (e.g. a bad SQL query) crashes the
// ENTIRE server process and takes down every user's session, not just
// the one request that failed. This middleware catches anything that
// reaches next(err) (including via the asyncHandler wrapper used in
// routes/*.js) and shows a friendly error page instead of crashing.
app.use((err, req, res, next) => {
  console.error('🔥 Unhandled route error:', err.message);
  if (process.env.NODE_ENV !== 'production') console.error(err.stack);

  if (req.flash) {
    req.flash('error', 'Something went wrong on our end. Please try again — if this keeps happening, contact the hall admin.');
  }

  // Prefer redirecting back to where the user came from over a blank
  // error page, so they don't lose their place in the app.
  const referer = req.get('Referer');
  if (referer && !res.headersSent) {
    return res.redirect(referer);
  }
  if (!res.headersSent) {
    res.status(500).send('Something went wrong. Please go back and try again.');
  }
});

io.on('connection', (socket) => {
  // Clients just listen for broadcasts; no inbound events needed yet.
  // Future stages (rooms, payments, notices) can join rooms/namespaces here
  // if updates ever need to be scoped to a specific student or admin.
});

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0'; // bind to all network interfaces, not just localhost

// Run any pending database migrations BEFORE accepting traffic, so the
// app never starts in a half-migrated state where some columns exist
// and others don't (the exact cause of every "Unknown column" crash
// seen so far).
const { runPendingMigrations } = require('./utils/migrate');

runPendingMigrations().finally(() => {
  server.listen(PORT, HOST, () => {
    const os = require('os');
    console.log(`🏛️  July-6 Hall Management System is running!`);
    console.log(`   Local:   http://localhost:${PORT}`);

    // Print the LAN IP(s) so other devices on the same Wi-Fi/network can connect
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          console.log(`   Network: http://${iface.address}:${PORT}  (use this on phones/other devices)`);
        }
      }
    }

    // Background jobs: auto-delete previous day's meal menu, auto-expire notices
    const { startScheduledJobs } = require('./utils/scheduledJobs');
    startScheduledJobs(io);
  });
});
