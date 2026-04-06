const form = document.getElementById('uploadForm');
const fileInput = document.getElementById('fileInput');
const dropZone = document.getElementById('dropZone');
const selectedFiles = document.getElementById('selectedFiles');
const loadingIndicator = document.getElementById('loadingIndicator');
const statusBox = document.getElementById('status');
const resultsSection = document.getElementById('resultsSection');
const resultsBody = document.getElementById('resultsBody');
const jsonOutput = document.getElementById('jsonOutput');
const submitButton = document.getElementById('submitButton');
const clearButton = document.getElementById('clearButton');
const downloadButton = document.getElementById('downloadButton');

let latestCsv = '';

fileInput.addEventListener('change', () => {
  syncSelectedFiles(fileInput.files);
});

clearButton.addEventListener('click', () => {
  fileInput.value = '';
  latestCsv = '';
  selectedFiles.innerHTML = '';
  resultsBody.innerHTML = '';
  jsonOutput.textContent = '';
  resultsSection.classList.add('hidden');
  updateStatus('', '');
  updateButtons();
});

downloadButton.addEventListener('click', () => {
  if (!latestCsv) {
    return;
  }

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

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!fileInput.files.length) {
    updateStatus('Select at least one PDF file.', 'error');
    return;
  }

  updateStatus('Processing invoices...', '');
  toggleBusy(true);

  try {
    const formData = new FormData();

    for (const file of fileInput.files) {
      formData.append('invoices', file);
    }

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

    latestCsv = payload.csv || '';
    renderResults(payload.data || []);
    jsonOutput.textContent = JSON.stringify(payload, null, 2);
    resultsSection.classList.remove('hidden');
    const statusType =
      payload.errorCount > 0 ? 'error' : payload.partialCount > 0 ? 'warning' : 'success';
    updateStatus(payload.message || `Processed ${payload.count} invoice file(s).`, statusType);
  } catch (error) {
    latestCsv = '';
    updateStatus(error.message || 'Something went wrong.', 'error');
  } finally {
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
  const transfer = new DataTransfer();

  files.forEach((file) => transfer.items.add(file));
  fileInput.files = transfer.files;
  syncSelectedFiles(fileInput.files);
});

function syncSelectedFiles(files) {
  selectedFiles.innerHTML = '';

  Array.from(files).forEach((file) => {
    const item = document.createElement('div');
    item.className = 'file-pill';
    item.textContent = file.name;
    selectedFiles.appendChild(item);
  });

  if (!files.length) {
    updateStatus('', '');
    resultsSection.classList.add('hidden');
  }

  updateButtons();
}

function renderResults(rows) {
  resultsBody.innerHTML = '';

  rows.forEach((row) => {
    const tr = document.createElement('tr');
    if (row.status && row.status !== 'ok') {
      tr.classList.add('needs-review');
    }

    [
      row.fileName,
      row.invoiceNumber,
      row.date,
      row.amount,
    ].forEach((value) => {
      const td = document.createElement('td');
      td.textContent = value || '';
      tr.appendChild(td);
    });
    resultsBody.appendChild(tr);
  });
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
  const hasFiles = fileInput.files.length > 0;
  submitButton.disabled = !hasFiles;
  clearButton.disabled = !hasFiles;
  downloadButton.disabled = !latestCsv;
}

function toggleBusy(isBusy) {
  loadingIndicator.classList.toggle('hidden', !isBusy);
  submitButton.disabled = isBusy || !fileInput.files.length;
  clearButton.disabled = isBusy;
  downloadButton.disabled = isBusy || !latestCsv;
}

function isPdfFile(file) {
  return (
    file &&
    (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))
  );
}
