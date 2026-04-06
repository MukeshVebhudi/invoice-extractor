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
} = require('../services/invoiceExtractor');

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
  assert.equal(result.amount, '$1234.56');
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
  assert.equal(result.amount, '2200.50');
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
      invoiceNumber: 'A-1',
      date: '2026-04-06',
      amount: '$100.00',
      vendor: 'Acme',
      status: 'ok',
    },
  ]);

  assert.match(csv, /"file_name","invoice_number","date","amount","vendor","status"/);
  assert.match(csv, /"invoice\.pdf","A-1","2026-04-06","\$100\.00","Acme","ok"/);
});

test('normalize helpers return consistent values', () => {
  assert.equal(normalizeDate('04/06/2026'), '2026-04-06');
  assert.equal(normalizeDate('06-04-2026'), '2026-04-06');
  assert.equal(normalizeAmount('$1,234.5'), '$1234.50');
  assert.equal(normalizeAmount('1,234.56'), '1234.56');
});
