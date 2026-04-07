const form = document.getElementById('uploadForm');
const fileInput = document.getElementById('fileInput');
const dropZone = document.getElementById('dropZone');
const selectedFiles = document.getElementById('selectedFiles');
const loadingIndicator = document.getElementById('loadingIndicator');
const progressWrap = document.getElementById('progressWrap');
const progressBar = document.getElementById('progressBar');
const statusBox = document.getElementById('status');
const resultsSection = document.getElementById('resultsSection');
const resultsBody = document.getElementById('resultsBody');
const jsonOutput = document.getElementById('jsonOutput');
const submitButton = document.getElementById('submitButton');
const sampleButton = document.getElementById('sampleButton');
const clearButton = document.getElementById('clearButton');
const downloadButton = document.getElementById('downloadButton');
const downloadExcelButton = document.getElementById('downloadExcelButton');
const sortSelect = document.getElementById('sortSelect');
const filterButtons = Array.from(document.querySelectorAll('.filter-button'));

let latestCsv = '';
let progressTimer = null;
let selectedFileState = [];
let extractedRows = [];
let activeFilter = 'all';
let activeSort = 'original';

fileInput.addEventListener('change', () => {
  syncSelectedFiles(Array.from(fileInput.files));
});

clearButton.addEventListener('click', () => {
  resetUiState();
});

sampleButton.addEventListener('click', () => {
  loadSampleRows();
});

downloadButton.addEventListener('click', () => {
  if (!extractedRows.length) {
    return;
  }

  latestCsv = buildCsvFromRows(getExportRows());
  const blob = new Blob([latestCsv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'invoices.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});

downloadExcelButton.addEventListener('click', async () => {
  if (!extractedRows.length) {
    return;
  }

  try {
    toggleBusy(true);
    updateStatus('Preparing Excel file...', '');

    const response = await fetch('/api/export/xlsx', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rows: getExportRows() }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({
        error: 'Excel export failed.',
      }));
      throw new Error(payload.error || 'Excel export failed.');
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'invoices.xlsx';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    updateStatus('Excel file is ready.', 'success');
  } catch (error) {
    updateStatus(error.message || 'Excel export failed.', 'error');
  } finally {
    toggleBusy(false);
    updateButtons();
  }
});

sortSelect.addEventListener('change', () => {
  activeSort = sortSelect.value;
  renderResults();
});

filterButtons.forEach((button) => {
  button.addEventListener('click', () => {
    activeFilter = button.dataset.filter;
    filterButtons.forEach((item) => item.classList.toggle('is-active', item === button));
    renderResults();
  });
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!selectedFileState.length) {
    updateStatus('Select at least one PDF file.', 'error');
    return;
  }

  updateStatus(`Processing 0 of ${selectedFileState.length} files...`, '');
  toggleBusy(true);
  startFakeProgress();

  try {
    const formData = new FormData();
    selectedFileState.forEach((file) => {
      formData.append('invoices', file);
    });

    const response = await fetch('/api/upload', {
      method: 'POST',
      body: formData,
    });

    const payload = await response.json().catch(() => ({
      success: false,
      error: 'Server returned an invalid response.',
    }));

    if (!response.ok || !payload.success) {
      throw new Error(payload.error || 'Upload failed.');
    }

    extractedRows = (payload.data || []).map((row, index) => toEditableRow(row, index));
    latestCsv = buildCsvFromRows(getExportRows());
    renderResults();
    jsonOutput.textContent = JSON.stringify(payload, null, 2);
    resultsSection.classList.remove('hidden');
    const statusType =
      payload.errorCount > 0 ? 'error' : payload.partialCount > 0 ? 'warning' : 'success';
    updateStatus(payload.message || `Processed ${payload.count} invoice file(s).`, statusType);
  } catch (error) {
    latestCsv = '';
    extractedRows = [];
    renderResults();
    updateStatus(error.message || 'Something went wrong.', 'error');
  } finally {
    stopFakeProgress(true);
    toggleBusy(false);
    updateButtons();
  }
});

['dragenter', 'dragover'].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add('is-dragover');
  });
});

['dragleave', 'drop'].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove('is-dragover');
  });
});

dropZone.addEventListener('drop', (event) => {
  const files = Array.from(event.dataTransfer.files || []).filter(isPdfFile);
  syncSelectedFiles(files);
});

