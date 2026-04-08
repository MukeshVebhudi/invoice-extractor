const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  extractInvoiceDataFromBuffer,
  extractInvoiceDataFromText,
  createCsvFromInvoices,
  normalizeAmount,
  normalizeDate,
  sanitizeInvoiceNumber,
} = require('../services/invoiceExtractor');
const { createWorkbookBuffer } = require('../services/exportService');
const { processInvoiceBuffer, processTextDocument } = require('../services/extractionPipeline');
const {
  preprocessText,
  assessTextReadability,
} = require('../services/textProcessingService');

test('extractInvoiceDataFromText parses common invoice fields', () => {
  const text = [
    'ACME Consulting LLC',
    'Invoice Number: INV-1001',
    'Date: 04/06/2026',
    'Total: $1,234.56',
  ].join('\n');

  const result = extractInvoiceDataFromText(text);

  assert.equal(result.vendor, 'ACME Consulting LLC');
  assert.equal(result.invoiceNumber, 'INV-1001');
  assert.equal(result.date, '2026-04-06');
  assert.equal(result.dueDate, '');
  assert.equal(result.amount, '$1234.56');
  assert.deepEqual(result.issues, []);
});

test('extractInvoiceDataFromText supports fallback patterns and normalization', () => {
  const text = [
    'Northwind Studio',
    'Reference: INV-9088',
    'Apr 6, 2026',
    'Amount Payable: USD 2200.5',
  ].join('\n');

  const result = extractInvoiceDataFromText(text);

  assert.equal(result.invoiceNumber, 'INV-9088');
  assert.equal(result.date, '2026-04-06');
  assert.equal(result.amount, 'USD2200.50');
});

test('fallback parsing supports next-line values', () => {
  const text = [
    'Contoso Ltd',
    'Invoice Number',
    'CT-204',
    'Invoice Date',
    '2026-04-08',
    'Amount Due',
    '$980.00',
  ].join('\n');

  const result = extractInvoiceDataFromText(text);

  assert.equal(result.invoiceNumber, 'CT-204');
  assert.equal(result.date, '2026-04-08');
  assert.equal(result.amount, '$980.00');
});

test('extractInvoiceDataFromBuffer parses the sample PDF', async () => {
  const fixture = path.join(process.cwd(), 'test-invoice.pdf');
  const result = await extractInvoiceDataFromBuffer(fs.readFileSync(fixture));

  assert.equal(result.invoiceNumber, 'INV-1001');
  assert.equal(result.date, '2026-04-06');
  assert.equal(result.amount, '1234.56');
});

test('createCsvFromInvoices outputs CSV headers and rows', () => {
  const csv = createCsvFromInvoices([
    {
      fileName: 'invoice.pdf',
      inputType: 'pdf',
      invoiceNumber: 'A-1',
      date: '2026-04-06',
      dueDate: '2026-05-06',
      amount: '$100.00',
      subtotal: '$90.00',
      tax: '$10.00',
      currency: '$',
      vendor: 'Acme',
      customerName: 'Northwind',
      confidence: 91,
      needsReview: false,
      textReadable: true,
      extractionSource: 'regex',
      status: 'ok',
      issues: [],
    },
  ]);

  assert.match(csv, /"file_name","input_type","invoice_number","date","due_date","amount","subtotal","tax","currency","vendor","customer_name","confidence","needs_review","text_readable","extraction_source","status","issues"/);
  assert.match(csv, /"invoice\.pdf","pdf","A-1","2026-04-06","2026-05-06","\$100\.00","\$90\.00","\$10\.00","\$","Acme","Northwind",91,false,true,"regex","ok",""/);
});

