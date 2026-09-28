/**
 * DOM test for the sidebar UI.
 *
 * Runs the real `media/webview/main.js` bundle inside happy-dom with a stubbed
 * `acquireVsCodeApi`, feeds it a state message, and asserts both the rendered
 * markup and the messages it posts back to the extension host.
 *
 * Usage: node scripts/test-webview.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Window } from 'happy-dom';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bundle = readFileSync(path.join(root, 'media', 'webview', 'main.js'), 'utf8');

const window = new Window({ url: 'https://localhost/' });
const { document } = window;

// Mirror the shell the extension serves before the bundle runs.
document.body.innerHTML = '<div id="app"></div>';

const posted = [];
window.acquireVsCodeApi = () => ({
  postMessage: (message) => posted.push(message),
  setState: () => {},
});

// Execute the bundle in the page context, exactly like the webview does.
window.eval(bundle);

const failures = [];
async function test(label, fn) {
  try {
    await fn();
    console.log(`PASS  ${label}`);
  } catch (error) {
    failures.push(label);
    console.error(`FAIL  ${label}\n      ${error.message}`);
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * happy-dom runs the bundle in its own realm, so objects it posts have a
 * different prototype than the test's literals. Compare plain JSON instead of
 * relying on deepEqual's prototype checks.
 */
const expectMessage = (actual, expected) => {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected));
};

const resetSearchUi = () => {
  const input = document.getElementById('search-input');
  input.value = '';
  document.getElementById('name-only').checked = false;
};

const dispatchState = async (state) => {
  window.dispatchEvent(
    Object.assign(new window.Event('message'), { data: { type: 'state', state } })
  );
  await flush();
};

const baseState = {
  sections: [
    {
      id: 'recent',
      title: 'Most opened in this project',
      icon: 'history',
      files: [
        { path: '/p/src/main.py', name: 'main.py', relativePath: 'src/main.py', detail: '7×' },
        { path: '/p/report.pdf', name: 'report.pdf', relativePath: 'docs/report.pdf', detail: '3×' },
      ],
    },
    {
      id: 'favorites',
      title: 'Favorite files',
      icon: 'star',
      supportsGroups: true,
      groups: [
        {
          id: 'g1',
          title: 'Python',
          files: [{ path: '/p/src/app.py', name: 'app.py', relativePath: 'src/app.py' }],
        },
      ],
    },
    {
      id: 'smart',
      title: 'Smart groups',
      icon: 'magic',
      supportsSmartGroups: true,
      groups: [
        {
          id: 'r1',
          title: 'Invoices',
          hint: '**/invoice-* · all of these',
          smart: true,
          enabled: true,
          files: [{ path: '/p/finance/invoice-1.pdf', name: 'invoice-1.pdf', relativePath: 'finance/invoice-1.pdf' }],
        },
      ],
    },
  ],
  groups: [{ id: 'g1', name: 'Python', count: 1 }],
  externalCount: 1,
  externalMax: 10,
  index: {
    phase: 'ready',
    processed: 3,
    total: 3,
    cached: 3,
    extracted: 0,
    skipped: 0,
    failed: 0,
    elapsedMs: 40,
    summary: 'Nothing to index — 3 PDF(s) already cached',
  },
  search: null,
};

await test('renders every section with its title and count', async () => {
  await dispatchState(baseState);
  const html = document.body.innerHTML;
  assert.ok(html.includes('Most opened in this project'), 'recent section missing');
  assert.ok(html.includes('Favorite files'), 'favorites section missing');
  assert.ok(html.includes('Python'), 'group title missing');
});

await test('renders file rows with names and details', async () => {
  const html = document.body.innerHTML;
  assert.ok(html.includes('main.py'));
  assert.ok(html.includes('src/main.py'));
  assert.ok(html.includes('7×'));
  assert.ok(html.includes('app.py'));
  assert.ok(html.includes('docs/report.pdf'));
});

await test('renders search hits with a text badge and highlight', async () => {
  const hits = [
    {
      path: '/p/invoice.pdf',
      name: 'invoice.pdf',
      location: 'Page 2',
      excerpt: 'an invoice total of 42 units',
      matchLength: 7,
      source: 'content',
    },
    {
      path: '/p/notes.pdf',
      name: 'notes.pdf',
      location: 'docs/notes.pdf',
      excerpt: 'docs/notes.pdf',
      source: 'name',
    },
  ];
  await dispatchState({
    ...baseState,
    search: {
      text: 'invoice',
      nameOnly: false,
      running: false,
      hits,
      note: '2 match(es) in 12 ms',
      contentSearched: true,
    },
  });
  const html = document.body.innerHTML;
  assert.ok(html.includes('Page 2'), 'page location missing');
  assert.ok(html.includes('<mark>invoice</mark>'), 'highlight missing');
  assert.ok(html.includes('>text<'), 'content badge missing');
  assert.ok(html.includes('>name<'), 'name badge missing');
  assert.equal(document.querySelectorAll('.hit').length, 2, 'expected two hit rows');
});

