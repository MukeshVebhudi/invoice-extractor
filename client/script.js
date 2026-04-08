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
const submitButton = document.getElementById('submitButton');
const clearButton = document.getElementById('clearButton');
const downloadButton = document.getElementById('downloadButton');
const downloadExcelButton = document.getElementById('downloadExcelButton');
const parseTextButton = document.getElementById('parseTextButton');
const rawTextInput = document.getElementById('rawTextInput');
const textInputName = document.getElementById('textInputName');
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

parseTextButton.addEventListener('click', async () => {
  const text = rawTextInput.value.trim();
  if (!text) {
    updateStatus('Paste some invoice text first.', 'error');
    return;
  }

  try {
    toggleBusy(true);
    updateStatus('Reading pasted text...', '');

    const response = await fetch('/api/parse-text', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fileName: textInputName.value.trim() || 'pasted-text.txt',
        text,
      }),
    });

    const payload = await response.json().catch(() => ({
      success: false,
      error: 'Server returned an invalid response.',
    }));

    if (!response.ok || !payload.success) {
      throw new Error(payload.error || 'Could not read pasted text.');
    }

    extractedRows = (payload.data || []).map((row, index) => toEditableRow(row, index));
    latestCsv = buildCsvFromRows(getExportRows());
    renderResults();
    updateStatus(payload.message || 'Processed pasted text.', payload.partialCount > 0 ? 'warning' : 'success');
  } catch (error) {
    updateStatus(error.message || 'Could not read pasted text.', 'error');
  } finally {
    toggleBusy(false);
    updateButtons();
  }
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
    updateStatus('Select at least one PDF or TXT file.', 'error');
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
    appendStaticCell(tr, formatInputType(row.inputType));
    appendReadableCell(tr, row);
    appendEditableCell(tr, row, 'invoiceNumber', row.fieldConfidence.invoiceNumberConfidence, 'Invoice number');
    appendEditableCell(tr, row, 'date', row.fieldConfidence.dateConfidence, 'Date');
    appendEditableCell(tr, row, 'dueDate', row.fieldConfidence.dueDateConfidence, 'Due date');
    appendEditableCell(tr, row, 'amount', row.fieldConfidence.amountConfidence, 'Amount');
    appendEditableCell(tr, row, 'subtotal', row.fieldConfidence.subtotalConfidence, 'Subtotal');
    appendEditableCell(tr, row, 'tax', row.fieldConfidence.taxConfidence, 'Tax');
    appendEditableCell(tr, row, 'currency', row.fieldConfidence.currencyConfidence, 'Currency');
    appendEditableCell(tr, row, 'vendor', row.fieldConfidence.vendorConfidence, 'Vendor');
    appendEditableCell(tr, row, 'customerName', row.fieldConfidence.customerNameConfidence, 'Customer');
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
    `Due date: ${row.fieldConfidence.dueDateConfidence}%`,
    `Amount: ${row.fieldConfidence.amountConfidence}%`,
    `Subtotal: ${row.fieldConfidence.subtotalConfidence}%`,
    `Tax: ${row.fieldConfidence.taxConfidence}%`,
    `Currency: ${row.fieldConfidence.currencyConfidence}%`,
    `Vendor: ${row.fieldConfidence.vendorConfidence}%`,
    `Customer: ${row.fieldConfidence.customerNameConfidence}%`,
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
  tag.textContent = needsReview ? 'Check This' : 'Looks Good';
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
      invoiceNumberConfidence: row.fieldConfidence?.invoiceNumberConfidence ?? inferFieldConfidence(row.invoiceNumber, row.issues, 'Invoice number'),
      dateConfidence: row.fieldConfidence?.dateConfidence ?? inferFieldConfidence(row.date, row.issues, 'Invoice date'),
      dueDateConfidence: row.fieldConfidence?.dueDateConfidence ?? inferFieldConfidence(row.dueDate, row.issues, 'Due date'),
      amountConfidence: row.fieldConfidence?.amountConfidence ?? inferFieldConfidence(row.amount, row.issues, 'Invoice amount'),
      subtotalConfidence: row.fieldConfidence?.subtotalConfidence ?? inferFieldConfidence(row.subtotal, row.issues, 'Subtotal'),
      taxConfidence: row.fieldConfidence?.taxConfidence ?? inferFieldConfidence(row.tax, row.issues, 'Tax'),
      currencyConfidence: row.fieldConfidence?.currencyConfidence ?? inferFieldConfidence(row.currency, row.issues, 'Currency'),
      vendorConfidence: row.fieldConfidence?.vendorConfidence ?? inferFieldConfidence(row.vendor, row.issues, 'Vendor'),
      customerNameConfidence: row.fieldConfidence?.customerNameConfidence ?? inferFieldConfidence(row.customerName, row.issues, 'Customer'),
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
  downloadButton.classList.toggle('hidden', !hasRows);
  downloadExcelButton.classList.toggle('hidden', !hasRows);
}

