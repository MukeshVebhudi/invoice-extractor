const multer = require('multer');

function errorHandler(err, _req, res, _next) {
  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'Each PDF must be 15 MB or smaller.'
        : err.code === 'LIMIT_FILE_COUNT'
          ? 'You can upload up to 25 PDF files at a time.'
          : err.message;

    return res.status(400).json({
      success: false,
      error: message,
    });
  }

  const statusCode = err.statusCode || 500;

  return res.status(statusCode).json({
    success: false,
    error: err.message || 'Unexpected server error.',
  });
}

module.exports = errorHandler;