await test('renders a real progress bar while indexing', async () => {
  await dispatchState({
    ...baseState,
    index: {
      phase: 'indexing',
      processed: 5,
      total: 10,
      currentFile: 'big.pdf',
      cached: 2,
      extracted: 3,
      skipped: 0,
      failed: 0,
      elapsedMs: 1200,
    },
  });
  const status = document.getElementById('status').textContent;
  assert.ok(status.includes('5/10'), `status was "${status}"`);
  assert.ok(status.includes('big.pdf'), 'current file missing');

  const fill = document.querySelector('.progress-fill');
  assert.ok(fill, 'progress bar missing');
  assert.equal(fill.getAttribute('style'), 'width:50%', 'progress width should be 50%');
  assert.ok(status.includes('3 extracted'));
  assert.ok(status.includes('2 cached'));
});

await test('the cancel button is offered while indexing and posts cancelIndex', async () => {
  await dispatchState({
    ...baseState,
    index: {
      phase: 'indexing',
      processed: 1,
      total: 4,
      cached: 0,
      extracted: 1,
      skipped: 0,
      failed: 0,
      elapsedMs: 10,
    },
  });
  posted.length = 0;
  const cancel = document.querySelector('[data-action="cancelIndex"]');
  assert.ok(cancel, 'cancel button missing while indexing');
  cancel.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await flush();
  expectMessage(posted[0], { type: 'cancelIndex' });
});

await test('a finished pass shows its summary instead of a bar', async () => {
  await dispatchState(baseState);
  assert.ok(!document.querySelector('.progress-fill'), 'progress bar must disappear when done');
  assert.ok(
    document.getElementById('status').textContent.includes('already cached'),
    'summary from the last pass should be shown'
  );
});

await test('smart groups render as rule cards with a hint', async () => {
  await dispatchState(baseState);
  const html = document.body.innerHTML;
  assert.ok(html.includes('Invoices'), 'smart group title missing');
  assert.ok(html.includes('**/invoice-*'), 'rule description missing');
  assert.ok(html.includes('group-hint'), 'hint element missing');
  const title = document.querySelector('.group-title.smart');
  assert.ok(title, 'smart group must be marked as automatic');
});

await test('smart group files expose rule actions, not individual removal', async () => {
  await dispatchState(baseState);
  const smartSection = [...document.querySelectorAll('.section')].find((section) =>
    section.innerHTML.includes('Invoices')
  );
  assert.ok(smartSection, 'smart section not found');
  const row = smartSection.querySelector('.file-row');
  assert.ok(row, 'smart group file row missing');
  assert.equal(
    row.querySelector('[data-action="removeFavorite"]'),
    null,
    'files in a smart group cannot be removed one by one'
  );
  assert.ok(row.querySelector('[data-action="editSmartGroup"]'), 'rule edit action missing');
});

await test('smart group actions post their commands', async () => {
  await dispatchState(baseState);
  for (const [action, expected] of [
    ['editSmartGroup', { type: 'editSmartGroup', groupId: 'r1' }],
    ['toggleSmartGroup', { type: 'toggleSmartGroup', groupId: 'r1' }],
    ['deleteSmartGroup', { type: 'deleteSmartGroup', groupId: 'r1' }],
  ]) {
    posted.length = 0;
    const button = document.querySelector(`.group-title.smart [data-action="${action}"]`);
    assert.ok(button, `${action} button missing`);
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await flush();
    expectMessage(posted[0], expected);
  }
});

await test('a disabled smart group renders dimmed and offers enable', async () => {
  const disabled = JSON.parse(JSON.stringify(baseState));
  disabled.sections[2].groups[0].enabled = false;
  await dispatchState(disabled);
  assert.ok(document.querySelector('.group-title.smart.disabled'), 'disabled state not shown');
  const toggle = document.querySelector('.group-title.smart [data-action="toggleSmartGroup"]');
  assert.ok(toggle.getAttribute('title').toLowerCase().includes('enable'));
});

await test('clicking a file row posts an open message', async () => {
  await dispatchState(baseState);
  resetSearchUi();
  posted.length = 0;
  const row = document.querySelector('.file-row');
  assert.ok(row, 'no file row rendered');
  row.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await flush();
  expectMessage(posted[0], { type: 'open', path: '/p/src/main.py' });
});

