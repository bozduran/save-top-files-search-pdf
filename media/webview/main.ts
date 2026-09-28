/**
 * Sidebar UI for PDF Hub.
 *
 * Deliberately framework-free and driven by a single state message from the
 * extension host, so adding sections or search providers never requires UI
 * changes. The search input is rendered once and never re-created, which keeps
 * typing smooth while results stream in.
 */

import type { HostToWebview, UiFile, UiSection, UiState, WebviewToHost } from '../../src/ui/protocol';

declare function acquireVsCodeApi(): { postMessage(message: unknown): void; setState(state: unknown): void };

const vscode = acquireVsCodeApi();

const ICONS: Record<string, string> = {
  history: 'M13.5 8a5.5 5.5 0 1 1-1.6-3.9l1.2-1.2A7 7 0 1 0 15 8h-2l3 3 3-3h-2a5.5 5.5 0 0 1-2.5 0z M11 5h1v4h3v1h-4z',
  star: 'M8 1.5l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.3l-3.8 2 .7-4.3-3.1-3 4.3-.6z',
  'link-external': 'M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3h-1.5v2.5h-9v-9H6zM9 2v1.5h2.9L6.4 9l1 1 5.6-5.5V7H14.5V2z',
  list: 'M2 3h12v1.5H2zM2 7.25h12v1.5H2zM2 11.5h12V13H2z',
  warning: 'M8 1l7 13H1zM7.25 5.5v4h1.5v-4zM7.25 11v1.5h1.5V11z',
  add: 'M7.25 2h1.5v5.25H14v1.5H8.75V14h-1.5V8.75H2v-1.5h5.25z',
  edit: 'M11.3 1.9l2.8 2.8-8.2 8.2-3.4.6.6-3.4zM2 14h4v1.5H2z',
  trash: 'M6 1.5h4l.5 1.5H14v1.5H2V3h3.5zM3 5.5h10l-.8 9H3.8z',
  close: 'M3.2 2.1L8 6.9l4.8-4.8 1.1 1.1L9.1 8l4.8 4.8-1.1 1.1L8 9.1l-4.8 4.8-1.1-1.1L6.9 8 2.1 3.2z',
  refresh: 'M8 2a6 6 0 1 1-5.7 4.3l1.5.5A4.5 4.5 0 1 0 8 3.5V6L4.5 3.5 8 1z',
  chevron: 'M4.2 6l3.8 3.8L11.8 6l1 1-4.8 4.8L3.2 7z',
  file: 'M3 1.5h6L13 5.5V14.5H3zM8.5 2.6V6H12z',
  wand: 'M11.5 1.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1L8.5 4.5l2.1-.9zM2 12.6l7-7 1.4 1.4-7 7L2 14z',
  'circle-slash': 'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zm4.9 3l-6.4 6.4A5 5 0 0 1 12.9 4.5zM3.1 11.5l6.4-6.4a5 5 0 0 1-6.4 6.4z',
  play: 'M4.5 2.5l9 5.5-9 5.5z',
  pdf: 'M3 1.5h6L13 5.5V14.5H3zM8.5 2.6V6H12zM4.4 11.6c1-.5 2-.8 3.3-.9.4-.4.8-.9 1-1.4-.4-1-.6-2-.3-2.5.4-.5 1.1-.2 1.2.5.1.7-.2 1.5-.5 2.1.6 1 1.4 1.8 2.3 2.4.5-.1 1-.1 1.4.1.5.3.2 1-.4 1-.7 0-1.3-.4-1.9-.9-1 .2-2 .6-2.9 1.1-.5 1.1-1.1 1.9-1.6 1.9-.4 0-.7-.4-.6-1 0-.7.4-1.4.9-2z',
};

function icon(name: string, className = 'file-icon'): string {
  const path = ICONS[name] ?? ICONS.file;
  return `<svg class="${className}" viewBox="0 0 16 16" aria-hidden="true"><path d="${path}"/></svg>`;
}

