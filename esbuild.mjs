import * as esbuild from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import * as path from 'node:path';

const require = createRequire(import.meta.url);
const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

/**
 * pdf.js is shipped as plain ESM files rather than being bundled, because the
 * bundle would shadow the Node `require` it uses for font metrics and streams.
 * The library module, its worker, and the built-in font metrics all land in
 * dist/ so the extension is self-contained and needs no node_modules.
 */
async function copyPdfAssets() {
  const pdfDist = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const target = 'dist';
  await mkdir(target, { recursive: true });
  await cp(path.join(pdfDist, 'legacy/build/pdf.mjs'), path.join(target, 'pdf.mjs'));
  await cp(path.join(pdfDist, 'legacy/build/pdf.worker.mjs'), path.join(target, 'pdf.worker.mjs'));
  const fonts = path.join(target, 'standard_fonts');
  await rm(fonts, { recursive: true, force: true });
  await cp(path.join(pdfDist, 'standard_fonts'), fonts, { recursive: true });
  console.log('[esbuild] copied pdf.js module, worker and standard fonts to dist/');
}

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  minify: production,
  sourcemap: production ? false : 'inline',
  logLevel: 'info',
  legalComments: 'none',
};

/** @type {esbuild.BuildOptions[]} */
const configs = [
  {
    ...common,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    // `vscode` is injected by the extension host and must never be bundled.
    // pdf.js is copied into dist/ and imported as a real ESM file at runtime:
    // bundling it would shadow the Node `require` it needs for font metrics.
    external: ['vscode', 'pdfjs-dist'],
  },
  {
    ...common,
    entryPoints: ['media/webview/main.ts'],
    outfile: 'media/webview/main.js',
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
  },
];

if (watch) {
  await copyPdfAssets();
  const contexts = await Promise.all(configs.map((c) => esbuild.context(c)));
  await Promise.all(contexts.map((c) => c.watch()));
  console.log('[esbuild] watching...');
} else {
  await Promise.all(configs.map((c) => esbuild.build(c)));
  await copyPdfAssets();
  console.log('[esbuild] build complete');
}
