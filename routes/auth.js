const express = require('express');
const router = express.Router();
const rawAuthController = require('../controllers/authController');
const { isGuest } = require('../middleware/auth');
const asyncHandler = require('../middleware/asyncHandler');

const authController = Object.fromEntries(
  Object.entries(rawAuthController).map(([name, fn]) => [name, asyncHandler(fn)])
);

router.get('/login', isGuest, authController.getLogin);
router.post('/login', isGuest, authController.postLogin);
router.get('/register', isGuest, authController.getRegister);
router.post('/register', isGuest, authController.postRegister);
router.get('/logout', authController.logout);

module.exports = router;