test('createWorkbookBuffer outputs an xlsx file buffer', async () => {
  const workbook = await createWorkbookBuffer([
    {
      fileName: 'invoice.pdf',
      inputType: 'pdf',
      invoiceNumber: 'A-1',
      date: '2026-04-06',
      dueDate: '2026-05-06',
      amount: '$100.00',
      subtotal: '$90.00',
      tax: '$10.00',
      currency: '$',
      vendor: 'Acme',
      customerName: 'Northwind',
      confidence: 91,
      needsReview: false,
      textReadable: true,
      extractionSource: 'regex',
      status: 'ok',
      issues: '',
    },
  ]);

  assert.equal(Buffer.isBuffer(workbook), true);
  assert.equal(workbook.subarray(0, 2).toString('utf8'), 'PK');
});

test('normalize helpers return consistent values', () => {
  assert.equal(normalizeDate('04/06/2026'), '2026-04-06');
  assert.equal(normalizeDate('06-04-2026'), '2026-04-06');
  assert.equal(normalizeAmount('$1,234.5'), '$1234.50');
  assert.equal(normalizeAmount('1,234.56'), '1234.56');
  assert.equal(normalizeAmount('90.937,98 €'), '€90937.98');
  assert.equal(normalizeAmount('13.069,40 €'), '€13069.40');
  assert.equal(normalizeAmount('£2,345.6'), '£2345.60');
  assert.equal(normalizeAmount('₹1,23,456.78'), '₹123456.78');
  assert.equal(normalizeAmount('USD 2200.5'), 'USD2200.50');
  assert.equal(normalizeAmount('INR 12,500'), 'INR12500.00');
});

test('processInvoiceBuffer returns confidence and review state', async () => {
  const result = await processInvoiceBuffer(fs.readFileSync(path.join(process.cwd(), 'test-invoice.pdf')));

  assert.equal(result.extractionSource, 'text');
  assert.equal(result.needsReview, false);
  assert.equal(result.textReadable, true);
  assert.ok(result.confidence >= 80);
});

