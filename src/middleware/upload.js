const multer = require('multer');

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_BYTES = (parseInt(process.env.UPLOAD_MAX_IMAGE_MB, 10) || 10) * 1024 * 1024;
const MAX_FILES = parseInt(process.env.UPLOAD_MAX_FILES, 10) || 10;

function imageFilter(_req, file, cb) {
  const ok = IMAGE_TYPES.includes(file.mimetype);
  cb(ok ? null : new Error('Only JPEG, PNG, WebP, and GIF images are allowed'), ok);
}

function handleMulterError(err, res, next) {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') {
    const mb = MAX_BYTES / (1024 * 1024);
    return res.status(400).json({ error: `Image must be ${mb} MB or smaller. Try compressing the file or use a smaller image.` });
  }
  if (err.code === 'LIMIT_FILE_COUNT') {
    return res.status(400).json({ error: `You can upload up to ${MAX_FILES} images at a time.` });
  }
  return res.status(400).json({ error: err.message });
}

const imageMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter: imageFilter,
});

function uploadProfileImage(req, res, next) {
  imageMulter.single('image')(req, res, (err) => handleMulterError(err, res, next));
}

function uploadEntityImage(req, res, next) {
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES, files: MAX_FILES },
    fileFilter: imageFilter,
  }).array('image', MAX_FILES)(req, res, (err) => handleMulterError(err, res, next));
}

const MAX_CSV_BYTES = (parseInt(process.env.UPLOAD_MAX_CSV_MB, 10) || 2) * 1024 * 1024;

function csvFilter(_req, file, cb) {
  const name = (file.originalname || '').toLowerCase();
  const ok = file.mimetype === 'text/csv'
    || file.mimetype === 'application/vnd.ms-excel'
    || file.mimetype === 'text/plain'
    || name.endsWith('.csv');
  cb(ok ? null : new Error('Only CSV files are allowed'), ok);
}

function handleCsvMulterError(err, res, next) {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') {
    const mb = MAX_CSV_BYTES / (1024 * 1024);
    return res.status(400).json({ error: `CSV must be ${mb} MB or smaller.` });
  }
  return res.status(400).json({ error: err.message });
}

const csvMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CSV_BYTES },
  fileFilter: csvFilter,
});

function uploadEmployeeCsv(req, res, next) {
  csvMulter.single('csv')(req, res, (err) => handleCsvMulterError(err, res, next));
}

function uploadVisitorPhoto(req, res, next) {
  imageMulter.single('picture')(req, res, (err) => handleMulterError(err, res, next));
}

module.exports = {
  uploadProfileImage,
  uploadEntityImage,
  uploadEmployeeCsv,
  uploadVisitorPhoto,
  MAX_IMAGE_BYTES: MAX_BYTES,
  MAX_IMAGE_FILES: MAX_FILES,
  MAX_CSV_BYTES,
};
