const SPACED_LABELS = [
  ['I N V O I C E', 'INVOICE'],
  ['I N V', 'INV'],
  ['T O T A L', 'TOTAL'],
  ['A M O U N T', 'AMOUNT'],
  ['D A T E', 'DATE'],
  ['V E N D O R', 'VENDOR'],
  ['S U B T O T A L', 'SUBTOTAL'],
];

function preprocessText(rawText) {
  const originalText = String(rawText || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ');

  let normalizedText = originalText
    .replace(/[ \t]+/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/[•·]/g, ' ')
    .replace(/[|¦]/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+([:;,])/g, '$1')
    .replace(/([#$€£₹])\s+(?=\d)/g, '$1')
    .replace(/(?<=\d)\s+(?=[€£₹$])/g, '')
    .trim();

  normalizedText = normalizedText
    .replace(/(\d{1,2}\/\d{1,2}\/\d{2,3})\s+(\d{1,2}\b)/g, '$1$2')
    .replace(/(\d{1,2}-\d{1,2}-\d{2,3})\s+(\d{1,2}\b)/g, '$1$2')
    .replace(/(\d{4}-\d{2})\s+(\d{1,2}\b)/g, '$1-$2');

  for (const [spacedLabel, compactLabel] of SPACED_LABELS) {
    const pattern = new RegExp(spacedLabel.replaceAll(' ', '\\s*'), 'gi');
    normalizedText = normalizedText.replace(pattern, compactLabel);
  }

  normalizedText = normalizedText
    .replace(/\b([A-Z])\s+([A-Z])\s+([A-Z])\b/g, '$1$2$3')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]+\n/g, '\n');

  const lines = normalizedText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const metrics = analyzeTextQuality(normalizedText, lines);

  return {
    originalText,
    normalizedText,
    lines,
    metrics,
  };
}

function analyzeTextQuality(text, lines) {
  const alphaMatches = text.match(/[A-Za-z]/g) || [];
  const digitMatches = text.match(/\d/g) || [];
  const wordMatches = text.match(/[A-Za-z]{2,}/g) || [];
  const amountLikeMatches = text.match(/[$€£₹]?\s*\d[\d.,]*/g) || [];

  return {
    length: text.length,
    lineCount: lines.length,
    alphaCount: alphaMatches.length,
    digitCount: digitMatches.length,
    wordCount: wordMatches.length,
    amountLikeCount: amountLikeMatches.length,
  };
}

function assessTextReadability(processedText, inputType) {
  const { normalizedText, lines, metrics } = processedText;
  const issues = [];
  let readable = true;

  if (!normalizedText.trim() || metrics.wordCount < 3 || metrics.length < 20) {
    readable = false;
    issues.push('No readable text found.');
  }

  if (
    inputType === 'pdf' &&
    (metrics.wordCount < 8 || metrics.alphaCount < 30 || lines.length < 2)
  ) {
    readable = false;
    issues.push('Likely scanned or image-only document.');
  }

  return {
    readable,
    issues: [...new Set(issues)],
  };
}

module.exports = {
  preprocessText,
  assessTextReadability,
};
