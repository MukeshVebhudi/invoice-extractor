const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

async function extractInvoiceWithAI(rawText, existingResult) {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  const prompt = [
    'Extract invoice data from the text below.',
    'Return strict JSON with keys: invoiceNumber, date, amount.',
    'Use empty strings for missing values.',
    'Dates should be normalized to YYYY-MM-DD when possible.',
    'Amounts should be normalized to digits with optional currency prefix and 2 decimals.',
    '',
    'Current extraction:',
    JSON.stringify(existingResult),
    '',
    'Invoice text:',
    rawText.slice(0, 12000),
  ].join('\n');

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      response_format: { type: 'json_object' },
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: 'You extract invoice fields and respond with JSON only.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AI extraction failed: ${text || response.status}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;

  if (!content) {
    return null;
  }

  try {
    const parsed = JSON.parse(content);
    return {
      invoiceNumber: String(parsed.invoiceNumber || '').trim(),
      date: String(parsed.date || '').trim(),
      amount: String(parsed.amount || '').trim(),
    };
  } catch {
    return null;
  }
}

function isAIConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

module.exports = {
  extractInvoiceWithAI,
  isAIConfigured,
};
