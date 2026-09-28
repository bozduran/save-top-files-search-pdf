/**
 * Loads TypeScript modules directly in Node, for tests.
 *
 * Files are bundled with esbuild (each with its own cache keyed by content), so
 * tests import the real source instead of a copy, and no compile step is needed
 * before running them.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

export const projectRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

const cache = new Map();

/**
 * Imports a project TypeScript file as ESM.
 *
 * @param {string} relativePath path relative to the project root
 * @returns {Promise<any>} the module namespace
 */
export async function loadModule(relativePath) {
  const absolute = path.isAbsolute(relativePath)
    ? relativePath
    : path.join(projectRoot, relativePath);

  const source = await readFile(absolute, 'utf8');
  const key = createHash('sha1').update(absolute).update(source).digest('hex');
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const result = await esbuild.build({
    entryPoints: [absolute],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    write: false,
    logLevel: 'silent',
  });

  const code = result.outputFiles[0].text;
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
  );
  cache.set(key, module);
  return module;
}

/**
 * Compiles an inline TypeScript snippet to ESM and imports it.
 * Useful for building a tiny harness around a module under test.
 */
export async function loadInline(code) {
  const result = await esbuild.build({
    stdin: { contents: code, loader: 'ts', resolveDir: projectRoot },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node18',
    write: false,
    logLevel: 'silent',
  });
  const bundler = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundler).toString('base64')}`);
}

/** Convenience: a deterministic clock. */
export function fakeClock(start = 1_700_000_000_000) {
  let current = start;
  const clock = () => current;
  clock.advance = (ms) => {
    current += ms;
    return current;
  };
  clock.set = (value) => {
    current = value;
    return current;
  };
  return clock;
}