function buttonIcon(name: string): string {
  return icon(name, 'icon-button');
}

function buttonIconInline(name: string): string {
  return icon(name, 'group-icon');
}

function post(message: WebviewToHost): void {
  vscode.postMessage(message);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function highlight(text: string, needle: string): string {
  const safe = escapeHtml(text);
  if (!needle) {
    return safe;
  }
  const at = safe.toLowerCase().indexOf(escapeHtml(needle).toLowerCase());
  if (at === -1) {
    return safe;
  }
  const len = needle.length;
  return `${safe.slice(0, at)}<mark>${safe.slice(at, at + len)}</mark>${safe.slice(at + len)}`;
}

function fileNameIcon(file: UiFile): string {
  const isPdf = file.name.toLowerCase().endsWith('.pdf');
  return icon(isPdf ? 'pdf' : 'file', `file-icon${isPdf ? ' pdf' : ''}`);
}

function shortPath(file: UiFile): string {
  if (file.external) {
    return 'Outside the project';
  }
  return file.relativePath ?? '';
}

// ------------------------------------------------------------------- skeleton

const root = document.getElementById('app') as HTMLElement;

root.innerHTML = `
  <div class="hub">
    <div class="toolbar">
      <span class="title">PDF Hub</span>
      <button class="icon-button" data-action="createGroup" title="New favorites group">${buttonIcon('add')}</button>
      <button class="icon-button" data-action="createSmartGroup" title="New smart group (auto-collected by pattern)">${buttonIcon('wand')}</button>
      <button class="icon-button" data-action="reindex" title="Rebuild PDF search index">${buttonIcon('refresh')}</button>
      <button class="icon-button" data-action="refresh" title="Refresh">${buttonIcon('list')}</button>
    </div>

    <div class="search">
      <div class="search-row">
        <input id="search-input" type="text" placeholder="Search PDFs (names + contents)" spellcheck="false" autocomplete="off" />
        <button class="clear" id="search-clear" type="button" title="Clear search" aria-label="Clear search">${icon('close', 'clear')}</button>
      </div>
      <div class="search-controls">
        <label class="toggle" title="Only match PDF file names and paths">
          <input type="checkbox" id="name-only" /> Search names only
        </label>
        <button class="icon-button" data-action="openExternalPicker" title="Add a file outside the project">${buttonIcon('link-external')}</button>
      </div>
    </div>

    <div id="status"></div>
    <div class="results" id="results"></div>
    <div class="sections" id="sections"></div>
  </div>
`;

const input = document.getElementById('search-input') as HTMLInputElement;
const clearButton = document.getElementById('search-clear') as HTMLButtonElement;
const nameOnlyBox = document.getElementById('name-only') as HTMLInputElement;
const statusEl = document.getElementById('status') as HTMLElement;
const resultsEl = document.getElementById('results') as HTMLElement;
const sectionsEl = document.getElementById('sections') as HTMLElement;

let state: UiState | null = null;
let debounce: number | undefined;
const collapsed = new Set<string>();

// --------------------------------------------------------------------- events

input.addEventListener('input', () => {
  if (debounce) {
    window.clearTimeout(debounce);
  }
  debounce = window.setTimeout(() => {
    post({ type: 'search', text: input.value, nameOnly: nameOnlyBox.checked });
  }, 180);
});

input.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    input.value = '';
    post({ type: 'search', text: '', nameOnly: nameOnlyBox.checked });
  }
});

clearButton.addEventListener('click', () => {
  input.value = '';
  input.focus();
  post({ type: 'search', text: '', nameOnly: nameOnlyBox.checked });
});

nameOnlyBox.addEventListener('change', () => {
  post({ type: 'search', text: input.value, nameOnly: nameOnlyBox.checked });
});

