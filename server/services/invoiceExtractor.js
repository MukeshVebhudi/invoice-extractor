const { PDFParse } = require('pdf-parse');
const { Parser } = require('json2csv');
const { preprocessText } = require('./textProcessingService');
const CURRENCY_TOKENS = '(?:USD|EUR|GBP|INR|CAD|AUD|JPY|CHF|AED|SGD|[$€£₹])';

async function extractInvoiceDataFromBuffer(buffer) {
  const text = await readPdfText(buffer);
  return extractInvoiceDataFromText(text);
}

async function readPdfText(buffer) {
  const parser = new PDFParse({ data: buffer });

  try {
    const result = await parser.getText();
    return result?.text || '';
  } finally {
    await parser.destroy();
  }
}

function createCsvFromInvoices(invoices) {
  const parser = new Parser({
    fields: [
      { label: 'file_name', value: 'fileName', default: '' },
      { label: 'input_type', value: 'inputType', default: '' },
      { label: 'invoice_number', value: 'invoiceNumber', default: '' },
      { label: 'date', value: 'date', default: '' },
      { label: 'due_date', value: 'dueDate', default: '' },
      { label: 'amount', value: 'amount', default: '' },
      { label: 'subtotal', value: 'subtotal', default: '' },
      { label: 'tax', value: 'tax', default: '' },
      { label: 'currency', value: 'currency', default: '' },
      { label: 'vendor', value: 'vendor', default: '' },
      { label: 'customer_name', value: 'customerName', default: '' },
      { label: 'confidence', value: 'confidence', default: '' },
      { label: 'needs_review', value: 'needsReview', default: '' },
      { label: 'text_readable', value: 'textReadable', default: '' },
      { label: 'extraction_source', value: 'extractionSource', default: '' },
      { label: 'status', value: 'status', default: '' },
      { label: 'issues', value: (row) => (row.issues || []).join(' | '), default: '' },
    ],
  });

  return parser.parse(invoices);
}

function extractInvoiceDataFromText(text) {
  const processedText = preprocessText(text);
  const { normalizedText, lines } = processedText;
  const fallback = extractUsingFallbackRules(lines);
  const invoiceMatch = extractInvoiceNumber(normalizedText);
  const fallbackInvoice = fallback.invoiceNumber;
  const invoiceNumber = invoiceMatch.value || fallbackInvoice;
  const dateMatch = extractDate(normalizedText, ['date', 'invoice date']);
  const fallbackDate = fallback.date;
  const date = dateMatch.value || fallbackDate;
  const dueDateMatch = extractDate(normalizedText, ['due date', 'payment due', 'pay by'], {
    allowUnlabeled: false,
  });
  const fallbackDueDate = fallback.dueDate;
  const dueDate = dueDateMatch.value || fallbackDueDate;
  const amountMatch = extractAmount(normalizedText);
  const fallbackAmount = fallback.amount;
  const amount = amountMatch.value || fallbackAmount;
  const subtotalMatch = extractSubtotal(normalizedText);
  const fallbackSubtotal = fallback.subtotal;
  const subtotal = subtotalMatch.value || fallbackSubtotal;
  const taxMatch = extractTax(normalizedText);
  const fallbackTax = fallback.tax;
  const tax = taxMatch.value || fallbackTax;
  const currency = extractCurrency(normalizedText, [amount, subtotal, tax]);
  const vendor = extractVendor(lines, normalizedText) || fallback.vendor;
  const customerName = extractCustomerName(lines, normalizedText) || fallback.customerName;
  const issues = [];

  if (!invoiceNumber) issues.push('Invoice number not found.');
  if (!date) issues.push('Invoice date not found.');
  if (!amount) issues.push('Invoice amount not found.');

  return {
    invoiceNumber,
    date,
    dueDate,
    amount,
    subtotal,
    tax,
    currency,
    vendor,
    customerName,
    rawText: normalizedText,
    issues,
    extractionMeta: {
      invoiceNumberSource: invoiceMatch.value ? 'regex' : fallbackInvoice ? 'fallback' : 'missing',
      dateSource: dateMatch.value ? 'regex' : fallbackDate ? 'fallback' : 'missing',
      dueDateSource: dueDateMatch.value ? 'regex' : fallbackDueDate ? 'fallback' : 'missing',
      amountSource: amountMatch.value ? 'regex' : fallbackAmount ? 'fallback' : 'missing',
      subtotalSource: subtotalMatch.value ? 'regex' : fallbackSubtotal ? 'fallback' : 'missing',
      taxSource: taxMatch.value ? 'regex' : fallbackTax ? 'fallback' : 'missing',
      currencySource: currency ? 'derived' : 'missing',
      processedText,
    },
  };
}

