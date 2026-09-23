const express = require('express');
const router = express.Router();
const rawAdminController = require('../controllers/adminController');
const { isAdmin } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

// Wrap every exported controller function with asyncHandler so a thrown
// or rejected error in ANY admin route is forwarded to Express's error
// handler instead of crashing the whole server. This is applied once,
// here, so individual route lines below don't need to be touched and
// nothing can accidentally be missed.
const adminController = Object.fromEntries(
  Object.entries(rawAdminController).map(([name, fn]) => [name, asyncHandler(fn)])
);

router.use(isAdmin);

const { uploadProfilePhoto, uploadRoomPhoto, uploadAdminPhoto, uploadNoticePhoto } = require('../middleware/upload');

router.get('/dashboard', adminController.getDashboard);
router.get('/dashboard/stats', adminController.getDashboardStats);

// Students
router.get('/students', adminController.getStudents);
router.get('/students/:id/edit', adminController.getEditStudent);
router.post('/students/:id/update', uploadProfilePhoto.single('photo'), adminController.updateStudent);
router.post('/students/:id/delete', adminController.deleteStudent);
router.post('/students/:id/status', adminController.updateStudentStatus);

// Rooms
router.get('/rooms', adminController.getRooms);
router.post('/rooms/add', adminController.addRoom);
router.get('/rooms/:id/edit', adminController.getEditRoom);
router.post('/rooms/:id/update', uploadRoomPhoto.single('photo'), adminController.updateRoom);
router.post('/rooms/:id/delete', adminController.deleteRoom);

// Allocations
router.get('/allocations', adminController.getAllocations);
router.post('/allocations/add', adminController.allocateSeat);
router.post('/allocations/:id/vacate', adminController.vacateSeat);
router.post('/allocations/transfer', adminController.transferSeat);

// Dues
router.get('/dues', adminController.getDues);
router.post('/dues/add', adminController.addDue);
router.post('/dues/generate', adminController.generateDues);
router.post('/dues/:id/paid', adminController.markDuePaid);

// Notices
router.get('/notices', adminController.getNotices);
router.post('/notices/add', uploadNoticePhoto.single('image'), adminController.addNotice);
router.post('/notices/:id/delete', adminController.deleteNotice);

// Administration (Provost / Assistant Provost / Staff)
router.get('/administration', adminController.getAdministration);
router.post('/administration/add', uploadAdminPhoto.single('photo'), adminController.addAdminPerson);
router.get('/administration/:id/edit', adminController.getEditAdminPerson);
router.post('/administration/:id/update', uploadAdminPhoto.single('photo'), adminController.updateAdminPerson);
router.post('/administration/:id/delete', adminController.deleteAdminPerson);

// Contact & Location settings
router.get('/settings', adminController.getSettings);
router.post('/settings/update', adminController.updateSettings);

// Complaints
router.get('/complaints', adminController.getComplaints);
router.post('/complaints/:id/reply', adminController.replyComplaint);

// Menus
router.get('/menus', adminController.getMenus);
router.post('/menus/add', adminController.addMenu);
router.post('/menus/:id/delete', adminController.deleteMenu);

// Payments
router.get('/payments', adminController.getPayments);
router.get('/payments/hall', adminController.getHallPayments);
router.get('/payments/dining', adminController.getDiningPayments);

// Reports
router.get('/reports', adminController.getReports);

module.exports = router;
