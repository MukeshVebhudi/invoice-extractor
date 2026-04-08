const {
  readPdfText,
  extractInvoiceDataFromText,
} = require('./invoiceExtractor');
const {
  preprocessText,
  assessTextReadability,
} = require('./textProcessingService');

async function processInvoiceBuffer(buffer) {
  const initialText = await readPdfText(buffer);
  return processTextDocument(initialText, { inputType: 'pdf' });
}

function processTextDocument(rawText, options = {}) {
  const inputType = options.inputType || 'text';
  const processedText = preprocessText(rawText);
  const readability = assessTextReadability(processedText, inputType);

  if (!readability.readable) {
    return buildUnsupportedResult(processedText, readability.issues, inputType);
  }

  const extraction = extractInvoiceDataFromText(processedText.normalizedText);
  const confidence = computeConfidence(extraction, {
    textMetrics: processedText.metrics,
  });
  const issues = [...extraction.issues];

  if (confidence < 80) {
    issues.push('Low-confidence extraction. Needs review.');
  }

  return {
    invoiceNumber: extraction.invoiceNumber,
    date: extraction.date,
    dueDate: extraction.dueDate,
    amount: extraction.amount,
    subtotal: extraction.subtotal,
    tax: extraction.tax,
    currency: extraction.currency,
    vendor: extraction.vendor,
    customerName: extraction.customerName,
    rawText: processedText.normalizedText,
    confidence,
    needsReview: confidence < 80 || issues.length > 0,
    extractionSource: 'text',
    inputType,
    textReadable: true,
    fieldConfidence: computeFieldConfidence(extraction),
    issues: unique(issues),
  };
}

function computeConfidence(extraction, meta) {
  let score = 20;
  const textMetrics = meta.textMetrics || {};

  if (extraction.invoiceNumber) score += 25;
  if (extraction.date) score += 25;
  if (extraction.amount) score += 25;
  if (extraction.vendor) score += 5;
  if (extraction.dueDate) score += 2;
  if (extraction.subtotal) score += 2;
  if (extraction.tax) score += 2;
  if (extraction.currency) score += 2;
  if (extraction.customerName) score += 2;
  if ((textMetrics.length || 0) > 80) score += 8;
  if ((textMetrics.wordCount || 0) >= 18) score += 6;
  if ((textMetrics.lineCount || 0) < 3) score -= 10;
  if (extraction.issues.length > 0) score -= Math.min(15, extraction.issues.length * 4);
  if (usesFallbackOnly(extraction.extractionMeta?.invoiceNumberSource)) score -= 8;
  if (usesFallbackOnly(extraction.extractionMeta?.dateSource)) score -= 6;
  if (usesFallbackOnly(extraction.extractionMeta?.amountSource)) score -= 8;
  if (/^(invoice|document|the)$/i.test(extraction.invoiceNumber || '')) score -= 35;
  if (/^(?:1(?:\.00)?|0(?:\.00)?)$/.test(extraction.amount || '')) score -= 25;
  if (/^vendor[:#-]/i.test(extraction.vendor || '')) score -= 10;

  return Math.max(0, Math.min(99, score));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function usesFallbackOnly(source) {
  return source === 'fallback' || source === 'missing';
}

function buildUnsupportedResult(processedText, issues, inputType) {
  return {
    invoiceNumber: '',
    date: '',
    amount: '',
    vendor: '',
    customerName: '',
    dueDate: '',
    subtotal: '',
    tax: '',
    currency: '',
    rawText: processedText.normalizedText,
    confidence: 0,
    needsReview: true,
    extractionSource: 'unsupported',
    inputType,
    textReadable: false,
    fieldConfidence: {
      invoiceNumberConfidence: 0,
      dateConfidence: 0,
      amountConfidence: 0,
      vendorConfidence: 0,
    },
    issues: unique(issues),
  };
}

function computeFieldConfidence(extraction) {
  return {
    invoiceNumberConfidence: fieldConfidenceForSource(extraction.invoiceNumber, extraction.extractionMeta?.invoiceNumberSource),
    dateConfidence: fieldConfidenceForSource(extraction.date, extraction.extractionMeta?.dateSource),
    dueDateConfidence: fieldConfidenceForSource(extraction.dueDate, extraction.extractionMeta?.dueDateSource),
    amountConfidence: fieldConfidenceForSource(extraction.amount, extraction.extractionMeta?.amountSource),
    subtotalConfidence: fieldConfidenceForSource(extraction.subtotal, extraction.extractionMeta?.subtotalSource),
    taxConfidence: fieldConfidenceForSource(extraction.tax, extraction.extractionMeta?.taxSource),
    currencyConfidence: extraction.currency ? 78 : 0,
    vendorConfidence: extraction.vendor ? 82 : 25,
    customerNameConfidence: extraction.customerName ? 80 : 0,
  };
}

function fieldConfidenceForSource(value, source) {
  if (!value) return 0;
  if (source === 'regex') return 92;
  if (source === 'fallback') return 68;
  return 25;
}

module.exports = {
  processInvoiceBuffer,
  processTextDocument,
};