document.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement | null)?.closest<HTMLElement>('[data-action]');
  if (!target) {
    return;
  }
  const action = target.dataset.action ?? '';
  const path = target.dataset.path;
  const groupId = target.dataset.groupId;
  switch (action) {
    case 'open':
      if (path) {
        post({ type: 'open', path });
      }
      break;
    case 'removeFavorite':
      if (path) {
        post({ type: 'removeFavorite', path });
      }
      break;
    case 'removeExternal':
      if (path) {
        post({ type: 'removeExternal', path });
      }
      break;
    case 'moveToGroup':
      if (path) {
        chooseGroupThen(path);
      }
      break;
    case 'renameGroup':
      if (groupId) {
        post({ type: 'renameGroup', groupId });
      }
      break;
    case 'deleteGroup':
      if (groupId) {
        post({ type: 'deleteGroup', groupId });
      }
      break;
    case 'createGroup':
      post({ type: 'createGroup' });
      break;
    case 'createSmartGroup':
      post({ type: 'createSmartGroup' });
      break;
    case 'editSmartGroup':
      if (groupId) {
        post({ type: 'editSmartGroup', groupId });
      }
      break;
    case 'toggleSmartGroup':
      if (groupId) {
        post({ type: 'toggleSmartGroup', groupId });
      }
      break;
    case 'deleteSmartGroup':
      if (groupId) {
        post({ type: 'deleteSmartGroup', groupId });
      }
      break;
    case 'cancelIndex':
      post({ type: 'cancelIndex' });
      break;
    case 'openExternalPicker':
      post({ type: 'openExternalPicker' });
      break;
    case 'reindex':
      post({ type: 'reindex' });
      break;
    case 'refresh':
      post({ type: 'refresh' });
      break;
    case 'toggleSection': {
      const id = target.dataset.sectionId;
      if (id) {
        if (collapsed.has(id)) {
          collapsed.delete(id);
        } else {
          collapsed.add(id);
        }
        renderSections();
      }
      break;
    }
    default:
      break;
  }
});

function chooseGroupThen(path: string): void {
  const groups = state?.groups ?? [];
  if (!groups.length) {
    post({ type: 'createGroup' });
    return;
  }
  const list = groups.map((group, index) => `${index + 1}: ${group.name}`).join('\n');
  const answer = window.prompt(`Move to which group?\n${list}`, '1');
  const index = Number(answer) - 1;
  if (Number.isInteger(index) && groups[index]) {
    post({ type: 'moveToGroup', path, groupId: groups[index].id });
  }
}

window.addEventListener('message', (event: MessageEvent<HostToWebview>) => {
  const message = event.data;
  if (message.type === 'state') {
    const previous = state;
    state = message.state;
    render(previous);
  } else if (message.type === 'error') {
    statusEl.innerHTML = `<div class="error">${escapeHtml(message.message)}</div>`;
  }
});

// --------------------------------------------------------------------- render

function render(previous: UiState | null): void {
  if (!state) {
    return;
  }
  renderStatus();
  renderResults();
  renderSections();

  const search = state.search;
  const textChanged = !previous || previous.search?.text !== search?.text;
  const modeChanged = !previous || previous.search?.nameOnly !== search?.nameOnly;
  if (textChanged || modeChanged) {
    if (document.activeElement !== input && search) {
      input.value = search.text;
    }
    nameOnlyBox.checked = search ? search.nameOnly : nameOnlyBox.checked;
  }
}

