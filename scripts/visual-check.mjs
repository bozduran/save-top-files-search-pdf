/**
 * Visual regression checks for the sidebar.
 *
 * Renders the real webview bundle in headless Chromium and asserts layout
 * invariants that unit tests cannot see (control sizes, overflow, icon
 * scaling). The bug this was written for: the clear button inherited the user
 * agent's `padding: 1px 6px`, so its 12px icon overflowed a 6px content box and
 * rendered about three times too large.
 *
 * Requires Chromium: `npx playwright install chromium`
 * Run directly with:   node scripts/visual-check.mjs [outDir]
 * Skip via env:        PDF_HUB_SKIP_VISUAL=1
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.resolve(process.argv[2] ?? path.join(root, '.visual'));
mkdirSync(outDir, { recursive: true });

const bundle = readFileSync(path.join(root, 'media', 'webview', 'main.js'), 'utf8');
const cssPath = process.env.PDF_HUB_CSS ?? path.join(root, 'media', 'webview', 'main.css');
const css = readFileSync(cssPath, 'utf8');

/** Approximation of the VS Code dark palette. */
const THEME = `
  --vscode-font-family: -apple-system, 'Segoe UI', Ubuntu, sans-serif;
  --vscode-font-size: 13px;
  --vscode-foreground: #cccccc;
  --vscode-sideBar-background: #1f1f1f;
  --vscode-input-background: #313131;
  --vscode-input-foreground: #cccccc;
  --vscode-input-border: #3c3c3c;
  --vscode-focusBorder: #007fd4;
  --vscode-list-hoverBackground: #2a2d2e;
  --vscode-toolbar-hoverBackground: rgba(90, 93, 94, 0.31);
  --vscode-badge-background: #4d4d4d;
  --vscode-badge-foreground: #ffffff;
  --vscode-progressBar-background: #0e70c0;
  --vscode-editorWidget-background: #252526;
  --vscode-editorWidget-border: #454545;
  --vscode-charts-red: #e05252;
  --vscode-charts-purple: #b180d7;
  --vscode-sideBarSectionHeader-border: rgba(128, 128, 128, 0.2);
`;

