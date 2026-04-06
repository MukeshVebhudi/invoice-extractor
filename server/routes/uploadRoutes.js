const express = require('express');

const upload = require('../middleware/uploadMiddleware');
const {
  extractInvoiceDataFromBuffer,
  createCsvFromInvoices,
} = require('../services/invoiceExtractor');

const router = express.Router();

router.post('/upload', upload.array('invoices', 25), async (req, res, next) => {
  const uploadedFiles = req.files || [];
  const includeRawText = req.query.includeRawText === 'true';

  if (uploadedFiles.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Please upload at least one PDF invoice.',
    });
  }

  try {
    const extractedRows = await Promise.all(
      uploadedFiles.map(async (file) => {
        try {
          const extracted = await extractInvoiceDataFromBuffer(file.buffer);
          const issues = buildIssues(extracted);
          const row = {
            fileName: file.originalname,
            invoiceNumber: extracted.invoiceNumber,
            date: extracted.date,
            amount: extracted.amount,
            vendor: extracted.vendor,
            status: issues.length > 0 ? 'partial' : 'ok',
            issues,
          };

          if (includeRawText) {
            row.rawText = extracted.rawText;
          }

          return row;
        } catch (error) {
          return {
            fileName: file.originalname,
            invoiceNumber: '',
            date: '',
            amount: '',
            vendor: '',
            status: 'error',
            issues: ['Failed to parse PDF text.'],
            error: error.message || 'Failed to parse PDF text.',
          };
        }
      })
    );

    const csv = createCsvFromInvoices(extractedRows);
    const partialCount = extractedRows.filter((row) => row.status === 'partial').length;
    const errorCount = extractedRows.filter((row) => row.status === 'error').length;
    const parsedCount = extractedRows.length - errorCount;

    return res.json({
      success: true,
      count: extractedRows.length,
      parsedCount,
      partialCount,
      errorCount,
      message: buildResponseMessage(extractedRows.length, partialCount, errorCount),
      data: extractedRows,
      csv,
    });
  } catch (error) {
    return next(error);
  }
});

function buildIssues(extracted) {
  const issues = [];

  if (!extracted.invoiceNumber) issues.push('Invoice number not found.');
  if (!extracted.date) issues.push('Invoice date not found.');
  if (!extracted.amount) issues.push('Invoice amount not found.');

  return issues;
}

function buildResponseMessage(total, partialCount, errorCount) {
  if (errorCount > 0) {
    return `Processed ${total} file(s). ${errorCount} failed and ${partialCount} need review.`;
  }

  if (partialCount > 0) {
    return `Processed ${total} file(s). ${partialCount} need review.`;
  }

  return `Processed ${total} file(s) successfully.`;
}

module.exports = router;
