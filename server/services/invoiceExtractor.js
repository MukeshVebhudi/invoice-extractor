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
    fields: [
      { label: 'file_name', value: 'fileName', default: '' },
      { label: 'invoice_number', value: 'invoiceNumber', default: '' },
      { label: 'date', value: 'date', default: '' },
      { label: 'amount', value: 'amount', default: '' },
      { label: 'vendor', value: 'vendor', default: '' },
      { label: 'status', value: 'status', default: '' },
    ],
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
    /\binvoice\s*(?:#|no\.?|number)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-\/]*)/i,
    /\binv\s*(?:#|no\.?|number)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-\/]*)/i,
    /\b(?:invoice\s*id|invoice\s*ref(?:erence)?)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-\/]*)/i,
    /\b(?:reference|ref(?:erence)?)\s*[:#-]?\s*(inv[-\/]?[a-z0-9-]+)/i,
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
    /\b([0-3]?\d\/[0-1]?\d\/(?:\d{2}|\d{4}))\b/,
    /\b((?:19|20)\d{2}-[0-1]?\d-[0-3]?\d)\b/,
    /\b([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})\b/,
  ];

  const date = firstMatch(text, patterns);
  return normalizeDate(date);
}

function extractAmount(text) {
  const patterns = [
    /\b(?:amount\s*due|total\s*due|grand\s*total|total|balance\s*due|invoice\s*total)\s*[:#-]?\s*(?:USD\s*)?([$€£]?\s?\d[\d,]*(?:\.\d{1,2})?)\b/gi,
    /\b(?:total\s*payable|amount\s*payable|payment\s*due)\s*[:#-]?\s*(?:USD\s*)?([$€£]?\s?\d[\d,]*(?:\.\d{1,2})?)\b/gi,
    /\b([$€£]\s?\d[\d,]*(?:\.\d{1,2})?)\b/g,
  ];

  for (const pattern of patterns) {
    const match = findLastMatch(text, pattern);
    if (match) {
      return normalizeAmount(match);
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
    .replace(/[–—]/g, '-')
    .trim();
}

function normalizeDate(value) {
  if (!value) return '';

  const trimmed = value.replace(/,/g, '').trim();
  const monthNames = {
    jan: '01',
    feb: '02',
    mar: '03',
    apr: '04',
    may: '05',
    jun: '06',
    jul: '07',
    aug: '08',
    sep: '09',
    oct: '10',
    nov: '11',
    dec: '12',
  };

  const namedMatch = trimmed.match(/^([A-Za-z]{3,9})\s+(\d{1,2})\s+(\d{4})$/);
  if (namedMatch) {
    const month = monthNames[namedMatch[1].slice(0, 3).toLowerCase()];
    if (month) {
      return `${namedMatch[3]}-${month}-${pad2(namedMatch[2])}`;
    }
  }

  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    return `${isoMatch[1]}-${pad2(isoMatch[2])}-${pad2(isoMatch[3])}`;
  }

  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (slashMatch) {
    const year = normalizeYear(slashMatch[3]);
    return `${year}-${pad2(slashMatch[1])}-${pad2(slashMatch[2])}`;
  }

  const dashMatch = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{2}|\d{4})$/);
  if (dashMatch) {
    const year = normalizeYear(dashMatch[3]);
    const day = Number(dashMatch[1]);
    const month = Number(dashMatch[2]);
    return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  return trimmed;
}

function normalizeAmount(value) {
  if (!value) return '';

  const currencyMatch = value.match(/[$€£]/);
  const currency = currencyMatch ? currencyMatch[0] : '';
  const normalizedNumber = value.replace(/[$€£,\s]/g, '');

  if (!normalizedNumber) return '';

  return `${currency}${Number(normalizedNumber).toFixed(2)}`.trim();
}

function normalizeYear(year) {
  if (year.length === 4) return year;
  return Number(year) >= 70 ? `19${year}` : `20${year}`;
}

function pad2(value) {
  return String(value).padStart(2, '0');
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
  normalizeAmount,
  normalizeDate,
};
