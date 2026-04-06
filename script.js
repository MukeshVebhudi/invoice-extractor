document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('uploadForm');
    const fileInput = document.getElementById('fileInput');
    const submitBtn = document.getElementById('submitBtn');
    const clearBtn = document.getElementById('clearBtn');
    const generateSamplesBtn = document.getElementById('generateSamplesBtn');
    const samplesLinks = document.getElementById('samplesLinks');
    const loading = document.getElementById('loading');
    const message = document.getElementById('message');
    const fileLabel = document.querySelector('.file-label');
    const dropZone = document.getElementById('dropZone');
    const uploadText = document.querySelector('.upload-text');
    const fileList = document.getElementById('fileList');
    const preview = document.getElementById('preview');
    const previewBody = document.getElementById('previewBody');
    let isSubmitting = false;

    function setFiles(fileListLike) {
        const files = Array.from(fileListLike || []).filter(f => isPdf(f));

        // Build a new FileList via DataTransfer so input reflects dropped files
        const dt = new DataTransfer();
        files.forEach(f => dt.items.add(f));
        fileInput.files = dt.files;

        renderSelectedFiles();
    }

    function renderSelectedFiles() {
        const files = fileInput.files;
        const count = files.length;

        if (count > 0) {
            submitBtn.disabled = false;
            clearBtn.disabled = false;
            fileLabel.classList.add('has-file');

            if (uploadText) {
                uploadText.textContent = count === 1 ? files[0].name : `${count} files selected`;
            }

            fileList.innerHTML = '';
            Array.from(files).forEach(file => {
                const item = document.createElement('div');
                item.className = 'file-list-item';
                item.textContent = file.name;
                fileList.appendChild(item);
            });
        } else {
            submitBtn.disabled = true;
            clearBtn.disabled = true;
            fileLabel.classList.remove('has-file');
            if (uploadText) uploadText.textContent = 'Choose PDF Files';
            fileList.innerHTML = '';
        }

        hidePreview();
    }

    fileInput.addEventListener('change', function() {
        renderSelectedFiles();
    });

    clearBtn.addEventListener('click', function() {
        fileInput.value = '';
        renderSelectedFiles();
        hideMessage();
        hidePreview();
    });

    if (generateSamplesBtn) {
        generateSamplesBtn.addEventListener('click', async function() {
            generateSamplesBtn.disabled = true;
            hideMessage();
            try {
                const resp = await fetch('/generate-samples', { method: 'POST' });
                if (!resp.ok) {
                    const t = await resp.text();
                    throw new Error(t || `HTTP error ${resp.status}`);
                }
                const data = await resp.json();
                if (!data?.ok) throw new Error(data?.error || 'Failed to generate samples');

                if (samplesLinks) {
                    const items = (data.files || [])
                        .map(f => `<li><a href="${f.url}" download>${escapeHtml(f.name)}</a></li>`)
                        .join('');
                    samplesLinks.innerHTML = `
                        <div><strong>Sample invoices generated.</strong> Download or drag them from Finder:</div>
                        <div style="margin-top:6px;">Folder: <code>${escapeHtml(data.dir || '/test-fixtures/')}</code></div>
                        <ul>${items}</ul>
                    `;
                    samplesLinks.classList.remove('hidden');
                }

                showMessage('Sample invoices generated. Download them or select them from /test-fixtures/.', 'success');
            } catch (e) {
                showMessage('Failed to generate samples: ' + (e?.message || String(e)), 'error');
            } finally {
                generateSamplesBtn.disabled = false;
            }
        });
    }

    // Drag & drop support
    if (dropZone) {
        const stop = (e) => {
            e.preventDefault();
            e.stopPropagation();
        };

        ['dragenter', 'dragover'].forEach(evt => {
            dropZone.addEventListener(evt, (e) => {
                stop(e);
                dropZone.classList.add('dragover');
            });
        });

        ['dragleave', 'drop'].forEach(evt => {
            dropZone.addEventListener(evt, (e) => {
                stop(e);
                dropZone.classList.remove('dragover');
            });
        });

        dropZone.addEventListener('drop', (e) => {
            const files = e.dataTransfer?.files || [];
            setFiles(files);
        });
    }
    
    // Prevent any native form submit navigation/download.
    form.addEventListener('submit', function(e) {
        e.preventDefault();
    });

    submitBtn.addEventListener('click', async function() {
        if (isSubmitting) return;
        
        if (!fileInput.files.length) {
            showMessage('Please select PDF files', 'error');
            return;
        }

        isSubmitting = true;
        showLoading(true);
        hideMessage();

        try {
            const formData = new FormData();
            Array.from(fileInput.files).forEach(file => {
                formData.append('files', file);
            });

            const response = await fetch('/extract', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || `HTTP error ${response.status}`);
            }

            const blob = await response.blob();
            
            if (blob.size === 0) {
                throw new Error('Received empty file');
            }

            // Build preview from CSV before triggering download
            try {
                const csvText = await blob.text();
                renderPreviewFromCsv(csvText);
            } catch {
                hidePreview();
            }
            
            const downloadUrl = window.URL.createObjectURL(blob);
            
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = `invoices-${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(downloadUrl);

            const errorCountHeader = response.headers.get('X-Extraction-Error-Count');
            const errorCount = errorCountHeader ? Number(errorCountHeader) : 0;
            const okCount = Math.max(0, fileInput.files.length - (Number.isFinite(errorCount) ? errorCount : 0));

            if (errorCount > 0) {
                const errorFiles = response.headers.get('X-Extraction-Error-Files') || '';
                const suffix = errorFiles ? ` Failed: ${errorFiles}` : '';
                showMessage(`Downloaded CSV. ${okCount} processed, ${errorCount} failed.${suffix}`, 'error');
            } else {
                showMessage('Invoice data extracted successfully! ' + fileInput.files.length + ' invoices processed.', 'success');
            }
            
        } catch (error) {
            showMessage('Error extracting invoice data: ' + error.message, 'error');
        } finally {
            showLoading(false);
            isSubmitting = false;
        }
    });

    function showLoading(show) {
        if (show) {
            loading.classList.remove('hidden');
            submitBtn.disabled = true;
            clearBtn.disabled = true;
        } else {
            loading.classList.add('hidden');
            if (fileInput.files.length > 0) {
                submitBtn.disabled = false;
                clearBtn.disabled = false;
            }
        }
    }

    function showMessage(text, type) {
        message.textContent = text;
        message.className = `message ${type}`;
        message.classList.remove('hidden');
    }

    function hideMessage() {
        message.classList.add('hidden');
    }

    function isPdf(file) {
        if (!file) return false;
        const name = (file.name || '').toLowerCase();
        return name.endsWith('.pdf') || file.type === 'application/pdf';
    }

    function hidePreview() {
        if (!preview) return;
        preview.classList.add('hidden');
        if (previewBody) previewBody.innerHTML = '';
    }

    function renderPreviewFromCsv(csvText) {
        if (!preview || !previewBody) return;

        const rows = parseCsv(csvText);
        if (rows.length < 2) return hidePreview();

        // Skip header row
        const dataRows = rows.slice(1).filter(r => r.some(cell => String(cell).trim() !== ''));
        const maxRows = 10;

        previewBody.innerHTML = '';
        dataRows.slice(0, maxRows).forEach(r => {
            const tr = document.createElement('tr');
            [0, 1, 2, 3].forEach(i => {
                const td = document.createElement('td');
                td.textContent = r[i] ?? '';
                tr.appendChild(td);
            });
            previewBody.appendChild(tr);
        });

        preview.classList.remove('hidden');
    }

    // Minimal CSV parser for quoted fields
    function parseCsv(text) {
        const out = [];
        let row = [];
        let field = '';
        let i = 0;
        let inQuotes = false;

        while (i < text.length) {
            const c = text[i];

            if (inQuotes) {
                if (c === '"') {
                    const next = text[i + 1];
                    if (next === '"') {
                        field += '"';
                        i += 2;
                        continue;
                    }
                    inQuotes = false;
                    i += 1;
                    continue;
                }
                field += c;
                i += 1;
                continue;
            }

            if (c === '"') {
                inQuotes = true;
                i += 1;
                continue;
            }

            if (c === ',') {
                row.push(field);
                field = '';
                i += 1;
                continue;
            }

            if (c === '\n') {
                row.push(field);
                out.push(row);
                row = [];
                field = '';
                i += 1;
                continue;
            }

            if (c === '\r') {
                i += 1;
                continue;
            }

            field += c;
            i += 1;
        }

        // last field
        row.push(field);
        if (row.length > 1 || row[0] !== '' || out.length > 0) out.push(row);
        return out;
    }

    function escapeHtml(s) {
        return String(s ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
});
