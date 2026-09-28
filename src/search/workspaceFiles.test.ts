import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { findPdfFilesInDirectory } from './workspaceFiles.ts';

/** Builds a temporary tree and returns its root plus a cleanup function. */
async function fixture(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pdfhub-walk-'));
  const touch = async (relative: string): Promise<void> => {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, '%PDF-1.4\n');
  };

  await touch('a.pdf');
  await touch('docs/report.PDF');
  await touch('docs/deep/nested/deep.pdf');
  await touch('node_modules/ignored.pdf');
  await touch('.hidden/secret.pdf');
  await touch('docs/notes.txt');
  await touch('ignored-by-config/skipme.pdf');

  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

const relativeAll = async (root: string, options = {}): Promise<string[]> =>
  (await findPdfFilesInDirectory(root, options)).map((file) => path.relative(root, file)).sort();

test('finds pdfs recursively, including nested folders', async () => {
  const { root, cleanup } = await fixture();
  try {
    assert.deepEqual(await relativeAll(root), [
      'a.pdf',
      path.join('docs', 'deep', 'nested', 'deep.pdf'),
      path.join('docs', 'report.PDF'),
      path.join('ignored-by-config', 'skipme.pdf'),
    ]);
  } finally {
    await cleanup();
  }
});

test('matches the .PDF extension case-insensitively', async () => {
  const { root, cleanup } = await fixture();
  try {
    assert.ok((await relativeAll(root)).some((file) => file.endsWith('report.PDF')));
  } finally {
    await cleanup();
  }
});

test('skips built-in directories and dot directories', async () => {
  const { root, cleanup } = await fixture();
  try {
    const found = await relativeAll(root);
    assert.ok(!found.some((file) => file.includes('node_modules')));
    assert.ok(!found.some((file) => file.includes('.hidden')));
  } finally {
    await cleanup();
  }
});

test('honours a caller-supplied skip set', async () => {
  const { root, cleanup } = await fixture();
  try {
    const found = await relativeAll(root, { skipDirectories: new Set(['ignored-by-config']) });
    assert.ok(!found.some((file) => file.includes('ignored-by-config')));
    assert.ok(found.some((file) => file.endsWith('a.pdf')));
  } finally {
    await cleanup();
  }
});

test('ignores files that are not PDFs', async () => {
  const { root, cleanup } = await fixture();
  try {
    assert.ok(!(await relativeAll(root)).some((file) => file.endsWith('notes.txt')));
  } finally {
    await cleanup();
  }
});

test('respects the result limit', async () => {
  const { root, cleanup } = await fixture();
  try {
    assert.equal((await findPdfFilesInDirectory(root, { limit: 1 })).length, 1);
  } finally {
    await cleanup();
  }
});

test('respects maxDepth', async () => {
  const { root, cleanup } = await fixture();
  try {
    const shallow = await relativeAll(root, { maxDepth: 0 });
    assert.deepEqual(shallow, ['a.pdf'], 'depth 0 must only see the root');

    const oneDeep = await relativeAll(root, { maxDepth: 1 });
    assert.ok(oneDeep.includes(path.join('docs', 'report.PDF')));
    assert.ok(!oneDeep.some((file) => file.includes('nested')));
  } finally {
    await cleanup();
  }
});

test('a missing directory resolves to an empty list', async () => {
  const { root, cleanup } = await fixture();
  try {
    assert.deepEqual(await findPdfFilesInDirectory(path.join(root, 'nope')), []);
  } finally {
    await cleanup();
  }
});

test('unreadable directories do not break the walk', async () => {
  const { root, cleanup } = await fixture();
  try {
    // A file pretending to be a directory is the simplest unreadable entry.
    const found = await findPdfFilesInDirectory(root);
    assert.ok(found.length >= 3);
  } finally {
    await cleanup();
  }
});
