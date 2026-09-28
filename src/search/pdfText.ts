/**
 * Isolated PDF text extraction.
 *
 * pdf.js is loaded lazily so that activation stays cheap and a pdf.js problem
 * can never break extension activation. Swapping in another engine later only
 * means replacing this file.
 */

import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

export interface PdfTextExtractor {
  /** Returns one string per page, in document order. */
  extract(data: Uint8Array): Promise<string[]>;
}

type PdfJs = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(src: Record<string, unknown>): {
    promise: Promise<PdfDocument>;
    destroy(): Promise<void>;
  };
};

type PdfDocument = {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  destroy(): Promise<void>;
};

type PdfPage = {
  getTextContent(): Promise<{ items: { str?: string; hasEOL?: boolean }[] }>;
};

let pdfjsPromise: Promise<PdfJs> | undefined;
/** Directory holding the copied pdf.js assets (dist/ next to extension.js). */
let assetBaseDirectory = __dirname;

/** Lets tests point the loader at another asset directory. */
export function setPdfAssetDirectory(directory: string): void {
  assetBaseDirectory = directory;
  pdfjsPromise = undefined;
}

async function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      // Loaded as a real ESM file, never bundled: pdf.js calls Node's `require`
      // internally and a bundled copy would break that.
      const moduleUrl = pathToFileURL(path.join(assetBaseDirectory, 'pdf.mjs')).href;
      const mod = (await import(moduleUrl)) as unknown as PdfJs;
      // The extension host has no DOM worker, so pdf.js runs its in-process
      // worker. It still needs a resolvable worker URL to bootstrap that path,
      // which is why the build copies `pdf.worker.mjs` next to the bundle.
      mod.GlobalWorkerOptions.workerSrc = pathToFileURL(
        path.join(assetBaseDirectory, 'pdf.worker.mjs')
      ).href;
      return mod;
    })();
  }
  return pdfjsPromise;
}

function joinPage(items: { str?: string; hasEOL?: boolean }[]): string {
  let out = '';
  for (const item of items) {
    if (typeof item.str === 'string') {
      out += item.str;
    }
    out += item.hasEOL ? '\n' : ' ';
  }
  return out.replace(/[ \t]+/g, ' ').trim();
}

export const pdfTextExtractor: PdfTextExtractor = {
  async extract(data: Uint8Array): Promise<string[]> {
    const pdfjs = await loadPdfJs();
    const task = pdfjs.getDocument({
      data,
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      // Required: without it pdf.js cannot bootstrap its in-process worker.
      standardFontDataUrl: `${pathToFileURL(path.join(assetBaseDirectory, 'standard_fonts')).href}/`,
      // pdf.js only loads standard font metrics over http(s), which a Node
      // extension host never has, so it would warn for every PDF that uses one
      // of the 14 built-in fonts. Errors are still reported at this level.
      verbosity: 0,
    });
    const doc = await task.promise;
    const pages: string[] = [];
    try {
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
        const page = await doc.getPage(pageNumber);
        const content = await page.getTextContent();
        pages.push(joinPage(content.items));
        const cleanup = (page as unknown as { cleanup?: () => void }).cleanup;
        if (typeof cleanup === 'function') {
          cleanup.call(page);
        }
      }
    } finally {
      await doc.destroy().catch(() => undefined);
    }
    return pages;
  },
};

/** Test hook: forget the cached pdf.js instance. */
export function resetPdfJsCache(): void {
  pdfjsPromise = undefined;
}
