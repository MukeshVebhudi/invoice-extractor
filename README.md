# Invoice Extractor

Deployable full-stack MVP for uploading invoice PDFs, extracting key invoice fields, previewing the results, and downloading a CSV file.

## Features

- Upload one or multiple PDF invoices
- Extract invoice number, date, amount, and vendor
- Normalize dates and amounts into consistent output
- Preview extracted rows in the browser
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
    invoiceExtractor.js
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
      "status": "ok",
      "issues": []
    }
  ],
  "csv": "\"file_name\",\"invoice_number\",\"date\",\"amount\",\"vendor\",\"status\"\n..."
}
```

Notes:

- `includeRawText=true` can be added to `POST /api/upload` during debugging
- non-PDF files are rejected
- max files per request: `25`
- max file size: `15 MB` each

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
- No cloud OCR or AI parsing

The app stays intentionally simple, but is structured to be clean enough for deployment and iteration.
