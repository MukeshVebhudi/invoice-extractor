const multer = require('multer');

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    const normalizedName = file.originalname.toLowerCase();
    const isSupportedTextDocument =
      file.mimetype === 'application/pdf' ||
      file.mimetype === 'text/plain' ||
      normalizedName.endsWith('.pdf') ||
      normalizedName.endsWith('.txt');

    if (!isSupportedTextDocument) {
      const error = new Error('Only text-based PDF and TXT files are allowed.');
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
