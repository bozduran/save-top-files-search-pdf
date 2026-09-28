# PDF Hub

A VS Code / Code-OSS sidebar that brings the three things you do most with a
project's documents into one place: **find them**, **get back to them**, and
**pin them into groups you name yourself**.

![PDF Hub](media/icon.png)

## Features

### 1. Search across every PDF in the open project

- **Content search** — indexes the text of every PDF in the workspace and shows
  matches with the page number and a highlighted excerpt.
- **Name-only mode** — flip the *Search names only* checkbox to skip content and
  match file names and paths instantly.
- PDFs are discovered recursively per workspace folder (`.gitignore` and your
  exclude patterns apply); no folder is ever skipped manually.
- The index is **persistent** (survives window reloads) and **incremental**:
  only PDFs whose size or modification time changed are ever re-parsed.

### 2. Top files in the project

A ranked list of the files you actually work in, switchable between frequency,
recency, or a blend of both:

| Setting | Values |
| --- | --- |
| `pdfHub.recent.ranking` | `frequency`, `recent`, `hybrid` (default) |
| `pdfHub.recent.maxItems` | `3`–`50` (default `15`) |

### 3. Favorites in named groups

Right-click any file in the Explorer, an editor tab, or the editor itself and
choose **Add to Favorites**. A picker appears: choose an existing group or
create a new one on the spot (`Python`, `Java`, `Invoices`, …).

Groups are flat — one name, one list, one file belongs to one group. Rename or
delete a group directly from the sidebar.

### 4. Smart groups (auto-collections)

A smart group is a saved rule that collects files for you — no right-clicking,
no stale lists. Create one from the toolbar wand icon or the command palette:

| Rule piece | Example | Notes |
| --- | --- | --- |
| Glob pattern | `*.pdf`, `docs/**`, `invoice-*`, `*.{md,txt}` | `*` stays inside a folder, `**` crosses folders, `{a,b}` are alternatives |
| Regular expression | `^reports/\d{4}/` | Optional, for cases globs cannot express |
| Extensions | `pdf`, `.md` | Applied to the file name |
| Size window | `10`–`500` KB | Uses file metadata only |
| Recency | changed within `30` days | Uses file metadata only |
| Exclusions | `**/archive/**` | Always veto a match |

Rules apply to **any file in the project**, not just PDFs, and matching runs on
file names, paths and metadata — so a smart group costs no PDF parsing at all.
Combine conditions with *all* or *any*, disable a rule temporarily, or edit its
pattern from the sidebar. Each group shows its own rule summary, and files
inside it are managed by the rule (edit the rule rather than the file).

### 5. Favorites outside the project (max 10)

Files that live outside every workspace folder go to a separate, **hard-capped
list of 10**. Add them with the link icon in the sidebar toolbar or the
`PDF Hub: Add External File (max 10)...` command. The cap is enforced in the
store and the UI reports how many slots are left.

## How often does indexing run?

This is the question worth answering precisely, because re-parsing every PDF on
every window reload would be expensive. The pipeline is deliberately
metadata-first:

| Step | When | Cost |
| --- | --- | --- |
| Load the persisted index | once per window, ~2.5 s after the sidebar opens | one small file read |
| Check for changes (`stat` per PDF) | per pass | ~0.1 ms per file; 1000 PDFs ≈ 0.1 s |
| Extract text | **only** files whose size or mtime changed | ~10–200 ms per PDF |
| Write the index | after a pass that did work (at most once every 5 s) | proportional to changed files |

So an unchanged project costs one `stat` pass and **zero extraction**, forever.
Text extraction only ever happens for a PDF you actually added or changed.

When a pass may start is up to you — `pdfHub.index.trigger`:

| Value | Behaviour |
| --- | --- |
| `onDemand` | Never in the background. Indexing starts only when you search or run *Rebuild PDF Search Index*. Zero idle cost. |
| `onViewOpen` (default) | When the sidebar opens, plus when a PDF changes while it is open. |
| `onStartup` | Also shortly after a window opens, in the background. |

Additional brakes, all configurable:

- Changes are **debounced** (`pdfHub.index.debounceMs`, default 1.5 s), so saving
  a file repeatedly starts one pass, not ten.
- A steady stream of changes cannot postpone work forever
  (`pdfHub.index.maxDelayMs`, default 10 s).
- A **Cancel** button appears in the sidebar while indexing; it stops the queue
  immediately and keeps whatever was already indexed.
- Files larger than `pdfHub.search.maxFileSizeMb` are skipped entirely.
- Extraction runs two files at a time, so the editor stays responsive.
- The index is capped (`24 MB` / `4000` entries) with least-recently-used
  eviction, and stale entries for deleted PDFs are pruned automatically.
- Concurrent triggers share a single pass, so nothing ever runs twice.

