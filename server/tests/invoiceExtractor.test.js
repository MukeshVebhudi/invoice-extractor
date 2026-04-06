const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  extractInvoiceDataFromBuffer,
  extractInvoiceDataFromText,
  createCsvFromInvoices,
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
  assert.equal(result.date, '04/06/2026');
  assert.equal(result.amount, '$1,234.56');
});

test('extractInvoiceDataFromBuffer parses the sample PDF', async () => {
  const fixture = path.join(process.cwd(), 'test-invoice.pdf');
  const result = await extractInvoiceDataFromBuffer(fs.readFileSync(fixture));

  assert.equal(result.invoiceNumber, 'INV-1001');
  assert.equal(result.date, '04/06/2026');
  assert.equal(result.amount, '1,234.56');
});

test('createCsvFromInvoices outputs CSV headers and rows', () => {
  const csv = createCsvFromInvoices([
    {
      fileName: 'invoice.pdf',
      invoiceNumber: 'A-1',
      date: '04/06/2026',
      amount: '$100.00',
    },
  ]);

  assert.match(csv, /"fileName","invoiceNumber","date","amount"/);
  assert.match(csv, /"invoice\.pdf","A-1","04\/06\/2026","\$100\.00"/);
});