function extractInvoiceNumber(text) {
  const patterns = [
    /\binvoice\s*(?:#|no\.?|number)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-\/]*)/i,
    /\binv\s*(?:#|no\.?|number)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-\/]*)/i,
    /(?:i\s*n\s*v\s*o\s*i\s*c\s*e)\s*#\s*([A-Z0-9][A-Z0-9-\/]*)/i,
    /\b(?:invoice\s*id|invoice\s*ref(?:erence)?)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-\/]*)/i,
    /\b(?:reference|ref(?:erence)?)\s*[:#-]?\s*(inv[-\/]?[a-z0-9-]+)/i,
    /\b(?:document\s*(?:#|no\.?|number)?)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-\/]*)/i,
  ];

  return {
    value: sanitizeInvoiceNumber(firstMatch(text, patterns)),
    confidence: 92,
  };
}

function extractDate(text, labels = ['date', 'invoice date'], options = {}) {
  const joinedLabels = labels.map((label) => label.replace(/\s+/g, '\\s*')).join('|');
  const patterns = [
    new RegExp(`\\b(?:${joinedLabels})\\s*[:#-]?\\s*([0-1]?\\d\\/[0-3]?\\d\\/(?:\\d{2}|\\d{4}))\\b`, 'i'),
    new RegExp(`\\b(?:${joinedLabels})\\s*[:#-]?\\s*([0-3]?\\d-[0-1]?\\d-(?:\\d{2}|\\d{4}))\\b`, 'i'),
    new RegExp(`\\b(?:${joinedLabels})\\s*[:#-]?\\s*((?:19|20)\\d{2}-[0-1]?\\d-[0-3]?\\d)\\b`, 'i'),
    new RegExp(`\\b(?:${joinedLabels})\\s*[:#-]?\\s*([A-Za-z]{3,9}\\s+\\d{1,2},?\\s+\\d{4})\\b`, 'i'),
  ];

  if (options.allowUnlabeled !== false) {
    patterns.push(
      /\b([0-3]?\d\/[0-1]?\d\/(?:\d{2}|\d{4}))\b/,
      /\b((?:19|20)\d{2}-[0-1]?\d-[0-3]?\d)\b/,
      /\b([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})\b/,
    );
  }

  const date = firstMatch(text, patterns);
  return {
    value: normalizeDate(date),
    confidence: date ? 90 : 0,
  };
}

function extractAmount(text) {
  const patterns = [
    new RegExp(`\\b(?:total\\s*amount|invoice\\s*amount|invoice\\s*total|grand\\s*total|total\\s*due|amount\\s*due|balance\\s*due|total|price\\s*net)\\s*[:#-]?\\s*((?:${CURRENCY_TOKENS}\\s*)?\\d[\\d.,]*(?:[.,]\\d{1,2})?(?:\\s*${CURRENCY_TOKENS})?)(?=\\s|$)`, 'gi'),
    new RegExp(`\\b(?:total\\s*payable|amount\\s*payable|payment\\s*due|plus\\s+\\d+%\\s*vat)\\s*[:#-]?\\s*((?:${CURRENCY_TOKENS}\\s*)?\\d[\\d.,]*(?:[.,]\\d{1,2})?(?:\\s*${CURRENCY_TOKENS})?)(?=\\s|$)`, 'gi'),
  ];

  for (const pattern of patterns) {
    const match = findLastMatch(text, pattern);
    if (match) {
      return {
        value: normalizeAmount(match),
        confidence: 92,
      };
    }
  }

  return {
    value: '',
    confidence: 0,
  };
}

function extractSubtotal(text) {
  return extractLabeledAmount(text, [
    'subtotal',
    'sub total',
    'net amount',
    'amount before tax',
  ]);
}

function extractTax(text) {
  return extractLabeledAmount(text, [
    'tax',
    'vat',
    'gst',
    'sales tax',
  ]);
}

function extractLabeledAmount(text, labels) {
  const joinedLabels = labels.map((label) => label.replace(/\s+/g, '\\s*')).join('|');
  const pattern = new RegExp(`\\b(?:${joinedLabels})\\s*[:#-]?\\s*((?:${CURRENCY_TOKENS}\\s*)?\\d[\\d.,]*(?:[.,]\\d{1,2})?(?:\\s*${CURRENCY_TOKENS})?)(?=\\s|$)`, 'gi');
  const match = findLastMatch(text, pattern);

  return {
    value: match ? normalizeAmount(match) : '',
    confidence: match ? 88 : 0,
  };
}

function extractVendor(lines, text = '') {
  const labeledMatch = text.match(/\b(?:vendor|supplier|from)\s*[:#-]\s*([^\n]+)/i);
  if (labeledMatch?.[1]) {
    const labeledVendor = stripFieldLabel(labeledMatch[1]).trim();
    if (labeledVendor) {
      return labeledVendor;
    }
  }

  const blacklist =
    /invoice|^bill$|bill\s*to|ship\s*to|sold\s*to|total|amount|due|balance|date|page\s+\d+|subtotal|tax|vat|gst|qty|quantity|description|unit\s*price|payment|terms|remit|sample|do not pay|warning|generated by/i;

  for (const line of lines.slice(0, 12)) {
    const cleaned = stripFieldLabel(line);
    if (cleaned.length < 3) continue;
    if (line.length < 3) continue;
    if (blacklist.test(line)) continue;
    if (/@|www\.|https?:\/\//i.test(line)) continue;
    if ((line.match(/\d/g) || []).length >= 5) continue;
    if ((line.match(/[A-Za-z]/g) || []).length < 3) continue;
    return cleaned;
  }

  return '';
}

function extractCustomerName(lines, text = '') {
  const labeledMatch = text.match(/\b(?:customer|client|bill\s*to)\s*[:#-]\s*([^\n]+)/i);
  if (labeledMatch?.[1]) {
    return labeledMatch[1].trim();
  }

  for (let index = 0; index < lines.length - 1; index += 1) {
    if (/\b(?:customer|client|bill\s*to)\b/i.test(lines[index])) {
      const nextLine = lines[index + 1]?.trim() || '';
      if (nextLine && !/\b(?:date|invoice|amount|total)\b/i.test(nextLine)) {
        return nextLine;
      }
    }
  }

  return '';
}

function extractUsingFallbackRules(lines) {
  const result = {
    invoiceNumber: '',
    date: '',
    dueDate: '',
    amount: '',
    subtotal: '',
    tax: '',
    vendor: '',
    customerName: '',
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const nextLine = lines[index + 1] || '';

    if (!result.invoiceNumber) {
      result.invoiceNumber = extractLabeledValue(line, nextLine, [
        'invoice number',
        'invoice no',
        'invoice #',
        'i n v o i c e',
        'reference',
        'invoice id',
      ]);
    }

    if (!result.date) {
      const rawDate = extractLabeledValue(line, nextLine, [
        'date',
        'invoice date',
        'issued',
        'issue date',
      ]);
      result.date = normalizeDate(rawDate);
    }

    if (!result.dueDate) {
      const rawDueDate = extractLabeledValue(line, nextLine, [
        'due date',
        'payment due',
        'pay by',
      ]);
      result.dueDate = normalizeDate(rawDueDate);
    }

    if (!result.amount) {
      const rawAmount = extractLabeledValue(line, nextLine, [
        'total amount',
        'total',
        'total due',
        'amount due',
        'balance due',
        'grand total',
        'total payable',
      ]);
      result.amount = normalizeAmount(rawAmount);
    }

    if (!result.subtotal) {
      const rawSubtotal = extractLabeledValue(line, nextLine, [
        'subtotal',
        'sub total',
        'net amount',
      ]);
      result.subtotal = normalizeAmount(rawSubtotal);
    }

    if (!result.tax) {
      const rawTax = extractLabeledValue(line, nextLine, [
        'tax',
        'vat',
        'gst',
        'sales tax',
      ]);
      result.tax = normalizeAmount(rawTax);
    }

    if (!result.customerName) {
      result.customerName = extractLabeledValue(line, nextLine, [
        'customer',
        'client',
        'bill to',
      ]);
    }
  }

  if (!result.vendor) {
    result.vendor = stripFieldLabel(lines[0] || '');
  }

  result.invoiceNumber = sanitizeInvoiceNumber(result.invoiceNumber);
  result.vendor = stripFieldLabel(result.vendor);
  result.customerName = String(result.customerName || '').trim();

  return result;
}

function extractLabeledValue(line, nextLine, labels) {
  const lower = line.toLowerCase();

  for (const label of labels) {
    if (!lower.includes(label)) continue;

    const sameLine = line.split(/[:#-]/).slice(1).join(' ').trim();
    if (sameLine) return sameLine;

    if (nextLine) return nextLine.trim();
  }

  return '';
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

  const trimmed = String(value).trim();
  const currencyMatch = trimmed.match(/\b(?:USD|EUR|GBP|INR|CAD|AUD|JPY|CHF|AED|SGD)\b|[$€£₹]/i);
  const currency = currencyMatch ? currencyMatch[0].toUpperCase() : '';
  let normalizedNumber = trimmed.replace(/\b(?:USD|EUR|GBP|INR|CAD|AUD|JPY|CHF|AED|SGD)\b/gi, '').replace(/[$€£₹\s]/g, '');

  const hasComma = normalizedNumber.includes(',');
  const hasDot = normalizedNumber.includes('.');

  if (hasComma && hasDot) {
    const lastComma = normalizedNumber.lastIndexOf(',');
    const lastDot = normalizedNumber.lastIndexOf('.');

    if (lastComma > lastDot) {
      normalizedNumber = normalizedNumber.replace(/\./g, '').replace(',', '.');
    } else {
      normalizedNumber = normalizedNumber.replace(/,/g, '');
    }
  } else if (hasComma) {
    const parts = normalizedNumber.split(',');
    if (parts.length === 2 && parts[1].length <= 2) {
      normalizedNumber = `${parts[0].replace(/,/g, '')}.${parts[1]}`;
    } else {
      normalizedNumber = normalizedNumber.replace(/,/g, '');
    }
  } else {
    normalizedNumber = normalizedNumber.replace(/,/g, '');
  }

  if (!normalizedNumber) return '';

  const normalizedValue = Number(normalizedNumber).toFixed(2);
  return `${currency}${normalizedValue}`.trim();
}

function extractCurrency(text, amountValues = []) {
  for (const value of amountValues) {
    const fromValue = String(value || '').match(/\b(?:USD|EUR|GBP|INR|CAD|AUD|JPY|CHF|AED|SGD)\b|[$€£₹]/i);
    if (fromValue?.[0]) {
      return fromValue[0].toUpperCase();
    }
  }

  const match = text.match(/\b(?:USD|EUR|GBP|INR|CAD|AUD|JPY|CHF|AED|SGD)\b|[$€£₹]/i);
  return match?.[0] ? match[0].toUpperCase() : '';
}

function sanitizeInvoiceNumber(value) {
  const cleaned = String(value || '').trim();
  if (!cleaned) return '';
  if (/^invoice$/i.test(cleaned)) return '';
  if (/^the$/i.test(cleaned)) return '';
  if (/^(is|it|to|at|on|of|for|by)$/i.test(cleaned)) return '';
  if (!/[0-9]/.test(cleaned) && cleaned.length < 4) return '';
  return cleaned;
}

function stripFieldLabel(value) {
  return String(value || '')
    .replace(/^(?:vendor|from|supplier)\s*[:#-]\s*/i, '')
    .trim();
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
  readPdfText,
  createCsvFromInvoices,
  extractInvoiceDataFromText,
  normalizeAmount,
  normalizeDate,
  sanitizeInvoiceNumber,
  extractCurrency,
};
