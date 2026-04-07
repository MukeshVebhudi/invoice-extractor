const express = require('express');

const upload = require('../middleware/uploadMiddleware');
const { createCsvFromInvoices } = require('../services/invoiceExtractor');
const { createWorkbookBuffer } = require('../services/exportService');
const { processInvoiceBuffer } = require('../services/extractionPipeline');

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
          const extracted = await processInvoiceBuffer(file.buffer, file.originalname);
          const row = {
            fileName: file.originalname,
            invoiceNumber: extracted.invoiceNumber,
            date: extracted.date,
            amount: extracted.amount,
            vendor: extracted.vendor,
            confidence: extracted.confidence,
            extractionSource: extracted.extractionSource,
            status: extracted.needsReview ? 'needs_review' : 'ok',
            needsReview: extracted.needsReview,
            issues: extracted.issues,
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
            confidence: 0,
            extractionSource: 'error',
            status: 'error',
            needsReview: true,
            issues: ['Failed to parse PDF text.'],
            error: error.message || 'Failed to parse PDF text.',
          };
        }
      })
    );

    const csv = createCsvFromInvoices(extractedRows);
    const partialCount = extractedRows.filter((row) => row.status === 'needs_review').length;
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

router.post('/export/xlsx', (req, res, next) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];

    if (!rows.length) {
      return res.status(400).json({
        success: false,
        error: 'Please provide at least one extracted invoice row.',
      });
    }

    const workbook = createWorkbookBuffer(
      rows.map((row) => ({
        fileName: row.fileName || '',
        invoiceNumber: row.invoiceNumber || '',
        date: row.date || '',
        amount: row.amount || '',
        vendor: row.vendor || '',
        confidence: row.confidence ?? '',
        extractionSource: row.extractionSource || '',
        status: row.status || '',
      }))
    );

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', 'attachment; filename="invoices.xlsx"');

    return res.send(workbook);
  } catch (error) {
    return next(error);
  }
});

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