function syncSelectedFiles(files) {
  selectedFileState = Array.from(files || []).filter(isPdfFile);
  setInputFiles(selectedFileState);
  selectedFiles.innerHTML = '';

  selectedFileState.forEach((file, index) => {
    const item = document.createElement('div');
    item.className = 'file-pill';
    item.innerHTML = `
      <span class="file-pill-name"></span>
      <button type="button" class="file-remove" data-index="${index}" aria-label="Remove ${escapeHtml(file.name)}">Remove</button>
    `;
    item.querySelector('.file-pill-name').textContent = file.name;
    selectedFiles.appendChild(item);
  });

  selectedFiles.querySelectorAll('.file-remove').forEach((button) => {
    button.addEventListener('click', () => {
      removeSelectedFile(Number(button.dataset.index));
    });
  });

  if (!selectedFileState.length && !extractedRows.length) {
    updateStatus('', '');
    resultsSection.classList.add('hidden');
  }

  updateButtons();
}

function renderResults() {
  resultsBody.innerHTML = '';

  const visibleRows = sortRows(filterRows(extractedRows));

  visibleRows.forEach((row) => {
    const tr = document.createElement('tr');
    if (row.needsReview || row.status === 'error') {
      tr.classList.add('needs-review');
    }

    appendStaticCell(tr, row.fileName);
    appendEditableCell(tr, row, 'invoiceNumber', row.fieldConfidence.invoiceNumberConfidence, 'Invoice number');
    appendEditableCell(tr, row, 'date', row.fieldConfidence.dateConfidence, 'Date');
    appendEditableCell(tr, row, 'amount', row.fieldConfidence.amountConfidence, 'Amount');
    appendEditableCell(tr, row, 'vendor', row.fieldConfidence.vendorConfidence, 'Vendor');
    appendConfidenceCell(tr, row);
    appendIssuesCell(tr, row);
    appendReviewCell(tr, row);
    resultsBody.appendChild(tr);
  });

  resultsSection.classList.toggle('hidden', extractedRows.length === 0);
}

function filterRows(rows) {
  if (activeFilter === 'needs_review') {
    return rows.filter((row) => row.needsReview || row.status === 'error');
  }

  if (activeFilter === 'high_confidence') {
    return rows.filter((row) => !row.needsReview && Number(row.confidence) >= 85);
  }

  return rows;
}

function sortRows(rows) {
  const sorted = [...rows];

  switch (activeSort) {
    case 'confidence_desc':
      sorted.sort((a, b) => Number(b.confidence) - Number(a.confidence));
      break;
    case 'amount_desc':
      sorted.sort((a, b) => numericAmount(b.amount) - numericAmount(a.amount));
      break;
    case 'date_desc':
      sorted.sort((a, b) => String(b.date).localeCompare(String(a.date)));
      break;
    default:
      sorted.sort((a, b) => a.originalIndex - b.originalIndex);
      break;
  }

  return sorted;
}

function appendStaticCell(tr, value) {
  const td = document.createElement('td');
  td.textContent = value || '';
  tr.appendChild(td);
}

function appendEditableCell(tr, row, key, confidence, label) {
  const td = document.createElement('td');
  const input = document.createElement('input');
  input.className = `editable-input confidence-${confidenceLevel(confidence)}`;
  input.value = row[key] || '';
  input.setAttribute('aria-label', `${label} for ${row.fileName}`);
  input.title = `${label} confidence: ${confidence}%`;
  if (row.invalidFields.includes(key)) {
    input.classList.add('is-invalid');
  }
  input.addEventListener('input', () => {
    row[key] = input.value.trim();
    row.wasEdited = true;
    refreshRowState(row);
    latestCsv = buildCsvFromRows(getExportRows());
    renderResults();
  });
  td.appendChild(input);
  tr.appendChild(td);
}

function appendConfidenceCell(tr, row) {
  const td = document.createElement('td');
  td.className = 'confidence-cell';
  td.textContent = `${row.confidence}%`;
  td.title = [
    `Invoice #: ${row.fieldConfidence.invoiceNumberConfidence}%`,
    `Date: ${row.fieldConfidence.dateConfidence}%`,
    `Amount: ${row.fieldConfidence.amountConfidence}%`,
    `Vendor: ${row.fieldConfidence.vendorConfidence}%`,
  ].join('\n');
  tr.appendChild(td);
}

function appendIssuesCell(tr, row) {
  const td = document.createElement('td');
  const issues = getVisibleIssues(row);

  if (!issues.length) {
    td.textContent = 'None';
    td.className = 'issues-cell muted';
    tr.appendChild(td);
    return;
  }

  const issueList = document.createElement('div');
  issueList.className = 'issues-list';
  issues.forEach((issue) => {
    const chip = document.createElement('span');
    chip.className = 'issue-chip';
    chip.textContent = issue;
    chip.title = issue;
    issueList.appendChild(chip);
  });
  td.appendChild(issueList);
  tr.appendChild(td);
}