const BASE_STATE = {
  sections: [
    {
      id: 'recent',
      title: 'Most opened in this project',
      icon: 'history',
      files: [
        { path: '/p/src/main.py', name: 'main.py', relativePath: 'src/main.py', detail: '7x' },
        { path: '/p/docs/report.pdf', name: 'report.pdf', relativePath: 'docs/report.pdf', detail: '3x' },
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
      icon: 'wand',
      supportsSmartGroups: true,
      groups: [
        {
          id: 'r1',
          title: 'Invoices',
          hint: '**/invoice-* - all of these',
          smart: true,
          enabled: true,
          files: [
            {
              path: '/p/finance/invoice-1.pdf',
              name: 'invoice-1.pdf',
              relativePath: 'finance/invoice-1.pdf',
            },
          ],
        },
      ],
    },
  ],
  groups: [{ id: 'g1', name: 'Python', count: 1 }],
  externalCount: 0,
  externalMax: 10,
  index: {
    phase: 'ready',
    processed: 1,
    total: 1,
    cached: 1,
    extracted: 0,
    skipped: 0,
    failed: 0,
    elapsedMs: 980,
    summary: 'Indexed 1 file(s) in 1s',
  },
  search: null,
};

const SEARCHING_STATE = {
  ...BASE_STATE,
  search: {
    text: 'invoice',
    nameOnly: false,
    running: false,
    contentSearched: true,
    note: '2 match(es) in 12 ms',
    hits: [
      {
        path: '/p/finance/invoice-1.pdf',
        name: 'invoice-1.pdf',
        location: 'Page 2',
        excerpt: 'an invoice total of 42 units is recorded here',
        matchLength: 7,
        source: 'content',
      },
    ],
  },
  index: {
    phase: 'indexing',
    processed: 5,
    total: 10,
    currentFile: 'annual-report-2026.pdf',
    cached: 2,
    extracted: 3,
    skipped: 0,
    failed: 0,
    elapsedMs: 1400,
  },
};

const failures = [];
const check = (label, condition, detail = '') => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` - ${detail}` : ''}`);
  if (!condition) {
    failures.push(label);
  }
};

const browser = await chromium.launch();

for (const width of [260, 340, 480]) {
  const page = await browser.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: 2 });

  for (const [scenario, state] of [
    ['idle', BASE_STATE],
    ['searching', SEARCHING_STATE],
  ]) {
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  ${css}
  :root { ${THEME} }
  body { background: var(--vscode-sideBar-background); margin: 0; }
</style></head>
<body><div id="app"></div>
<script>window.acquireVsCodeApi = () => ({ postMessage: () => {}, setState: () => {} });</script>
<script>${bundle}</script>
<script>window.dispatchEvent(new MessageEvent('message', { data: { type: 'state', state: ${JSON.stringify(
      state
    )} } }));</script>
</body></html>`;

    const file = path.join(outDir, `${scenario}-${width}.html`);
    writeFileSync(file, html);
    await page.goto(pathToFileURL(file).href);
    await page.waitForTimeout(100);

    const metrics = await page.evaluate(() => {
      const box = (node) => {
        const rect = node.getBoundingClientRect();
        return {
          w: rect.width,
          h: rect.height,
          top: rect.top,
          bottom: rect.bottom,
          right: rect.right,
        };
      };
      const clear = document.querySelector('.search-row .clear');
      const input = document.getElementById('search-input');
      const clearStyle = clear ? getComputedStyle(clear) : null;
      const clearIcon = clear ? clear.querySelector('svg') : null;

      return {
        clearBox: clear ? box(clear) : null,
        inputBox: input ? box(input) : null,
        clearPadding: clearStyle ? clearStyle.padding : null,
        clearContentWidth: clear
          ? clear.getBoundingClientRect().width -
            parseFloat(clearStyle.paddingLeft) -
            parseFloat(clearStyle.paddingRight) -
            parseFloat(clearStyle.borderLeftWidth) -
            parseFloat(clearStyle.borderRightWidth)
          : null,
        iconBox: clearIcon ? box(clearIcon) : null,
        // Only real buttons (not their svg children), and only the ones that
        // are actually laid out: row action buttons are display:none until hover.
        tinyButtons: [
          ...document.querySelectorAll(
            'button.icon-button, button.search-row-clear, .search-row button.clear, .toolbar button, .section-header button'
          ),
        ]
          .filter((node) => node.getBoundingClientRect().width > 0)
          .map((node) => ({ cls: String(node.className), ...box(node) })),
        bodyScrollWidth: document.body.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });

    const label = `${scenario} @${width}px`;
    check(
      `${label}: clear button has no inherited padding`,
      metrics.clearPadding === '0px',
      metrics.clearPadding || 'missing'
    );
    check(
      `${label}: clear icon fits inside its content box`,
      metrics.clearContentWidth !== null &&
        metrics.iconBox !== null &&
        metrics.iconBox.w <= metrics.clearContentWidth + 0.5,
      `icon ${metrics.iconBox ? metrics.iconBox.w : '?'}px in ${metrics.clearContentWidth}px`
    );
    check(
      `${label}: clear button is not larger than a toolbar button`,
      Boolean(metrics.clearBox) && metrics.clearBox.w <= 22 && metrics.clearBox.h <= 22,
      `${metrics.clearBox ? metrics.clearBox.w : '?'}x${metrics.clearBox ? metrics.clearBox.h : '?'}`
    );
    check(
      `${label}: clear button stays inside the search field`,
      Boolean(metrics.clearBox && metrics.inputBox) &&
        metrics.clearBox.right <= metrics.inputBox.right &&
        metrics.clearBox.top >= metrics.inputBox.top &&
        metrics.clearBox.bottom <= metrics.inputBox.bottom,
      `clear right=${Math.round(metrics.clearBox ? metrics.clearBox.right : 0)} vs input right=${Math.round(
        metrics.inputBox ? metrics.inputBox.right : 0
      )}`
    );
    check(
      `${label}: no control overflows the sidebar`,
      metrics.bodyScrollWidth <= metrics.viewportWidth,
      `${metrics.bodyScrollWidth} > ${metrics.viewportWidth}`
    );
    check(
      `${label}: every visible icon button stays within 8-24px`,
      metrics.tinyButtons.length >= 5 &&
        metrics.tinyButtons.every(
          (button) => button.w >= 8 && button.w <= 24 && button.h >= 8 && button.h <= 24
        ),
      metrics.tinyButtons.map((button) => `${button.w.toFixed(0)}x${button.h.toFixed(0)}`).join(', ')
    );

    await page.screenshot({ path: path.join(outDir, `${scenario}-${width}.png`), fullPage: true });
  }

  await page.close();
}

await browser.close();

if (failures.length) {
  console.error(`\n${failures.length} visual check(s) failed. Screenshots: ${outDir}`);
  process.exit(1);
}
console.log(`\nall visual layout checks passed (screenshots in ${outDir})`);