Changing `pdfHub.search.maxTextKbPerFile` or the extractor invalidates nothing
by itself — the cache key is the file's size and mtime. Use **Rebuild PDF Search
Index** for a deliberate full re-index.

## Commands

| Command | What it does |
| --- | --- |
| `PDF Hub: Focus Sidebar` | Opens the activity bar view |
| `PDF Hub: Add to Favorites` | Group picker for the selected file(s) |
| `PDF Hub: Add Selection to Favorites` | Same, from the editor context menu |
| `PDF Hub: Remove from Favorites` | Removes from groups and external list |
| `PDF Hub: New Favorites Group...` | Creates an empty group |
| `PDF Hub: Rename Group...` / `PDF Hub: Delete Group` | Manage groups |
| `PDF Hub: Add External File (max 10)...` | Multi-select picker outside the project |
| `PDF Hub: Clear Recent Files` | Resets the top-files statistics |
| `PDF Hub: New Smart Group (auto-collection)...` | Guided rule builder with presets |
| `PDF Hub: Edit Smart Group...` | Change the pattern, mode, or enabled state |
| `PDF Hub: Delete Smart Group` | Removes the rule (files are untouched) |
| `PDF Hub: Enable/Disable Smart Group` | Temporarily mutes a rule |
| `PDF Hub: Rebuild PDF Search Index` | Drops the whole index and re-extracts |

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `pdfHub.search.scope` | `project` | Include external favorites in content search |
| `pdfHub.search.maxFileSizeMb` | `40` | Skip larger PDFs while indexing |
| `pdfHub.search.maxTextKbPerFile` | `2048` | Text kept per PDF |
| `pdfHub.search.excludeGlobs` | `node_modules`, `.git`, `dist`, … | Discovery excludes |
| `pdfHub.search.minChars` | `2` | Characters before a search starts |
| `pdfHub.index.trigger` | `onViewOpen` | When indexing may run: `onDemand`, `onViewOpen`, `onStartup` |
| `pdfHub.index.debounceMs` | `1500` | Coalescing window after a PDF changes |
| `pdfHub.index.maxDelayMs` | `10000` | Longest a pass may be postponed by continuous changes |
| `pdfHub.external.maxItems` | `10` | External favorites cap (1–10) |
| `pdfHub.favorites.defaultGroupName` | `Favorites` | First group's name |

## Extending it

The sidebar renders whatever the provider registry returns, so new behaviour is
added by registering a provider rather than editing the UI.

```ts
const hub = vscode.extensions.getExtension('local-dev.pdf-hub');
const api = await hub?.activate();

// Search another document type, then have it appear in the same result list.
api.registerSearchProvider({
  id: 'docx',
  label: 'Word',
  order: 20,
  async search(query) {
    return { providerId: 'docx', label: 'Word', hits: [] };
  },
});

// Or add a whole new sidebar section.
api.registerSectionProvider({
  id: 'todos',
  label: 'TODO files',
  async getSections() {
    return [{ id: 'todos', title: 'TODO files', items: [] }];
  },
});

// Smart groups (auto-collections) are part of the API too.
api.createSmartGroup('Recent invoices', {
  includeGlobs: ['**/invoice-*'],
  extensions: ['pdf'],
  modifiedWithinDays: 30,
});
api.listSmartGroups();

// Index on demand and read the outcome.
await api.reindex({ force: false }); // { phase, extracted, cached }

// Lifecycle hooks for future features.
api.hook('onFileOpened', (file) => console.log('opened', file));
api.hook('onIndexReady', (count) => console.log('indexed', count, 'pdfs'));
```

Built-in providers use the same registry, so the extension is its own first
consumer of its extension points.

## Architecture

```
src/
  extension.ts              activation, wiring, public API
  store.ts                  thin VS Code adapter (mementos, timers, events)
  storeCore.ts              all persisted state logic (unit tested)
  commands.ts               context-menu, favorites and smart-group commands
  indexService.ts           incremental indexing, cancellation, progress
  vscodeIndexEnvironment.ts filesystem/pdf.js adapter for the indexer
  fileRef.ts                path -> FileRef with workspace resolution
  types.ts                  shared data types (no vscode import)
  api/                      extension points (registry + provider interfaces)
    providers/              pdf search, recent, favorites, smart groups, external
  search/
    pdfSearch.ts            discovery + querying over the index
    indexStore.ts           persistent index: validate, serialize, evict
    pdfText.ts              isolated pdf.js text extraction
    glob.ts                 glob -> RegExp compiler (unit tested)
    smartRules.ts           rule evaluation + explanations (unit tested)
    recents.ts              ranking, pruning, reindex policy (unit tested)
    textMatch.ts            excerpt/ranking helpers (unit tested)
    workspaceFiles.ts       filesystem walk fallback (unit tested)
  ui/                       webview provider + message protocol
media/
  activity-icon.svg         activity bar icon
  icon.png / icon.svg       marketplace icon
  webview/                  sidebar UI (HTML/CSS/TS)
scripts/
  run-tests.mjs             test runner (node:test + webview DOM suite)
  check-imports.mjs         import-extension and reachability guard
  smoke-bundle.cjs          activates the real bundle against a vsCode stub
  package.mjs / zip.mjs     .vsix packaging without vsce
```

