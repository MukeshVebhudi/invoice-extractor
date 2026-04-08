# Invoice Extractor

Deployable full-stack invoice extraction app for uploading text-based invoice documents, extracting key invoice fields, previewing the results, and downloading CSV or Excel files.

## Features

- Upload one or multiple text-based invoice PDFs or TXT files
- Paste raw invoice text directly into the app for quick testing
- Strong text-first pipeline: preprocessing first, regex extraction next, fallback parsing after that
- Extract invoice number, invoice date, due date, total amount, subtotal, tax, currency, vendor, and customer name
- Normalize dates and amounts into consistent output
- Detect weak or unreadable text and flag unsupported files clearly
- Preview extracted rows in the browser
- Show confidence and review state per row
- Download CSV with stable headers
- Download Excel with the same reviewed values
- Run frontend and backend together as one Express service

## Stack

- Node.js
- Express
- Multer with memory storage
- pdf-parse
- json2csv
- exceljs
- Vanilla HTML, CSS, and JavaScript

## Project Structure

```text
client/
  index.html
  script.js
  style.css
server/
  app.js
  middleware/
    errorHandler.js
    uploadMiddleware.js
  routes/
    uploadRoutes.js
  services/
    extractionPipeline.js
    exportService.js
    invoiceExtractor.js
    textProcessingService.js
  tests/
    invoiceExtractor.test.js
```

## Run Locally

1. Install dependencies

```bash
npm install
```

2. Start the app

```bash
npm start
```

3. Open the browser

```text
http://localhost:5001
```

## API

### `GET /health`

Returns:

```json
{
  "ok": true,
  "service": "invoice-extractor"
}
```

### `POST /api/upload`

Upload text-based PDFs or TXT files in the `invoices` form field.

Example response:

```json
{
  "success": true,
  "count": 2,
  "parsedCount": 2,
  "partialCount": 1,
  "errorCount": 0,
  "message": "Processed 2 file(s). 1 need review.",
  "data": [
    {
      "fileName": "invoice-a.pdf",
      "inputType": "pdf",
      "invoiceNumber": "INV-1001",
      "date": "2026-04-06",
      "dueDate": "2026-04-30",
      "amount": "$1234.56",
      "subtotal": "$1100.00",
      "tax": "$134.56",
      "currency": "$",
      "vendor": "Acme Inc.",
      "customerName": "Northwind LLC",
      "confidence": 84,
      "fieldConfidence": {
        "invoiceNumberConfidence": 92,
        "dateConfidence": 92,
        "amountConfidence": 92,
        "vendorConfidence": 82
      },
      "textReadable": true,
      "extractionSource": "text",
      "status": "ok",
      "issues": []
    }
  ],
  "csv": "\"file_name\",\"input_type\",\"invoice_number\",\"date\",\"due_date\",\"amount\",\"subtotal\",\"tax\",\"currency\",\"vendor\",\"customer_name\",\"confidence\",\"needs_review\",\"text_readable\",\"extraction_source\",\"status\",\"issues\"\n..."
}
```

Notes:

- `includeRawText=true` can be added to `POST /api/upload` during debugging
- non-PDF/TXT files are rejected
- max files per request: `25`
- max file size: `15 MB` each
- rows can return `needsReview: true` when confidence is low
- `status` can be `ok`, `needs_review`, or `error`
- weak or empty PDF text is flagged as unsupported for the current phase instead of being guessed

### `POST /api/parse-text`

Send raw invoice text directly:

```json
{
  "fileName": "pasted-text.txt",
  "text": "Invoice Number: INV-1001\nDate: 04/06/2026\nTotal: $1234.56"
}
```

## Test

```bash
npm test
```

## Deploy On Render

1. Push the project to GitHub.
2. In Render, click `New +` and choose `Web Service`.
3. Connect the GitHub repo.
4. Use these settings:

```text
Environment: Node
Build Command: npm install
Start Command: npm start
```

5. Leave `PORT` unset. Render provides it automatically, and the app already uses `process.env.PORT`.
6. Deploy the service.

After deployment:

- Render will host the Express server
- Express will serve the frontend from `client/`
- the whole app runs as one service from a single URL

## Deploy Notes For Railway

- Create a new project from the GitHub repo
- Railway detects the Node app automatically
- Use `npm install` as build command if needed
- Use `npm start` as the start command
- Railway will inject `PORT`, which the app already supports

## Design Constraints

- No authentication
- No database
- No background jobs
- Text-based PDF invoices only
- TXT files and pasted text are also supported
- Scanned or image-only invoices are not part of the active scope yet

The app stays intentionally simple, but is structured to be clean enough for deployment and iteration.

## Current Limitations

- This phase is focused on text-readable documents only
- If a PDF has little or no readable text, the app will flag it as unsupported
- Scanned or image-only invoices are intentionally rejected for now so the app stays accurate instead of guessing
