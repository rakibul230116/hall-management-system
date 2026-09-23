const express = require('express');
const router = express.Router();
const rawStudentController = require('../controllers/studentController');
const { isStudent } = require('../middleware/auth');
const { uploadProfilePhoto } = require('../middleware/upload');
const asyncHandler = require('../middleware/asyncHandler');

// See routes/admin.js for why this wrapping happens here, once, instead
// of per-route: it guarantees no student route can crash the server.
const studentController = Object.fromEntries(
  Object.entries(rawStudentController).map(([name, fn]) => [name, asyncHandler(fn)])
);

router.use(isStudent);

router.get('/dashboard', studentController.getDashboard);
router.get('/profile', studentController.getProfile);
router.post('/profile/update', uploadProfilePhoto.single('photo'), studentController.updateProfile);
router.post('/profile/change-password', studentController.changePassword);
router.get('/notices', studentController.getNotices);
router.get('/complaints', studentController.getComplaints);
router.post('/complaints/submit', studentController.submitComplaint);
router.get('/meals', studentController.getMenus);
router.post('/meals/buy-token', studentController.buyToken);
router.get('/meals/receipt/:id', studentController.downloadMealReceipt);
router.get('/dues', studentController.getDues);
router.post('/dues/:id/pay', studentController.payDue);
router.get('/dues/receipt/:id', studentController.downloadHallReceipt);

// bKash Simulation Routes
router.get('/bkash/pay', studentController.getBkashPay);
router.post('/bkash/initiate', studentController.initiateBkash);
router.post('/bkash/execute', studentController.executeBkash);

module.exports = router;
