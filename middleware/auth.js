// Ensure user is logged in
exports.isAuthenticated = (req, res, next) => {
  if (req.session && req.session.user) return next();
  req.flash('error', 'Please login to continue.');
  res.redirect('/auth/login');
};

// Ensure user is admin
exports.isAdmin = (req, res, next) => {
  if (req.session && req.session.user && req.session.user.role === 'admin') return next();
  req.flash('error', 'Access denied. Admins only.');
  res.redirect('/auth/login');
};

// Ensure user is student
exports.isStudent = (req, res, next) => {
  if (req.session && req.session.user && req.session.user.role === 'student') return next();
  req.flash('error', 'Access denied.');
  res.redirect('/auth/login');
};

// Already logged in redirect
exports.isGuest = (req, res, next) => {
  if (!req.session || !req.session.user) return next();
  if (req.session.user.role === 'admin') return res.redirect('/admin/dashboard');
  return res.redirect('/student/dashboard');
};
