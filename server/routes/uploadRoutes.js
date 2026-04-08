const express = require('express');

const upload = require('../middleware/uploadMiddleware');
const { createCsvFromInvoices } = require('../services/invoiceExtractor');
const { createWorkbookBuffer } = require('../services/exportService');
const { processInvoiceBuffer, processTextDocument } = require('../services/extractionPipeline');

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
          const extracted = file.originalname.toLowerCase().endsWith('.txt')
            ? processTextDocument(file.buffer.toString('utf8'), { inputType: 'txt' })
            : await processInvoiceBuffer(file.buffer);
          const row = {
            fileName: file.originalname,
            inputType: extracted.inputType,
            invoiceNumber: extracted.invoiceNumber,
            date: extracted.date,
            dueDate: extracted.dueDate,
            amount: extracted.amount,
            subtotal: extracted.subtotal,
            tax: extracted.tax,
            currency: extracted.currency,
            vendor: extracted.vendor,
            customerName: extracted.customerName,
            confidence: extracted.confidence,
            fieldConfidence: extracted.fieldConfidence,
            textReadable: extracted.textReadable,
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
            inputType: inferInputType(file.originalname),
            invoiceNumber: '',
            date: '',
            dueDate: '',
            amount: '',
            subtotal: '',
            tax: '',
            currency: '',
            vendor: '',
            customerName: '',
            confidence: 0,
            fieldConfidence: emptyFieldConfidence(),
            textReadable: false,
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

router.post('/parse-text', (req, res, next) => {
  try {
    const rawText = String(req.body?.text || '');
    const fileName = String(req.body?.fileName || 'pasted-text.txt').trim() || 'pasted-text.txt';

    if (!rawText.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Please paste some invoice text before running extraction.',
      });
    }

    const extracted = processTextDocument(rawText, { inputType: 'pasted_text' });
    const row = {
      fileName,
      inputType: extracted.inputType,
      invoiceNumber: extracted.invoiceNumber,
      date: extracted.date,
      dueDate: extracted.dueDate,
      amount: extracted.amount,
      subtotal: extracted.subtotal,
      tax: extracted.tax,
      currency: extracted.currency,
      vendor: extracted.vendor,
      customerName: extracted.customerName,
      confidence: extracted.confidence,
      fieldConfidence: extracted.fieldConfidence,
      textReadable: extracted.textReadable,
      extractionSource: extracted.extractionSource,
      status: extracted.needsReview ? 'needs_review' : 'ok',
      needsReview: extracted.needsReview,
      issues: extracted.issues,
    };

    const csv = createCsvFromInvoices([row]);

    return res.json({
      success: true,
      count: 1,
      parsedCount: row.status === 'error' ? 0 : 1,
      partialCount: row.status === 'needs_review' ? 1 : 0,
      errorCount: row.status === 'error' ? 1 : 0,
      message: row.textReadable
        ? 'Processed pasted invoice text.'
        : 'Pasted text does not look like a readable invoice yet.',
      data: [row],
      csv,
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/export/xlsx', async (req, res, next) => {
  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];

    if (!rows.length) {
      return res.status(400).json({
        success: false,
        error: 'Please provide at least one extracted invoice row.',
      });
    }

    const workbook = await createWorkbookBuffer(
      rows.map((row) => ({
        fileName: row.fileName || '',
        inputType: row.inputType || '',
        invoiceNumber: row.invoiceNumber || '',
        date: row.date || '',
        dueDate: row.dueDate || '',
        amount: row.amount || '',
        subtotal: row.subtotal || '',
        tax: row.tax || '',
        currency: row.currency || '',
        vendor: row.vendor || '',
        customerName: row.customerName || '',
        confidence: row.confidence ?? '',
        needsReview: row.needsReview ?? '',
        textReadable: row.textReadable ?? '',
        extractionSource: row.extractionSource || '',
        status: row.status || '',
        issues: Array.isArray(row.issues) ? row.issues.join(' | ') : row.issues || '',
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

function inferInputType(fileName) {
  return String(fileName || '').toLowerCase().endsWith('.txt') ? 'txt' : 'pdf';
}

function emptyFieldConfidence() {
  return {
    invoiceNumberConfidence: 0,
    dateConfidence: 0,
    amountConfidence: 0,
    vendorConfidence: 0,
  };
}

module.exports = router;
