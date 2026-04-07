const XLSX = require('xlsx');

const EXPORT_FIELDS = [
  ['file_name', 'fileName'],
  ['invoice_number', 'invoiceNumber'],
  ['date', 'date'],
  ['amount', 'amount'],
  ['vendor', 'vendor'],
  ['confidence', 'confidence'],
  ['extraction_source', 'extractionSource'],
  ['status', 'status'],
];

function createWorkbookBuffer(rows) {
  const normalizedRows = rows.map((row) =>
    Object.fromEntries(
      EXPORT_FIELDS.map(([header, key]) => [header, row[key] ?? ''])
    )
  );

  const worksheet = XLSX.utils.json_to_sheet(normalizedRows, {
    header: EXPORT_FIELDS.map(([header]) => header),
  });
  const workbook = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(workbook, worksheet, 'Invoices');

  return XLSX.write(workbook, {
    type: 'buffer',
    bookType: 'xlsx',
  });
}

module.exports = {
  createWorkbookBuffer,
};
