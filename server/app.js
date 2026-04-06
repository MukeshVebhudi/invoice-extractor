const express = require('express');
const cors = require('cors');
const path = require('path');

const uploadRoutes = require('./routes/uploadRoutes');
const errorHandler = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 5001;
const clientDir = path.join(__dirname, '..', 'client');

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'invoice-extractor' });
});

app.use('/api', uploadRoutes);
app.use(express.static(clientDir));

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(clientDir, 'index.html'));
});

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Invoice Extractor running on port ${PORT}`);
});
