const multer = require('multer');

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    const isPdf =
      file.mimetype === 'application/pdf' ||
      file.originalname.toLowerCase().endsWith('.pdf');

    if (!isPdf) {
      const error = new Error('Only PDF files are allowed.');
      error.statusCode = 400;
      return cb(error);
    }

    cb(null, true);
  },
  limits: {
    files: 25,
    fileSize: 15 * 1024 * 1024,
  },
});

module.exports = upload;
