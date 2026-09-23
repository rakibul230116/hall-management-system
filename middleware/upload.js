const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure upload directories exist before Multer tries to write into them
const PROFILE_DIR = path.join(__dirname, '..', 'public', 'uploads', 'profiles');
const ROOM_DIR = path.join(__dirname, '..', 'public', 'uploads', 'rooms');
const ADMIN_DIR = path.join(__dirname, '..', 'public', 'uploads', 'administration');
const NOTICE_DIR = path.join(__dirname, '..', 'public', 'uploads', 'notices');
[PROFILE_DIR, ROOM_DIR, ADMIN_DIR, NOTICE_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const ALLOWED_TYPES = /jpeg|jpg|png|webp/;

function makeStorage(destDir) {
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, destDir),
    filename: (req, file, cb) => {
      // e.g. "student_12_1719400000000.jpg" — unique, traceable, no collisions
      const ext = path.extname(file.originalname).toLowerCase();
      const idPart = req.params.id || req.session?.user?.id || 'anon';
      cb(null, `${idPart}_${Date.now()}${ext}`);
    }
  });
}

function fileFilter(req, file, cb) {
  const extOk = ALLOWED_TYPES.test(path.extname(file.originalname).toLowerCase());
  const mimeOk = ALLOWED_TYPES.test(file.mimetype);
  if (extOk && mimeOk) return cb(null, true);
  cb(new Error('Only JPG, PNG, or WEBP images are allowed.'));
}

const uploadProfilePhoto = multer({
  storage: makeStorage(PROFILE_DIR),
  limits: { fileSize: 3 * 1024 * 1024 }, // 3MB
  fileFilter
});

const uploadRoomPhoto = multer({
  storage: makeStorage(ROOM_DIR),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter
});

const uploadAdminPhoto = multer({
  storage: makeStorage(ADMIN_DIR),
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter
});

const uploadNoticePhoto = multer({
  storage: makeStorage(NOTICE_DIR),
  limits: { fileSize: 5 * 1024 * 1024 }, // notices may include larger event photos
  fileFilter
});

module.exports = { uploadProfilePhoto, uploadRoomPhoto, uploadAdminPhoto, uploadNoticePhoto };