function renderStatus(): void {
  if (!state) {
    return;
  }
  const index = state.index;
  const busy = index.phase === 'indexing' || index.phase === 'scanning';

  if (busy) {
    const pct = index.total ? Math.round((index.processed / index.total) * 100) : 0;
    statusEl.innerHTML = `
      <div class="index-progress" role="status" aria-live="polite">
        <div class="index-progress-head">
          <span class="spinner"></span>
          <span class="index-label">
            ${index.phase === 'scanning' ? 'Checking for changes' : 'Indexing PDFs'}
            <strong>${index.processed}/${index.total}</strong>
          </span>
          <button class="icon-button" data-action="cancelIndex" title="Cancel indexing">${buttonIcon('close')}</button>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="index-detail">
          ${index.currentFile ? `<span title="${escapeHtml(index.currentFile)}">${escapeHtml(index.currentFile)}</span>` : ''}
          ${index.extracted ? `<span>${index.extracted} extracted</span>` : ''}
          ${index.cached ? `<span>${index.cached} cached</span>` : ''}
        </div>
      </div>`;
    return;
  }

  const parts: string[] = [];
  const search = state.search;
  if (search?.running) {
    parts.push(
      `<span class="spinner"></span><span>${
        search.nameOnly ? 'Searching names' : 'Searching PDF contents'
      }…</span>`
    );
  } else if (search?.note) {
    parts.push(`<span>${escapeHtml(search.note)}</span>`);
  } else if (index.phase === 'ready' && index.summary) {
    parts.push(`<span title="Index is up to date">${escapeHtml(index.summary)}</span>`);
  } else if (index.phase === 'cancelled') {
    parts.push(`<span>Indexing cancelled — ${index.extracted} file(s) indexed so far</span>`);
  } else if (index.failed) {
    parts.push(`<span>${index.failed} PDF(s) could not be read</span>`);
  }
  if (!parts.length && state.externalCount === 0) {
    parts.push(`<span>${state.groups.length} group(s) · no external favorites yet</span>`);
  }
  statusEl.innerHTML = parts.length ? `<div class="status">${parts.join('')}</div>` : '';
}

function renderResults(): void {
  if (!state) {
    resultsEl.innerHTML = '';
    return;
  }
  const search = state.search;
  if (!search || (!search.hits.length && !search.running)) {
    if (search && !search.hits.length && !search.running) {
      resultsEl.innerHTML = `<div class="empty">No matches for “${escapeHtml(search.text)}”.</div>`;
    } else {
      resultsEl.innerHTML = '';
    }
    return;
  }
  if (search.running && !search.hits.length) {
    resultsEl.innerHTML = '';
    return;
  }

  resultsEl.innerHTML = search.hits
    .map((hit) => {
      const excerpt = hit.excerpt
        ? `<div class="hit-excerpt">${
            hit.source === 'content'
              ? highlight(hit.excerpt, search.text)
              : escapeHtml(hit.excerpt)
          }</div>`
        : '';
      const name = highlight(hit.name, hit.source === 'name' ? search.text : '');
      return `
        <div class="hit" role="button" tabindex="0" data-action="open" data-path="${escapeHtml(hit.path)}">
          <div class="hit-title">
            ${icon(hit.name.toLowerCase().endsWith('.pdf') ? 'pdf' : 'file', 'file-icon pdf')}
            <span class="hit-name">${name}</span>
            ${hit.location ? `<span class="hit-loc">${escapeHtml(hit.location)}</span>` : ''}
            <span class="badge">${hit.source === 'content' ? 'text' : 'name'}</span>
          </div>
          ${excerpt}
        </div>`;
    })
    .join('');
}

function renderSections(): void {
  if (!state) {
    sectionsEl.innerHTML = '';
    return;
  }
  sectionsEl.innerHTML = state.sections.map(renderSection).join('');
}

