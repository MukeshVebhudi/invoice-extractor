const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const { execFile } = require('node:child_process');
const { PDFParse } = require('pdf-parse');

const app = express();
// NOTE: macOS may reserve port 5000 (AirTunes/AirPlay). Defaulting to 5001 avoids that.
const PORT = process.env.PORT || 5001;

// When serving the frontend from this same server, CORS isn't needed,
// but keeping it enabled doesn't hurt local dev.
app.use(cors());
app.use(express.json());

// Serve the frontend (index.html, script.js, style.css) from repo root
app.use(express.static(path.join(__dirname, '..')));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 50,
    fileSize: 25 * 1024 * 1024, // 25MB per PDF
  },
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

app.get('/health', (req, res) => {
  res.type('text').send('OK');
});

app.post('/generate-samples', async (req, res) => {
  try {
    const scriptPath = path.join(__dirname, 'tools', 'generate-test-invoices.js');
    await new Promise((resolve, reject) => {
      execFile(process.execPath, [scriptPath], { timeout: 30_000 }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    const files = [
      'invoice-01-basic.pdf',
      'invoice-02-invoice-hash.pdf',
      'invoice-03-amount-due-last.pdf',
      'invoice-04-vendor-with-address.pdf',
      'invoice-05-no-vendor-label.pdf',
    ];

    res.json({
      ok: true,
      dir: '/test-fixtures/',
      files: files.map((f) => ({
        name: f,
        url: `/test-fixtures/${encodeURIComponent(f)}`,
      })),
    });
  } catch (e) {
    console.error('Failed to generate samples:', e);
    res.status(500).json({ ok: false, error: 'Failed to generate sample invoices' });
  }
});

app.post('/extract', upload.array('files'), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: 'No files uploaded' });
    }

    const allExtractedData = [];
    const extractionErrors = [];
    
    for (const file of req.files) {
      try {
        const text = await extractPDFText(file.buffer);
        const extractedData = extractInvoiceFieldsWithRegex(text);
        allExtractedData.push(extractedData);
      } catch (fileError) {
        console.error(`Error processing file ${file.originalname}:`, fileError);
        extractionErrors.push({
          file: file.originalname || '',
          error: fileError?.message ? String(fileError.message) : 'Unknown error',
        });
        allExtractedData.push({
          invoice_number: '',
          date: '',
          vendor: '',
          total: '',
        });
      }
    }
    
    const csvContent = generateMultiCSV(allExtractedData);
    
    // Surface errors without changing CSV schema (still 4 columns).
    if (extractionErrors.length > 0) {
      res.setHeader('X-Extraction-Error-Count', String(extractionErrors.length));
      res.setHeader(
        'X-Extraction-Error-Files',
        extractionErrors
          .map((e) => e.file)
          .filter(Boolean)
          .slice(0, 10)
          .join(',')
      );
    } else {
      res.setHeader('X-Extraction-Error-Count', '0');
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="invoices.csv"');
    res.send(csvContent);
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to process PDFs'
    });
  }
});

async function extractPDFText(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return (result?.text || '').trim();
  } finally {
    await parser.destroy();
  }
}

function generateMultiCSV(extractedDataArray) {
  const headers = ['invoice_number', 'date', 'vendor', 'total'];
  const lines = [headers.join(',')];

  for (const row of extractedDataArray) {
    lines.push(
      headers
        .map((h) => toCsvField(row?.[h] ?? ''))
        .join(',')
    );
  }

  return `${lines.join('\n')}\n`;
}

