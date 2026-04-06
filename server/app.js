const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');

const {
  extractInvoiceDataFromBuffer,
  createCsvFromInvoices,
} = require('./services/invoiceExtractor');

const app = express();
const PORT = process.env.PORT || 5001;
const clientDir = path.join(__dirname, '..', 'client');

const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    const isPdf =
      file.mimetype === 'application/pdf' ||
      file.originalname.toLowerCase().endsWith('.pdf');

    if (!isPdf) {
      return cb(new Error('Only PDF files are allowed.'));
    }

    cb(null, true);
  },
  limits: {
    files: 25,
    fileSize: 15 * 1024 * 1024,
  },
});

app.use(cors());
app.use(express.json());
app.use(express.static(clientDir));

app.get('/', (_req, res) => {
  res.sendFile(path.join(clientDir, 'index.html'));
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/upload', upload.array('invoices', 25), async (req, res) => {
  const uploadedFiles = req.files || [];
  const includeRawText = req.query.includeRawText === 'true';

  if (uploadedFiles.length === 0) {
    return res.status(400).json({
      success: false,
      error: 'Please upload at least one PDF invoice.',
    });
  }

  try {
    const settled = await Promise.all(
      uploadedFiles.map(async (file) => {
        const extracted = await extractInvoiceDataFromBuffer(file.buffer);
        return {
          fileName: file.originalname,
          ...extracted,
        };
      })
    );

    const invoices = settled.map((invoice) => {
      if (includeRawText) {
        return invoice;
      }

      const { rawText, ...rest } = invoice;
      return rest;
    });

    const csv = createCsvFromInvoices(invoices);

    return res.json({
      success: true,
      count: invoices.length,
      data: invoices,
      csv,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to process invoices.',
    });
  }
});

app.use((err, _req, res, _next) => {
  const statusCode = err instanceof multer.MulterError ? 400 : 500;
  res.status(statusCode).json({
    success: false,
    error: err.message || 'Unexpected server error.',
  });
});

app.listen(PORT, () => {
  console.log(`Invoice Extractor running at http://localhost:${PORT}`);
});