function renderSection(section: UiSection): string {
  const isCollapsed = collapsed.has(section.id);
  const fileCount =
    section.files?.length ?? section.groups?.reduce((sum, group) => sum + group.files.length, 0) ?? 0;

  const body: string[] = [];
  if (section.files?.length) {
    body.push(section.files.map((file) => renderFileRow(file, section)).join(''));
  }
  if (section.groups?.length) {
    body.push(
      section.groups
        .map((group) => {
          const rows = group.files.length
            ? group.files.map((file) => renderFileRow(file, section, group.id)).join('')
            : `<div class="empty">No files yet — right-click a file and choose “Add to Favorites”.</div>`;
          if (group.smart) {
            return `
              <div class="group-title smart${group.enabled === false ? ' disabled' : ''}">
                <span class="smart-icon">${buttonIconInline('wand')}</span>
                <span>${escapeHtml(group.title)}</span>
                <span class="detail">${group.files.length}</span>
                <span class="actions">
                  <button class="icon-button" data-action="toggleSmartGroup" data-group-id="${escapeHtml(group.id)}" title="${group.enabled === false ? 'Enable rule' : 'Disable rule'}">${buttonIcon(group.enabled === false ? 'play' : 'circle-slash')}</button>
                  <button class="icon-button" data-action="editSmartGroup" data-group-id="${escapeHtml(group.id)}" title="Edit rule">${buttonIcon('edit')}</button>
                  <button class="icon-button" data-action="deleteSmartGroup" data-group-id="${escapeHtml(group.id)}" title="Delete smart group">${buttonIcon('trash')}</button>
                </span>
              </div>
              ${group.hint ? `<div class="group-hint" title="${escapeHtml(group.hint)}">${escapeHtml(group.hint)}</div>` : ''}
              ${rows}`;
          }
          return `
            <div class="group-title">
              <span>${escapeHtml(group.title)}</span>
              <span class="detail">${group.files.length}</span>
              <span class="actions">
                <button class="icon-button" data-action="renameGroup" data-group-id="${escapeHtml(group.id)}" title="Rename group">${buttonIcon('edit')}</button>
                <button class="icon-button" data-action="deleteGroup" data-group-id="${escapeHtml(group.id)}" title="Delete group">${buttonIcon('trash')}</button>
              </span>
            </div>
            ${rows}`;
        })
        .join('')
    );
  }
  if (!body.length && section.hint) {
    body.push(`<div class="empty">${escapeHtml(section.hint)}</div>`);
  }

  return `
    <div class="section${isCollapsed ? ' collapsed' : ''}">
      <button class="section-header" data-action="toggleSection" data-section-id="${escapeHtml(section.id)}">
        ${icon('chevron', 'chevron')}
        <span>${escapeHtml(section.title)}</span>
        <span class="count">${fileCount}</span>
      </button>
      <div class="section-body">${body.join('')}</div>
    </div>`;
}

function renderFileRow(file: UiFile, section: UiSection, groupId?: string): string {
  const removable = section.id === 'external' ? 'removeExternal' : 'removeFavorite';
  // Files in a smart group are collected by a rule, so they cannot be removed
  // individually; the rule has to change instead.
  const automatic = section.supportsSmartGroups === true;
  const canMove = !automatic && section.supportsGroups === true && groupId !== undefined;
  return `
    <div class="file-row" role="button" tabindex="0" data-action="open" data-path="${escapeHtml(file.path)}" title="${escapeHtml(file.path)}">
      ${fileNameIcon(file)}
      <span class="name">${escapeHtml(file.name)}</span>
      ${file.detail ? `<span class="detail">${escapeHtml(file.detail)}</span>` : ''}
      ${shortPath(file) ? `<span class="detail">${escapeHtml(shortPath(file))}</span>` : ''}
      <span class="row-actions">
        ${
          canMove
            ? `<button class="icon-button" data-action="moveToGroup" data-path="${escapeHtml(file.path)}" title="Move to another group">${buttonIcon('list')}</button>`
            : ''
        }
        ${
          automatic
            ? `<button class="icon-button" data-action="editSmartGroup" data-group-id="${escapeHtml(groupId ?? '')}" title="Change the rule that collects this file">${buttonIcon('wand')}</button>`
            : `<button class="icon-button" data-action="${removable}" data-path="${escapeHtml(file.path)}" title="Remove">${buttonIcon('close')}</button>`
        }
      </span>
    </div>`;
}

post({ type: 'ready' });