Persistence: favorites and open statistics live in `workspaceState` (per
project); the external list is mirrored to `globalState` so it follows you
between windows.

## Development

```bash
npm install
npm run build       # bundle extension + webview
npm run watch       # rebuild on change
npm run verify      # typecheck + build + unit tests + smoke tests
npm run package     # build a .vsix
code --install-extension pdf-hub-0.2.1.vsix   # committed at the repo root
```

Lean on `npm run verify` before pushing: it runs the import guard, typecheck,
build, all tests and the smoke tests.

### Test layout

148 unit tests plus a 21-assertion DOM suite, all runnable without launching
VS Code:

| Area | Coverage |
| --- | --- |
| `glob.test.ts` | `*`/`**` semantics, braces, classes, case, deep paths |
| `smartRules.test.ts` | condition modes, exclusions, size/recency, explanations, validation |
| `storeCore.test.ts` | groups, the 10-file cap, recents, pruning, corrupt state, events |
| `indexStore.test.ts` | cache validation, corrupt/foreign snapshots, LRU eviction, round trips |
| `indexService.test.ts` | **incremental behaviour**, cancellation, concurrency, persistence, failures |
| `recents.test.ts` | ranking strategies, debounce/max-delay policy, scan summaries |
| `textMatch.test.ts`, `workspaceFiles.test.ts` | excerpts, ranking, recursive walk |
| `smartGroupsProvider.test.ts` | live rule filtering against metadata |
| `scripts/test-webview.mjs` | the real sidebar bundle in happy-dom: rendering, actions, progress |
| `scripts/visual-check.mjs` | layout invariants in headless Chromium at 260/340/480px: control sizes, icon scaling, overflow |

Tests are plain `*.test.ts` next to the module they cover and run on Node's
built-in test runner — no framework, no transpile step:

```bash
npm test                    # unit + DOM + layout checks
npm run test:patterns glob  # only files matching "glob"
npm run test:visual         # layout checks only (writes screenshots to .visual/)
node --test src/search/indexService.test.ts
```

The layout checks need a browser engine once:

```bash
npm install -D playwright
PLAYWRIGHT_BROWSERS_PATH="$PWD/.pw-browsers" npx playwright install chromium
```

They are skipped automatically (with a notice) when Playwright is missing, and
can be turned off with `PDF_HUB_SKIP_VISUAL=1`.

They exist because of a real bug: the search field's clear button inherited the
user agent's `padding: 1px 6px`, which squeezed its 12px icon into a 6px content
box and rendered it about three times too large, spilling out of the input. No
unit test could see it; the layout check now asserts that every icon button is
between 8 and 24px, that its icon fits its content box, and that nothing
overflows the sidebar.

`npm run check:imports` also fails the build when a source file is no longer
reachable from the entry point, so dead or untested modules cannot hide.

### Smoke tests

`npm run smoke` activates the real `dist/extension.js` against a stubbed
`vscode` module, then checks discovery, incremental indexing (first pass
extracts, second pass extracts nothing, forced rebuild extracts again) and text
extraction from a generated PDF. Bundling, asset-copying and packaging
regressions therefore fail without opening the editor.

`npm run fixture` regenerates `fixtures/sample.pdf`.

### Continuous integration

`.github/workflows/ci.yml` runs the import guard, typecheck, build, unit tests,
smoke tests and packaging on Node 22 and 26, and uploads the `.vsix` as an
artifact.

## Notes and limits

- Extraction runs in the extension host with bounded concurrency (2 files at a
  time, override with `PDF_HUB_CONCURRENCY`).
- Scanned/image-only PDFs have no text layer, so content search cannot match
  them. Add OCR if you need it.
- pdf.js resolves a select few things that cannot be bundled (its worker and
  the standard font metrics), so the build copies `dist/pdf.mjs`,
  `dist/pdf.worker.mjs`, and `dist/standard_fonts/` alongside the bundle.
- The index is stored in workspace storage (`pdf-index.json`) and is scoped to
  the workspace; opening the same project in another window reuses it.
- pdf.js cannot load the standard font metrics over `file://` in Node, so those
  warnings are suppressed. Text extraction is unaffected.
- Sidebar layout checks compare Chromium rendering; the real webview runs in
  Electron, so the checks guard invariants (size, padding, overflow) rather than
  pixel-exact screenshots.

## License

MIT. Bundles Mozilla's pdf.js (Apache-2.0); see `LICENSE.txt`.
