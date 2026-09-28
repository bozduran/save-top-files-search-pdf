/**
 * Runs every `*.test.ts` file under src/ using Node's built-in test runner.
 *
 * Node 26 can execute TypeScript directly, so the suite needs no transpile step
 * and no framework: add a `foo.test.ts` next to the module it covers.
 *
 * Usage: node scripts/run-tests.mjs [pattern]
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const filter = process.argv[2];

function collectTests(directory, found = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
      continue;
    }
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectTests(absolute, found);
    } else if (entry.name.endsWith('.test.ts')) {
      found.push(absolute);
    }
  }
  return found;
}

const all = collectTests(path.join(projectRoot, 'src')).sort();
const tests = filter ? all.filter((file) => file.includes(filter)) : all;

if (!tests.length) {
  console.error(filter ? `No test files matched "${filter}"` : 'No *.test.ts files found');
  process.exit(1);
}

console.log(`Running ${tests.length} test file(s):`);
for (const file of tests) {
  console.log(`  ${path.relative(projectRoot, file)}`);
}
console.log('');

// Node 22 still needs --experimental-strip-types for the `*.test.ts` files;
// Node 23+ strips types by default and ignores the flag, so passing it is safe
// on every supported version.
const NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --no-warnings --experimental-strip-types`.trim();

const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...tests], {
  stdio: 'inherit',
  cwd: projectRoot,
  env: { ...process.env, NODE_OPTIONS },
});

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

// The sidebar runs in a webview, so its DOM behaviour is checked separately
// with happy-dom against the real webview bundle.
console.log('\nRunning webview DOM tests...');
const webview = spawnSync(process.execPath, ['scripts/test-webview.mjs'], {
  stdio: 'inherit',
  cwd: projectRoot,
  env: { ...process.env, NODE_OPTIONS },
});

if (webview.status !== 0) {
  process.exit(webview.status ?? 1);
}

// Layout checks need a real browser engine. Skip (with a notice) when Chromium
// is unavailable, so the suite still runs on a bare checkout.
if (process.env.PDF_HUB_SKIP_VISUAL === '1') {
  console.log('\nSkipping visual layout checks (PDF_HUB_SKIP_VISUAL=1).');
  process.exit(0);
}

let hasPlaywright = false;
try {
  await import('playwright');
  hasPlaywright = true;
} catch {
  hasPlaywright = false;
}

if (!hasPlaywright) {
  console.log('\nSkipping visual layout checks: playwright is not installed.');
  console.log('Install with: npm install -D playwright && npx playwright install chromium');
  process.exit(0);
}

console.log('\nRunning visual layout checks...');
const visual = spawnSync(process.execPath, ['scripts/visual-check.mjs'], {
  stdio: 'inherit',
  cwd: projectRoot,
});

process.exit(visual.status ?? 1);