test('preprocessText normalizes spaced labels and punctuation noise', () => {
  const processed = preprocessText('I N V O I C E   #  76326 \n Total Amount :  90.937,98 €');

  assert.match(processed.normalizedText, /INVOICE #76326/i);
  assert.match(processed.normalizedText, /TOTAL AMOUNT: 90.937,98€/i);
});

test('assessTextReadability flags weak PDF text as unsupported', () => {
  const processed = preprocessText('   ');
  const readability = assessTextReadability(processed, 'pdf');

  assert.equal(readability.readable, false);
  assert.match(readability.issues.join(' '), /No readable text found/i);
});

test('processTextDocument supports plain text invoice input', () => {
  const result = processTextDocument([
    'Northwind Studio',
    'Invoice Number: TXT-204',
    'Date: 04/08/2026',
    'Due Date: 04/30/2026',
    'Customer: Contoso Retail',
    'Subtotal: $900.00',
    'Tax: $80.00',
    'Total Amount: $980.00',
  ].join('\n'), { inputType: 'txt' });

  assert.equal(result.inputType, 'txt');
  assert.equal(result.textReadable, true);
  assert.equal(result.invoiceNumber, 'TXT-204');
  assert.equal(result.date, '2026-04-08');
  assert.equal(result.dueDate, '2026-04-30');
  assert.equal(result.subtotal, '$900.00');
  assert.equal(result.tax, '$80.00');
  assert.equal(result.currency, '$');
  assert.equal(result.customerName, 'Contoso Retail');
  assert.equal(result.amount, '$980.00');
});

test('processTextDocument marks unsupported text-poor pdf input clearly', () => {
  const result = processTextDocument('12 34', { inputType: 'pdf' });

  assert.equal(result.textReadable, false);
  assert.equal(result.extractionSource, 'unsupported');
  assert.match(result.issues.join(' '), /Likely scanned or image-only document/i);
});

test('extractInvoiceDataFromText supports european invoice totals', () => {
  const text = [
    'White, Torphy and Hettinger',
    'Invoice',
    '# 27857',
    'Date: 2023-09-29',
    'Invoice total 13.069,40 €',
  ].join('\n');

  const result = extractInvoiceDataFromText(text);

  assert.equal(result.invoiceNumber, '27857');
  assert.equal(result.date, '2023-09-29');
  assert.equal(result.amount, '€13069.40');
});

test('extractInvoiceDataFromText supports multiple currencies', () => {
  const text = [
    'Example Vendor',
    'Invoice Number: CUR-55',
    'Date: 2026-04-07',
    'Grand Total: ₹1,23,456.78',
  ].join('\n');

  const result = extractInvoiceDataFromText(text);

  assert.equal(result.invoiceNumber, 'CUR-55');
  assert.equal(result.amount, '₹123456.78');
});

test('extractInvoiceDataFromText handles standard invoice labels without picking table values', () => {
  const text = [
    'Invoice',
    'Invoice #: INV-1001',
    'Date: 04/01/2026',
    'Vendor: ABC Corp',
    'Item Qty Price',
    'Item A 2 50',
    'Item B 1 20.5',
    'Total Amount: $120.50',
  ].join('\n');

  const result = extractInvoiceDataFromText(text);

  assert.equal(result.invoiceNumber, 'INV-1001');
  assert.equal(result.date, '2026-04-01');
  assert.equal(result.vendor, 'ABC Corp');
  assert.equal(result.amount, '$120.50');
});

test('extractInvoiceDataFromText extracts common accounting support fields', () => {
  const text = [
    'ACME Services',
    'Invoice Number: INV-700',
    'Invoice Date: 04/01/2026',
    'Due Date: 04/15/2026',
    'Customer: Blue Ridge Retail',
    'Subtotal: $200.00',
    'Tax: $15.00',
    'Total Amount: $215.00',
  ].join('\n');

  const result = extractInvoiceDataFromText(text);

  assert.equal(result.dueDate, '2026-04-15');
  assert.equal(result.subtotal, '$200.00');
  assert.equal(result.tax, '$15.00');
  assert.equal(result.currency, '$');
  assert.equal(result.customerName, 'Blue Ridge Retail');
});

test('extractInvoiceDataFromText prefers labeled vendor and full date on bill-style invoices', () => {
  const text = [
    'Bill',
    'Invoice #: BILL-004',
    'Date: 04/03/202',
    '6',
    'Vendor: Tech Ltd',
    'Item Qty Price',
    'Subscription 1 89.99',
    'Total Amount: $89.99',
  ].join('\n');

  const result = extractInvoiceDataFromText(text);

  assert.equal(result.invoiceNumber, 'BILL-004');
  assert.equal(result.date, '2026-04-03');
  assert.equal(result.vendor, 'Tech Ltd');
  assert.equal(result.amount, '$89.99');
});

test('sanitizeInvoiceNumber rejects generic headings', () => {
  assert.equal(sanitizeInvoiceNumber('Invoice'), '');
  assert.equal(sanitizeInvoiceNumber('the'), '');
  assert.equal(sanitizeInvoiceNumber('is'), '');
  assert.equal(sanitizeInvoiceNumber('INV-1001'), 'INV-1001');
});

test('extractInvoiceDataFromText handles invoice hash format in the header', () => {
  const text = [
    'Veum, Wilkinson and Adams',
    'INVOICE #76326',
    'Date: 2024-12-10',
    'Order Number: 4743263',
    'Invoice total 90.937,98 €',
  ].join('\n');

  const result = extractInvoiceDataFromText(text);

  assert.equal(result.invoiceNumber, '76326');
  assert.equal(result.date, '2024-12-10');
  assert.equal(result.amount, '€90937.98');
});

test('extractInvoiceDataFromText handles spaced invoice heading from parsed PDF text', () => {
  const text = [
    'Sample - Do not pay!',
    'Veum, Wilkinson and Adams I N V O I C E',
    '#76326',
    'Date: 2024-12-10 Order Number: 4743263 Contact Person: Zelda Ullrich',
    'Invoice total 90.937,98 €',
  ].join('\n');

  const result = extractInvoiceDataFromText(text);

  assert.equal(result.invoiceNumber, '76326');
  assert.equal(result.date, '2024-12-10');
  assert.equal(result.amount, '€90937.98');
});
