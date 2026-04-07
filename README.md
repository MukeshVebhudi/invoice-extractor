# Invoice Extractor

Deployable full-stack invoice extraction app for uploading PDFs, extracting key invoice fields, previewing the results, and downloading a CSV file.

## Features

- Upload one or multiple PDF invoices
- Layered extraction pipeline: regex first, fallback parsing next
- Optional AI fallback for missing fields
- Optional OCR fallback for low-text or scanned PDFs
- Extract invoice number, date, amount, and vendor
- Normalize dates and amounts into consistent output
- Preview extracted rows in the browser
- Show confidence and review state per row
- Download CSV with stable headers
- Run frontend and backend together as one Express service

## Stack

- Node.js
- Express
- Multer with memory storage
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
  middleware/
    errorHandler.js
    uploadMiddleware.js
  routes/
    uploadRoutes.js
  services/
    aiExtractorService.js
    extractionPipeline.js
    invoiceExtractor.js
    ocrService.js
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

Upload PDFs in the `invoices` form field.

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
      "invoiceNumber": "INV-1001",
      "date": "2026-04-06",
      "amount": "$1234.56",
      "vendor": "Acme Inc.",
      "confidence": 84,
      "extractionSource": "regex+ai",
      "status": "ok",
      "issues": []
    }
  ],
  "csv": "\"file_name\",\"invoice_number\",\"date\",\"amount\",\"vendor\",\"confidence\",\"extraction_source\",\"status\"\n..."
}
```

Notes:

- `includeRawText=true` can be added to `POST /api/upload` during debugging
- non-PDF files are rejected
- max files per request: `25`
- max file size: `15 MB` each
- rows can return `needsReview: true` when confidence is low
- `status` can be `ok`, `needs_review`, or `error`

## Optional Environment Variables

These are optional. The app still works without them.

```text
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4o-mini
OCR_SPACE_API_KEY=...
```

Behavior:

- regex and fallback parsing always run first
- OCR is only attempted when PDF text is very weak and `OCR_SPACE_API_KEY` is set
- AI is only attempted when important fields are still missing and `OPENAI_API_KEY` is set

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
- Optional OCR / AI only as fallback, not primary extraction

The app stays intentionally simple, but is structured to be clean enough for deployment and iteration.