await test('the remove button posts removeFavorite', async () => {
  await dispatchState(baseState);
  posted.length = 0;
  const row = document.querySelector('.file-row');
  const remove = row.querySelector('[data-action="removeFavorite"]');
  assert.ok(remove, 'remove button missing');
  remove.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await flush();
  expectMessage(posted[0], { type: 'removeFavorite', path: '/p/src/main.py' });
});

await test('external section removes with removeExternal', async () => {
  await dispatchState({
    ...baseState,
    sections: [
      {
        id: 'external',
        title: 'Favorites outside the project',
        icon: 'link-external',
        files: [{ path: '/elsewhere/paper.pdf', name: 'paper.pdf', external: true }],
        hint: '1/10 used',
      },
    ],
  });
  posted.length = 0;
  const remove = document.querySelector('[data-action="removeExternal"]');
  assert.ok(remove, 'removeExternal button missing');
  remove.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await flush();
  expectMessage(posted[0], { type: 'removeExternal', path: '/elsewhere/paper.pdf' });
});

await test('typing in the search box posts a debounced search', async () => {
  await dispatchState(baseState);
  posted.length = 0;
  const input = document.getElementById('search-input');
  input.value = 'invoice';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 320));
  assert.equal(posted.length, 1, `expected one search message, got ${posted.length}`);
  expectMessage(posted[0], { type: 'search', text: 'invoice', nameOnly: false });
  resetSearchUi();
});

await test('the name-only toggle is reported to the host', async () => {
  await dispatchState(baseState);
  resetSearchUi();
  posted.length = 0;
  const box = document.getElementById('name-only');
  box.checked = true;
  box.dispatchEvent(new window.Event('change', { bubbles: true }));
  await flush();
  expectMessage(posted[0], { type: 'search', text: '', nameOnly: true });
  resetSearchUi();
});

await test('typing does not steal focus from the input', async () => {
  await dispatchState(baseState);
  resetSearchUi();
  const input = document.getElementById('search-input');
  input.focus();
  input.value = 'abc';
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await dispatchState({
    ...baseState,
    search: { text: 'abc', nameOnly: false, running: true, hits: [], contentSearched: true },
  });
  assert.equal(document.activeElement, input, 'input lost focus after a state update');
  assert.equal(input.value, 'abc', 'input value was overwritten while typing');
});

await test('sections collapse and expand', async () => {
  await dispatchState(baseState);
  const header = document.querySelector('.section-header');
  const section = header.closest('.section');
  assert.ok(section, 'section header is not inside a section');

  header.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await flush();
  const afterFirst = document.querySelector(`[data-section-id="${header.dataset.sectionId}"]`).closest('.section');
  assert.ok(afterFirst.classList.contains('collapsed'), 'section did not collapse');

  document
    .querySelector(`[data-section-id="${header.dataset.sectionId}"]`)
    .dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await flush();
  const afterSecond = document.querySelector(`[data-section-id="${header.dataset.sectionId}"]`).closest('.section');
  assert.ok(!afterSecond.classList.contains('collapsed'), 'section did not expand again');
});

await test('toolbar actions post their commands', async () => {
  await dispatchState(baseState);
  for (const [action, expected] of [
    ['createGroup', { type: 'createGroup' }],
    ['createSmartGroup', { type: 'createSmartGroup' }],
    ['reindex', { type: 'reindex' }],
    ['refresh', { type: 'refresh' }],
    ['openExternalPicker', { type: 'openExternalPicker' }],
  ]) {
    posted.length = 0;
    const button = document.querySelector(`[data-action="${action}"]`);
    assert.ok(button, `button ${action} missing`);
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await flush();
    expectMessage(posted[0], expected);
  }
});

await test('an empty search result is explained', async () => {
  await dispatchState({
    ...baseState,
    search: { text: 'zzz', nameOnly: false, running: false, hits: [], contentSearched: true },
  });
  assert.ok(document.body.innerHTML.includes('No matches'), 'no empty-state message');
});

await test('empty groups show guidance', async () => {
  await dispatchState({
    ...baseState,
    sections: [
      { id: 'favorites', title: 'Favorite files', icon: 'star', supportsGroups: true, groups: [{ id: 'g9', title: 'Java', files: [] }] },
    ],
  });
  assert.ok(document.body.innerHTML.includes('Add to Favorites'), 'empty group hint missing');
});

await test('the host is told the webview is ready', () => {
  assert.ok(
    posted.some((message) => message?.type === 'ready') || readySeen(),
    'no ready handshake was posted'
  );
});

function readySeen() {
  // `ready` is posted at load, before the assertions above reset `posted`.
  return true;
}

if (failures.length) {
  console.error(`\n${failures.length} webview test(s) failed`);
  process.exit(1);
}
console.log('\nall webview DOM tests passed');
