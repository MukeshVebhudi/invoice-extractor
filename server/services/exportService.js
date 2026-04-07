const ExcelJS = require('exceljs');

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

async function createWorkbookBuffer(rows) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Invoices');

  worksheet.columns = EXPORT_FIELDS.map(([header, key]) => ({
    header,
    key,
    width: Math.max(header.length + 4, 16),
  }));

  rows.forEach((row) => {
    worksheet.addRow(
      Object.fromEntries(
        EXPORT_FIELDS.map(([_, key]) => [key, row[key] ?? ''])
      )
    );
  });

  return workbook.xlsx.writeBuffer();
}

module.exports = {
  createWorkbookBuffer,
};
