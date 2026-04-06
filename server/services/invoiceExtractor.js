const { PDFParse } = require('pdf-parse');
const { Parser } = require('json2csv');

async function extractInvoiceDataFromBuffer(buffer) {
  const parser = new PDFParse({ data: buffer });

  try {
    const result = await parser.getText();
    return extractInvoiceDataFromText(result?.text || '');
  } finally {
    await parser.destroy();
  }
}

function createCsvFromInvoices(invoices) {
  const parser = new Parser({
    fields: ['fileName', 'invoiceNumber', 'date', 'amount'],
  });

  return parser.parse(invoices);
}

function extractInvoiceDataFromText(text) {
  const normalizedText = normalizeText(text);
  const lines = normalizedText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    invoiceNumber: extractInvoiceNumber(normalizedText),
    date: extractDate(normalizedText),
    amount: extractAmount(normalizedText),
    vendor: extractVendor(lines),
    rawText: normalizedText,
  };
}

function extractInvoiceNumber(text) {
  const patterns = [
    /\b(?:invoice\s*(?:#|no\.?|number)?|inv\s*(?:#|no\.?|number)?)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-\/]*)/i,
    /\b(?:invoice)\s+([A-Z0-9][A-Z0-9-\/]{2,})\b/i,
  ];

  return firstMatch(text, patterns);
}

function extractDate(text) {
  const patterns = [
    /\b(?:date|invoice\s*date)\s*[:#-]?\s*([0-1]?\d\/[0-3]?\d\/(?:\d{2}|\d{4}))\b/i,
    /\b(?:date|invoice\s*date)\s*[:#-]?\s*([0-3]?\d-[0-1]?\d-(?:\d{2}|\d{4}))\b/i,
    /\b(?:date|invoice\s*date)\s*[:#-]?\s*((?:19|20)\d{2}-[0-1]?\d-[0-3]?\d)\b/i,
    /\b(?:date|invoice\s*date)\s*[:#-]?\s*([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})\b/i,
  ];

  return firstMatch(text, patterns);
}

function extractAmount(text) {
  const patterns = [
    /\b(?:amount\s*due|total\s*due|grand\s*total|total|balance\s*due|invoice\s*total)\s*[:#-]?\s*(?:USD\s*)?([$€£]?\s?\d[\d,]*\.\d{2})\b/gi,
    /\b([$€£]\s?\d[\d,]*\.\d{2})\b/g,
  ];

  for (const pattern of patterns) {
    const match = findLastMatch(text, pattern);
    if (match) {
      return match.replace(/\s+/g, '');
    }
  }

  return '';
}

function extractVendor(lines) {
  const blacklist =
    /invoice|bill\s*to|ship\s*to|sold\s*to|total|amount|due|balance|date|page\s+\d+|subtotal|tax|vat|gst|qty|quantity|description|unit\s*price|payment|terms|remit/i;

  for (const line of lines.slice(0, 12)) {
    if (line.length < 3) continue;
    if (blacklist.test(line)) continue;
    if (/@|www\.|https?:\/\//i.test(line)) continue;
    if ((line.match(/\d/g) || []).length >= 5) continue;
    if ((line.match(/[A-Za-z]/g) || []).length < 3) continue;
    return line;
  }

  return '';
}

function normalizeText(text) {
  return String(text)
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return '';
}

function findLastMatch(text, pattern) {
  let last = '';
  pattern.lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    if (match[1]) {
      last = match[1].trim();
    }
  }

  return last;
}

module.exports = {
  extractInvoiceDataFromBuffer,
  createCsvFromInvoices,
  extractInvoiceDataFromText,
};