function appendReviewCell(tr, row) {
  const td = document.createElement('td');
  const tag = document.createElement('span');
  const needsReview = row.needsReview || row.status === 'error';
  tag.className = needsReview ? 'review-tag warn' : 'review-tag ok';
  tag.textContent = needsReview ? 'Needs Review' : 'Ready';
  td.appendChild(tag);
  tr.appendChild(td);
}

function toEditableRow(row, index) {
  const editableRow = {
    ...row,
    originalIndex: index,
    wasEdited: false,
    originalIssues: [...(row.issues || [])],
    validationIssues: [],
    invalidFields: [],
    fieldConfidence: {
      invoiceNumberConfidence: inferFieldConfidence(row.invoiceNumber, row.issues, 'Invoice number'),
      dateConfidence: inferFieldConfidence(row.date, row.issues, 'Invoice date'),
      amountConfidence: inferFieldConfidence(row.amount, row.issues, 'Invoice amount'),
      vendorConfidence: inferFieldConfidence(row.vendor, row.issues, 'Vendor'),
    },
  };

  refreshRowState(editableRow);
  return editableRow;
}

function inferFieldConfidence(value, issues, label) {
  if (!value) return 25;
  const hasIssue = (issues || []).some((issue) => issue.toLowerCase().includes(label.toLowerCase()));
  if (hasIssue) return 45;
  return 90;
}

function updateStatus(message, type) {
  if (!message) {
    statusBox.textContent = '';
    statusBox.className = 'status hidden';
    return;
  }

  statusBox.textContent = message;
  statusBox.className = `status ${type}`.trim();
}

function updateButtons() {
  const hasFiles = selectedFileState.length > 0;
  const hasRows = extractedRows.length > 0;
  submitButton.disabled = !hasFiles;
  clearButton.disabled = !hasFiles && !hasRows;
  downloadButton.disabled = !hasRows;
  downloadExcelButton.disabled = !hasRows;
}

function toggleBusy(isBusy) {
  loadingIndicator.classList.toggle('hidden', !isBusy);
  submitButton.disabled = isBusy || !selectedFileState.length;
  sampleButton.disabled = isBusy;
  clearButton.disabled = isBusy;
  downloadButton.disabled = isBusy || !extractedRows.length;
  downloadExcelButton.disabled = isBusy || !extractedRows.length;
}

function startFakeProgress() {
  stopFakeProgress();
  let progress = 8;
  const total = Math.max(1, selectedFileState.length);

  progressWrap.classList.remove('hidden');
  progressBar.style.width = `${progress}%`;

  progressTimer = setInterval(() => {
    progress = Math.min(progress + Math.max(3, (92 - progress) * 0.14), 92);
    progressBar.style.width = `${progress}%`;
    const processed = Math.max(1, Math.min(total, Math.round((progress / 100) * total)));
    updateStatus(`Processing ${processed} of ${total} file(s)...`, '');
  }, 220);
}

function stopFakeProgress(finish = false) {
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }

  if (finish) {
    progressBar.style.width = '100%';
    setTimeout(() => {
      progressWrap.classList.add('hidden');
      progressBar.style.width = '0%';
    }, 250);
    return;
  }

  progressWrap.classList.add('hidden');
  progressBar.style.width = '0%';
}

function isPdfFile(file) {
  return (
    file &&
    (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))
  );
}

function removeSelectedFile(index) {
  if (!Number.isInteger(index)) return;
  selectedFileState = selectedFileState.filter((_, currentIndex) => currentIndex !== index);
  syncSelectedFiles(selectedFileState);
}

function setInputFiles(files) {
  const transfer = new DataTransfer();
  files.forEach((file) => transfer.items.add(file));
  fileInput.files = transfer.files;
}

function buildCsvFromRows(rows) {
  const headers = [
    'file_name',
    'invoice_number',
    'date',
    'amount',
    'vendor',
    'confidence',
    'extraction_source',
    'status',
  ];

  const lines = [headers.join(',')];

  rows.forEach((row) => {
    lines.push([
      row.fileName,
      row.invoiceNumber,
      row.date,
      row.amount,
      row.vendor,
      row.confidence,
      row.extractionSource,
      row.needsReview ? 'needs_review' : 'ok',
    ].map(toCsvField).join(','));
  });

  return `${lines.join('\n')}\n`;
}

function getExportRows() {
  return extractedRows.map((row) => ({
    fileName: row.fileName,
    invoiceNumber: row.invoiceNumber,
    date: row.date,
    amount: row.amount,
    vendor: row.vendor,
    confidence: row.confidence,
    extractionSource: row.extractionSource,
    status: row.needsReview ? 'needs_review' : 'ok',
  }));
}

