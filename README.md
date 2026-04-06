# Invoice Extractor

Local full-stack MVP for uploading one or more invoice PDFs, extracting invoice fields, previewing the results, and downloading CSV output.

## Stack

- Node.js
- Express
- Multer
- pdf-parse
- json2csv
- Vanilla HTML, CSS, and JavaScript

## Project Structure

```text
client/
  index.html
  script.js
  style.css
server/
  app.js
  services/
    invoiceExtractor.js
  uploads/
```

## Run Locally

1. Install dependencies:

```bash
npm install
```

2. Start the server:

```bash
node server/app.js
```

You can also use:

```bash
npm start
```

3. Open the app:

```text
http://localhost:5001
```

## API

### `POST /upload`

Accepts multiple PDF files in the `invoices` form field.

Returns JSON like:

```json
{
  "success": true,
  "count": 2,
  "data": [
    {
      "fileName": "invoice-a.pdf",
      "invoiceNumber": "12345",
      "date": "04/06/2026",
      "amount": "$123.45",
      "vendor": "Acme Inc."
    }
  ],
  "csv": "\"fileName\",\"invoiceNumber\",\"date\",\"amount\"\n..."
}
```

## Notes

- Supported extraction fields: invoice number, date, and amount
- The extractor also derives `vendor` for the JSON response as a helpful preview field
- Extraction is regex-based MVP logic
- Uploads are processed in memory to avoid unnecessary disk I/O
- Add `?includeRawText=true` to `POST /upload` if you want the raw parsed PDF text in the response

## Verification

Run the test suite with:

```bash
npm test
```