function toggleBusy(isBusy) {
  loadingIndicator.classList.toggle('hidden', !isBusy);
  submitButton.disabled = isBusy || !selectedFileState.length;
  parseTextButton.disabled = isBusy;
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
    (
      file.type === 'application/pdf' ||
      file.type === 'text/plain' ||
      file.name.toLowerCase().endsWith('.pdf') ||
      file.name.toLowerCase().endsWith('.txt')
    )
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
    'input_type',
    'invoice_number',
    'date',
    'due_date',
    'amount',
    'subtotal',
    'tax',
    'currency',
    'vendor',
    'customer_name',
    'confidence',
    'needs_review',
    'text_readable',
    'extraction_source',
    'status',
    'issues',
  ];

  const lines = [headers.join(',')];

  rows.forEach((row) => {
    lines.push([
      row.fileName,
      row.inputType,
      row.invoiceNumber,
      row.date,
      row.dueDate,
      row.amount,
      row.subtotal,
      row.tax,
      row.currency,
      row.vendor,
      row.customerName,
      row.confidence,
      row.needsReview,
      row.textReadable,
      row.extractionSource,
      row.needsReview ? 'needs_review' : 'ok',
      (row.issues || []).join(' | '),
    ].map(toCsvField).join(','));
  });

  return `${lines.join('\n')}\n`;
}

function getExportRows() {
  return extractedRows.map((row) => ({
    fileName: row.fileName,
    inputType: row.inputType,
    invoiceNumber: row.invoiceNumber,
    date: row.date,
    dueDate: row.dueDate,
    amount: row.amount,
    subtotal: row.subtotal,
    tax: row.tax,
    currency: row.currency,
    vendor: row.vendor,
    customerName: row.customerName,
    confidence: row.confidence,
    needsReview: row.needsReview,
    textReadable: row.textReadable,
    extractionSource: row.extractionSource,
    status: row.needsReview ? 'needs_review' : 'ok',
    issues: row.issues,
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

function resetUiState() {
  fileInput.value = '';
  rawTextInput.value = '';
  latestCsv = '';
  selectedFileState = [];
  extractedRows = [];
  selectedFiles.innerHTML = '';
  resultsBody.innerHTML = '';
  resultsSection.classList.add('hidden');
  stopFakeProgress();
  updateStatus('', '');
  updateButtons();
}

function appendReadableCell(tr, row) {
  const td = document.createElement('td');
  const tag = document.createElement('span');
  tag.className = row.textReadable ? 'review-tag ok' : 'review-tag warn';
  tag.textContent = row.textReadable ? 'Yes' : 'No';
  td.appendChild(tag);
  tr.appendChild(td);
}

function formatInputType(value) {
  if (value === 'pasted_text') return 'Pasted Text';
  return String(value || '').toUpperCase() || 'PDF';
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

  if (row.dueDate && !isLikelyDate(row.dueDate)) {
    row.validationIssues.push('Edited due date format looks invalid.');
    row.invalidFields.push('dueDate');
  }

  if (!row.amount) {
    row.validationIssues.push('Amount is empty.');
    row.invalidFields.push('amount');
  } else if (!isLikelyAmount(row.amount)) {
    row.validationIssues.push('Edited amount format looks invalid.');
    row.invalidFields.push('amount');
  }

  if (row.subtotal && !isLikelyAmount(row.subtotal)) {
    row.validationIssues.push('Edited subtotal format looks invalid.');
    row.invalidFields.push('subtotal');
  }

  if (row.tax && !isLikelyAmount(row.tax)) {
    row.validationIssues.push('Edited tax format looks invalid.');
    row.invalidFields.push('tax');
  }

  if (row.currency && !isLikelyCurrency(row.currency)) {
    row.validationIssues.push('Edited currency looks invalid.');
    row.invalidFields.push('currency');
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

  if (lower.includes('due date not found')) {
    return !row.dueDate;
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

function isLikelyCurrency(value) {
  return /^(?:USD|EUR|GBP|INR|CAD|AUD|JPY|CHF|AED|SGD|[$€£₹])$/i.test(String(value).trim());
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}
