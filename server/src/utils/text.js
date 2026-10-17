import escapeHtml from 'escape-html';

export function sanitizeText(input) {
  if (typeof input !== 'string') return '';
  return escapeHtml(input).replace(/\u0000/g, '').trim();
}

export function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}
