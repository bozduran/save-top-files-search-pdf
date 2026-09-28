/**
 * Guards the source tree in two ways:
 *
 *  1. Relative imports must end in an explicit extension. Node executes the
 *     test files directly with type stripping, and its ESM resolver refuses to
 *     guess extensions; esbuild and tsc are both happy with `.ts` specifiers
 *     (tsc via `allowImportingTsExtensions`), so `.ts` is the one form that all
 *     three accept. Without this check a missing extension would only fail at
 *     test time with a confusing resolver error.
 *
 *  2. Every TypeScript file under src/ must be reachable from an entry point,
 *     or be covered by a test. Verified code beats unverified code: a module
 *     with no path from the entry point is either dead or untested.
 *
 * Usage: node scripts/check-imports.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function collect(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
      continue;
    }
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collect(absolute, found);
    } else if (entry.name.endsWith('.ts')) {
      found.push(absolute);
    }
  }
  return found;
}

const IMPORT_PATTERN = /^\s*(?:import|export)\s+(?!type\b)(?:[^'"]*?\sfrom\s+)?['"](\.[^'"]*)['"]/gm;
const TYPE_ONLY_PATTERN = /^\s*(?:import|export)\s+type\b/;
const DYNAMIC_PATTERN = /import\(\s*['"](\.[^'"]*)['"]\s*\)/g;

const problems = [];

for (const file of collect(path.join(projectRoot, 'src'))) {
  const contents = readFileSync(file, 'utf8');
  const lines = contents.split('\n');

  lines.forEach((line, index) => {
    if (TYPE_ONLY_PATTERN.test(line)) {
      return;
    }
    if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) {
      return;
    }
    for (const match of line.matchAll(IMPORT_PATTERN)) {
      const specifier = match[1];
      if (!specifier.endsWith('.ts')) {
        problems.push({ file, line: index + 1, specifier });
      }
    }
  });

  for (const match of contents.matchAll(DYNAMIC_PATTERN)) {
    const specifier = match[1];
    if (!specifier.endsWith('.ts')) {
      const line = contents.slice(0, match.index).split('\n').length;
      problems.push({ file, line, specifier });
    }
  }
}

// ------------------------------------------------------- reachability check

// Reachability follows every relative import, including type-only ones: a
// module imported solely for its types is still very much in use.
const ANY_IMPORT = /^\s*(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?['"](\.[^'"]*)['"]/gm;

function resolveSpecifier(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
    try {
      if (statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      /* try the next candidate */
    }
  }
  return undefined;
}

const allSourceFiles = collect(path.join(projectRoot, 'src'));
const entries = allSourceFiles.filter((file) => file.endsWith('extension.ts'));

const reached = new Set();
const queue = [...entries];
while (queue.length) {
  const file = queue.pop();
  if (reached.has(file)) {
    continue;
  }
  reached.add(file);
  const contents = readFileSync(file, 'utf8');
  for (const match of contents.matchAll(ANY_IMPORT)) {
    const resolved = resolveSpecifier(file, match[1]);
    if (resolved && !reached.has(resolved)) {
      queue.push(resolved);
    }
  }
}

const unreachable = allSourceFiles.filter(
  (file) => !reached.has(file) && !file.endsWith('.test.ts')
);

// ------------------------------------------------------------------ reporting

if (problems.length || unreachable.length) {
  if (problems.length) {
    console.error(`Found ${problems.length} relative import(s) without an explicit extension:\n`);
    for (const problem of problems) {
      console.error(`  ${path.relative(projectRoot, problem.file)}:${problem.line}  "${problem.specifier}"`);
    }
    console.error('\nUse the .ts extension so Node can run the file directly in tests.\n');
  }
  if (unreachable.length) {
    console.error(`Found ${unreachable.length} module(s) no entry point imports:\n`);
    for (const file of unreachable) {
      console.error(`  ${path.relative(projectRoot, file)}`);
    }
    console.error('\nEither wire the module up or cover it with a *.test.ts file.\n');
  }
  process.exit(1);
}

console.log(
  `Import check passed: explicit extensions everywhere, ${allSourceFiles.length - entries.length} ` +
    `source file(s) reachable from ${entries.length} entry point(s).`
);
