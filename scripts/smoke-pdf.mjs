/**
 * Fast, isolated check of the pdf.js setup used by `src/search/pdfText.ts`:
 * legacy ESM module, worker file URL, and page-by-page text extraction.
 *
 * Usage: node scripts/smoke-pdf.mjs [file.pdf]
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const target = process.argv[2] ?? 'fixtures/sample.pdf';

const pdfDist = path.dirname(require.resolve('pdfjs-dist/package.json'));
const mod = await import(pathToFileURL(path.join(pdfDist, 'legacy/build/pdf.mjs')).href);
mod.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(pdfDist, 'legacy/build/pdf.worker.mjs')).href;

const failures = [];
const check = (label, condition, extra = '') => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
  if (!condition) failures.push(label);
};

const data = new Uint8Array(await readFile(target));
const doc = await mod.getDocument({
  data,
  isEvalSupported: false,
  disableFontFace: true,
  useSystemFonts: false,
  standardFontDataUrl: `${pathToFileURL(path.join(pdfDist, 'standard_fonts')).href}/`,
  verbosity: 0,
}).promise;

check('document opens', doc.numPages > 0, `${doc.numPages} pages`);

const pages = [];
for (let n = 1; n <= doc.numPages; n += 1) {
  const page = await doc.getPage(n);
  const content = await page.getTextContent();
  pages.push(content.items.map((item) => (typeof item.str === 'string' ? item.str : '')).join(' '));
}
await doc.destroy();

check('page 1 text extracted', pages[0]?.includes('SMOKE TEST'));
check('keyword found on page 1', pages[0]?.toLowerCase().includes('invoice'));
check('keyword found on page 2', pages[1]?.toLowerCase().includes('invoice'));
check('keyword absent on page 3', !pages[2]?.toLowerCase().includes('invoice'));
check('no empty pages', pages.every((p) => p.trim().length > 0));

console.log('--- extracted ---');
pages.forEach((p, i) => console.log(`page ${i + 1}: ${p.slice(0, 90)}`));

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nall PDF smoke checks passed');
