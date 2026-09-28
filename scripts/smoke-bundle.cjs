/**
 * Integration smoke test against the real build output.
 *
 * Loads `dist/extension.js` with a stubbed `vscode` module, calls `activate()`,
 * then drives the actual bundled PDF extraction path on the sample PDF, so
 * bundling or asset-copying problems are caught without launching VS Code.
 *
 * Usage: node scripts/smoke-bundle.cjs
 */
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');

const stub = require('./vscode-stub.cjs');

// Intercept `require('vscode')` before loading the bundle.
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === 'vscode') {
    return path.join(__dirname, 'vscode-stub.cjs');
  }
  return originalResolve.call(this, request, ...rest);
};

const failures = [];
function check(label, condition, extra = '') {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${extra ? ` — ${extra}` : ''}`);
  if (!condition) failures.push(label);
}

(async () => {
  const root = path.join(__dirname, '..');
  const bundlePath = path.join(root, 'dist', 'extension.js');
  check('bundle exists', fs.existsSync(bundlePath), 'dist/extension.js');
  check(
    'pdf.js worker asset copied',
    fs.existsSync(path.join(root, 'dist', 'pdf.worker.mjs')),
    'dist/pdf.worker.mjs'
  );
  check(
    'standard font asset copied',
    fs.existsSync(path.join(root, 'dist', 'standard_fonts', 'LiberationSans-Regular.ttf'))
  );
  check('webview bundle exists', fs.existsSync(path.join(root, 'media', 'webview', 'main.js')));

  const ext = require(bundlePath);
  check('activate exported', typeof ext.activate === 'function');
  check('deactivate exported', typeof ext.deactivate === 'function');

  const api = await ext.activate(stub.__context);
  check('activate() returns the public API', Boolean(api));
  check('api.registerSearchProvider is callable', typeof api.registerSearchProvider === 'function');
  check('api.registerSectionProvider is callable', typeof api.registerSectionProvider === 'function');
  check('api.hook is callable', typeof api.hook === 'function');
  check('api.version present', typeof api.version === 'string', api.version);

  const disposable = api.registerSearchProvider({
    id: 'test-provider',
    label: 'Test',
    order: 0,
    search: async () => ({ providerId: 'test-provider', label: 'Test', hits: [] }),
  });
  check('third-party search provider registers', typeof disposable?.dispose === 'function');
  disposable.dispose();

  const sectionDisposable = api.registerSectionProvider({
    id: 'test-section',
    label: 'Test section',
    getSections: async () => [{ id: 'test-section', title: 'Test', items: [] }],
  });
  check('third-party section provider registers', typeof sectionDisposable?.dispose === 'function');
  sectionDisposable.dispose();

  const groupId = api.createGroup('Smoke Group');
  check('createGroup returns an id', typeof groupId === 'string' && groupId.length > 0);
  check('getGroups lists the new group', api.getGroups().some((g) => g.id === groupId));

  // ---- smart groups (auto-collections) ----
  const ruleId = api.createSmartGroup('Smoke Invoices', { includeGlobs: ['**/invoice-*'] });
  check('createSmartGroup returns an id', typeof ruleId === 'string' && ruleId.length > 0);
  const listed = api.listSmartGroups();
  check('listSmartGroups reports the rule', listed.some((rule) => rule.id === ruleId));
  check(
    'smart group description is derived from the rule',
    typeof listed.find((rule) => rule.id === ruleId)?.name === 'string'
  );

  // ---- persistent, incremental index over a real PDF ----
  // The stub reports this file as the only PDF in the workspace, so discovery,
  // indexing and persistence all run exactly as they would in the editor.
  const pdfPath = path.join(root, 'fixtures', 'sample.pdf');
  stub.__pdfFiles = [pdfPath];

  const first = await api.reindex();
  check('reindex returns a phase', typeof first.phase === 'string', first.phase);
  check('the sample PDF is discovered and extracted', first.extracted === 1, `extracted=${first.extracted}`);

  const second = await api.reindex();
  check(
    'a second pass over an unchanged PDF extracts nothing',
    second.extracted === 0,
    `extracted=${second.extracted}, cached=${second.cached}`
  );

  const found = await api.__test.findPdfFiles();
  check('discovery finds the PDF through the workspace API', found.length === 1, `found ${found.length}`);

  // A forced rebuild must re-extract, proving the cache is really dropped.
  const rebuilt = await api.reindex({ force: true });
  check('a forced rebuild re-extracts the PDF', rebuilt.extracted === 1, `extracted=${rebuilt.extracted}`);

  // ---- the important part: the packaged PDF pipeline ----
  const pdfBytes = new Uint8Array(await fs.promises.readFile(path.join(root, 'fixtures', 'sample.pdf')));
  const pages = await api.__test.extractPdfText(pdfBytes);
  check('bundled pdf.js extracts 3 pages', pages.length === 3, `got ${pages.length}`);
  check('page 1 text correct', /SMOKE TEST/i.test(pages[0] ?? ''), (pages[0] ?? '').slice(0, 60));
  check('keyword searchable on page 1', /invoice/i.test(pages[0] ?? ''));
  check('keyword searchable on page 2', /invoice/i.test(pages[1] ?? ''));
  check('keyword absent on page 3', !/invoice/i.test(pages[2] ?? ''));

  if (failures.length) {
    console.error(`\n${failures.length} bundle check(s) failed`);
    process.exit(1);
  }
  console.log('\nall bundle smoke checks passed');
})().catch((error) => {
  console.error('bundle smoke test crashed:', error);
  process.exit(1);
});
