async function extractTextWithOCR(buffer, filename = 'invoice.pdf') {
  if (!process.env.OCR_SPACE_API_KEY) {
    return null;
  }

  const formData = new FormData();
  formData.append(
    'file',
    new Blob([buffer], { type: 'application/pdf' }),
    filename
  );
  formData.append('isOverlayRequired', 'false');
  formData.append('language', 'eng');
  formData.append('filetype', 'PDF');
  formData.append('OCREngine', '2');

  const response = await fetch('https://api.ocr.space/parse/image', {
    method: 'POST',
    headers: {
      apikey: process.env.OCR_SPACE_API_KEY,
    },
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OCR failed: ${text || response.status}`);
  }

  const payload = await response.json();
  const parsedResults = Array.isArray(payload?.ParsedResults)
    ? payload.ParsedResults
    : [];

  const text = parsedResults
    .map((entry) => entry?.ParsedText || '')
    .join('\n')
    .trim();

  return text || null;
}

function isOCRConfigured() {
  return Boolean(process.env.OCR_SPACE_API_KEY);
}

module.exports = {
  extractTextWithOCR,
  isOCRConfigured,
};