function extractInvoiceFieldsWithRegex(text) {
  const result = {
    invoice_number: "",
    date: "",
    vendor: "",
    total: ""
  };
  
  const normalized = normalizeText(text);
  const lines = normalized.split('\n').map((l) => l.trim()).filter(Boolean);

  result.invoice_number =
    firstMatchGroup(normalized, [
      // Prefer explicit labels first
      /\b(?:invoice\s*(?:no\.?|number)|invoice\s*#)\s*[:\-#]?\s*([A-Z0-9][A-Z0-9\-\/]*)\b/i,
      /\b(?:inv\s*(?:no\.?|number)|inv\s*#)\s*[:\-#]?\s*([A-Z0-9][A-Z0-9\-\/]*)\b/i,
      // Fallback only if "invoice" and a token are on the same line
      /\binvoice\b[^\n]{0,20}\b([A-Z0-9][A-Z0-9\-\/]*)\b/i,
    ]) || '';

  result.date =
    firstMatchGroup(normalized, [
      /\b(?:invoice\s*date|date)\s*[:\-]?\s*([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4})\b/i,
      /\b(?:invoice\s*date|date)\s*[:\-]?\s*([0-9]{4}[\/\-][0-9]{1,2}[\/\-][0-9]{1,2})\b/i,
      /\b(?:invoice\s*date|date)\s*[:\-]?\s*([A-Z]{3,9}\s+[0-9]{1,2},?\s+[0-9]{4})\b/i,
    ]) || '';

  // Prefer "Total", "Amount Due", "Balance Due"
  const totalRaw = lastMatchGroup(normalized, [
    /\b(?:total|invoice\s*total|grand\s*total|amount\s*due|balance\s*due)\s*[:\-]?\s*(?:USD\s*)?[$₹€£]?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|[0-9]+(?:\.[0-9]{2})?)\b/gi,
  ]) || '';
  result.total = totalRaw ? normalizeTotal(totalRaw) : '';

  // Vendor heuristic: first non-empty line that isn't obviously a label/field
  result.vendor =
    firstMatchGroup(normalized, [
      /\b(?:vendor|from)\s*[:\-]\s*([^\n]{2,80})/i,
    ]) || guessVendor(lines);

  return result;
}

function toCsvField(value) {
  const s = String(value ?? '');
  const escaped = s.replace(/"/g, '""');
  return `"${escaped}"`;
}

function normalizeText(text) {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\u00A0/g, ' ')
    .trim();
}

function normalizeTotal(s) {
  return String(s ?? '')
    .replace(/[, ]/g, '')
    .replace(/[$₹€£]/g, '')
    .trim();
}

function firstMatchGroup(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1]) return m[1].trim();
  }
  return '';
}

function lastMatchGroup(text, patterns) {
  for (const re of patterns) {
    const last = lastCaptureGroup(text, re);
    if (last) return last;
  }
  return '';
}

function lastCaptureGroup(text, re) {
  if (!(re instanceof RegExp)) return '';
  if (!re.global) {
    const m = text.match(re);
    return m && m[1] ? m[1].trim() : '';
  }

  let match;
  let last = '';
  // Reset lastIndex in case regex is reused
  re.lastIndex = 0;
  while ((match = re.exec(text)) !== null) {
    if (match[1]) last = match[1].trim();
  }
  return last;
}

function guessVendor(lines) {
  const blacklist = /invoice|bill\s*to|ship\s*to|sold\s*to|total|amount|due|balance|date|invoice\s*(?:no|number|#)|page\s+\d+|subtotal|tax|vat|gst|qty|quantity|description|unit\s*price|payment|terms|remit\s*to/i;
  const addressHint = /\b(st|street|ave|avenue|rd|road|blvd|boulevard|ln|lane|dr|drive|suite|ste|apt|floor|fl)\b/i;
  const phoneHint = /\b(\+?\d[\d \-().]{7,}\d)\b/;

  // Prefer vendor near the top, but avoid choosing footer-like lines.
  for (const line of lines.slice(0, 25)) {
    if (line.length < 2) continue;
    if (blacklist.test(line)) continue;
    // avoid emails / urls / obvious addresses / phones
    if (/@/.test(line)) continue;
    if (/\b(?:www\.|https?:\/\/)/i.test(line)) continue;
    if (phoneHint.test(line)) continue;
    if (addressHint.test(line)) continue;
    // skip lines that are mostly digits/punct
    const letters = (line.match(/[A-Za-z]/g) || []).length;
    if (letters < Math.min(4, line.length / 4)) continue;
    // very address-like: many digits
    const digits = (line.match(/\d/g) || []).length;
    if (digits >= 4) continue;
    // Avoid generic gratitude/footer lines
    if (/^thank(s| you)!?$/i.test(line)) continue;

    return line;
  }
  return '';
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});