function toCsvField(value) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

function numericAmount(value) {
  return Number(String(value || '').replace(/[^\d.-]/g, '')) || 0;
}

function confidenceLevel(value) {
  if (value >= 85) return 'high';
  if (value >= 60) return 'medium';
  return 'low';
}

function loadSampleRows() {
  extractedRows = [
    {
      fileName: 'sample-us.pdf',
      invoiceNumber: 'INV-1001',
      date: '2026-04-01',
      amount: '$120.50',
      vendor: 'ABC Corp',
      confidence: 96,
      extractionSource: 'regex',
      status: 'ok',
      needsReview: false,
      issues: [],
    },
    {
      fileName: 'sample-eu.pdf',
      invoiceNumber: '76326',
      date: '2024-12-10',
      amount: '€90937.98',
      vendor: 'Veum, Wilkinson and Adams',
      confidence: 81,
      extractionSource: 'regex',
      status: 'needs_review',
      needsReview: true,
      issues: ['Low-confidence extraction. Needs review.'],
    },
    {
      fileName: 'sample-missing.pdf',
      invoiceNumber: '',
      date: '2026-04-07',
      amount: '₹123456.78',
      vendor: 'Sample Vendor',
      confidence: 58,
      extractionSource: 'regex+ai',
      status: 'needs_review',
      needsReview: true,
      issues: ['Invoice number not found.', 'AI-assisted extraction used for missing values.'],
    },
  ].map((row, index) => toEditableRow(row, index));

  latestCsv = buildCsvFromRows(getExportRows());
  renderResults();
  updateButtons();
  updateStatus('Loaded sample invoice results.', 'success');
}

function resetUiState() {
  fileInput.value = '';
  latestCsv = '';
  selectedFileState = [];
  extractedRows = [];
  selectedFiles.innerHTML = '';
  resultsBody.innerHTML = '';
  jsonOutput.textContent = '';
  resultsSection.classList.add('hidden');
  stopFakeProgress();
  updateStatus('', '');
  updateButtons();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function refreshRowState(row) {
  row.validationIssues = [];
  row.invalidFields = [];

  if (!row.invoiceNumber) {
    row.validationIssues.push('Invoice number is empty.');
    row.invalidFields.push('invoiceNumber');
  }

  if (!row.date) {
    row.validationIssues.push('Date is empty.');
    row.invalidFields.push('date');
  } else if (!isLikelyDate(row.date)) {
    row.validationIssues.push('Edited date format looks invalid.');
    row.invalidFields.push('date');
  }

  if (!row.amount) {
    row.validationIssues.push('Amount is empty.');
    row.invalidFields.push('amount');
  } else if (!isLikelyAmount(row.amount)) {
    row.validationIssues.push('Edited amount format looks invalid.');
    row.invalidFields.push('amount');
  }

  if (!row.vendor) {
    row.validationIssues.push('Vendor is empty.');
    row.invalidFields.push('vendor');
  }

  const unresolvedExtractionIssues = (row.originalIssues || []).filter((issue) =>
    shouldKeepIssue(issue, row)
  );

  row.issues = uniqueValues([...unresolvedExtractionIssues, ...row.validationIssues]);
  row.needsReview = row.issues.length > 0 || Number(row.confidence) < 80;
  row.status = row.needsReview ? 'needs_review' : 'ok';
}

function getVisibleIssues(row) {
  return row.issues || [];
}

function shouldKeepIssue(issue, row) {
  const lower = String(issue || '').toLowerCase();

  if (lower.includes('invoice number not found')) {
    return !row.invoiceNumber;
  }

  if (lower.includes('invoice date not found')) {
    return !row.date;
  }

  if (lower.includes('invoice amount not found')) {
    return !row.amount;
  }

  if (lower.includes('low-confidence extraction')) {
    return Number(row.confidence) < 80;
  }

  return true;
}

function isLikelyDate(value) {
  return /^(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/(\d{2}|\d{4})|\d{1,2}-\d{1,2}-(\d{2}|\d{4})|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})$/.test(String(value).trim());
}

function isLikelyAmount(value) {
  return /^(?:[A-Z]{3}\s*|[$€£₹]\s*)?-?\d[\d,]*(?:\.\d+)?(?:\s*[A-Z]{3}|[$€£₹])?$/.test(String(value).trim())
    || /^(?:[A-Z]{3}\s*|[$€£₹]\s*)?-?\d[\d.]*,\d+(?:\s*[A-Z]{3}|[$€£₹])?$/.test(String(value).trim());
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}
