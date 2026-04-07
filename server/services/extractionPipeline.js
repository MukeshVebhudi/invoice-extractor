const {
  readPdfText,
  extractInvoiceDataFromText,
  normalizeAmount,
  normalizeDate,
} = require('./invoiceExtractor');
const { extractInvoiceWithAI, isAIConfigured } = require('./aiExtractorService');
const { extractTextWithOCR, isOCRConfigured } = require('./ocrService');

async function processInvoiceBuffer(buffer, fileName) {
  const pdfText = await readPdfText(buffer);
  let bestText = pdfText;
  let extraction = extractInvoiceDataFromText(pdfText);
  let source = 'regex';
  let usedOCR = false;
  let usedAI = false;

  if (shouldTryOCR(pdfText, extraction) && isOCRConfigured()) {
    try {
      const ocrText = await extractTextWithOCR(buffer, fileName);
      if (ocrText) {
        const ocrExtraction = extractInvoiceDataFromText(ocrText);
        if (scoreExtraction(ocrExtraction) >= scoreExtraction(extraction)) {
          bestText = ocrText;
          extraction = ocrExtraction;
          source = 'ocr';
          usedOCR = true;
        }
      }
    } catch (error) {
      extraction.issues.push(`OCR fallback unavailable: ${error.message}`);
    }
  }

  if (shouldTryAI(extraction) && isAIConfigured()) {
    try {
      const aiResult = await extractInvoiceWithAI(bestText, extraction);
      if (aiResult) {
        extraction = mergeAIResult(extraction, aiResult);
        source = usedOCR ? 'ocr+ai' : 'regex+ai';
        usedAI = true;
      }
    } catch (error) {
      extraction.issues.push(`AI fallback unavailable: ${error.message}`);
    }
  }

  const confidence = computeConfidence(extraction, { usedAI, usedOCR, textLength: bestText.length });
  const issues = [...extraction.issues];

  if (confidence < 80) {
    issues.push('Low-confidence extraction. Needs review.');
  }

  return {
    invoiceNumber: extraction.invoiceNumber,
    date: extraction.date,
    amount: extraction.amount,
    vendor: extraction.vendor,
    rawText: bestText,
    confidence,
    needsReview: confidence < 80 || issues.length > 0,
    extractionSource: source,
    issues: unique(issues),
  };
}

function shouldTryOCR(text, extraction) {
  return text.length < 40 || !extraction.invoiceNumber || !extraction.amount;
}

function shouldTryAI(extraction) {
  return !extraction.invoiceNumber || !extraction.date || !extraction.amount;
}

function mergeAIResult(current, aiResult) {
  return {
    ...current,
    invoiceNumber: current.invoiceNumber || String(aiResult.invoiceNumber || '').trim(),
    date: current.date || normalizeDate(aiResult.date || ''),
    amount: current.amount || normalizeAmount(aiResult.amount || ''),
    issues: [
      ...current.issues,
      'AI-assisted extraction used for missing values.',
    ],
  };
}

function computeConfidence(extraction, meta) {
  let score = 20;

  if (extraction.invoiceNumber) score += 25;
  if (extraction.date) score += 25;
  if (extraction.amount) score += 25;
  if (extraction.vendor) score += 5;
  if (meta.textLength > 80) score += 10;
  if (meta.usedOCR) score -= 5;
  if (meta.usedAI) score -= 10;
  if (extraction.issues.length > 0) score -= Math.min(15, extraction.issues.length * 4);

  return Math.max(0, Math.min(99, score));
}

function scoreExtraction(extraction) {
  return Number(Boolean(extraction.invoiceNumber))
    + Number(Boolean(extraction.date))
    + Number(Boolean(extraction.amount))
    + Number(Boolean(extraction.vendor));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

module.exports = {
  processInvoiceBuffer,
};
