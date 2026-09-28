/**
 * Writes a tiny, valid multi-page PDF used by the smoke tests.
 * Usage: node scripts/make-test-pdf.mjs <out.pdf>
 */
import { writeFileSync } from 'node:fs';

const PAGES = [
  [
    'PDF HUB SMOKE TEST',
    'This invoice belongs to ACME Robotics.',
    'Search for the word invoice and you must find this page.',
  ],
  [
    'Second page of the sample document.',
    'An invoice total of 42 units is recorded here.',
    'The quick brown fox jumps over the lazy dog.',
  ],
  ['Appendix: no matching keyword on this page, only filler text.'],
];

function escapeText(text) {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function contentStream(lines) {
  const body = lines
    .map((line, index) => `BT /F1 14 Tf 60 ${740 - index * 24} Td (${escapeText(line)}) Tj ET`)
    .join('\n');
  return body + '\n';
}

const objects = [];
const pageObjectNumbers = PAGES.map((_, index) => 4 + index * 2);

objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
objects[2] = `<< /Type /Pages /Kids [${pageObjectNumbers
  .map((n) => `${n} 0 R`)
  .join(' ')}] /Count ${PAGES.length} >>`;
objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

PAGES.forEach((lines, index) => {
  const pageObj = pageObjectNumbers[index];
  const contentObj = pageObj + 1;
  objects[pageObj] =
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
    `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObj} 0 R >>`;
  const stream = contentStream(lines);
  objects[contentObj] = `<< /Length ${stream.length} >>\nstream\n${stream}endstream`;
});

let pdf = '%PDF-1.4\n';
const offsets = [0];
for (let i = 1; i < objects.length; i += 1) {
  offsets[i] = pdf.length;
  pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
}

const xrefOffset = pdf.length;
const count = objects.length;
pdf += `xref\n0 ${count}\n0000000000 65535 f \n`;
for (let i = 1; i < count; i += 1) {
  pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
}
pdf += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

writeFileSync(process.argv[2] ?? 'smoke.pdf', pdf, 'binary');
console.log(`wrote ${process.argv[2] ?? 'smoke.pdf'} (${pdf.length} bytes, ${PAGES.length} pages)`);
