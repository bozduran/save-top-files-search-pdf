"use strict";
(() => {
  // media/webview/main.ts
  var vscode = acquireVsCodeApi();
  var ICONS = {
    history: "M13.5 8a5.5 5.5 0 1 1-1.6-3.9l1.2-1.2A7 7 0 1 0 15 8h-2l3 3 3-3h-2a5.5 5.5 0 0 1-2.5 0z M11 5h1v4h3v1h-4z",
    star: "M8 1.5l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.3l-3.8 2 .7-4.3-3.1-3 4.3-.6z",
    "link-external": "M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3h-1.5v2.5h-9v-9H6zM9 2v1.5h2.9L6.4 9l1 1 5.6-5.5V7H14.5V2z",
    list: "M2 3h12v1.5H2zM2 7.25h12v1.5H2zM2 11.5h12V13H2z",
    warning: "M8 1l7 13H1zM7.25 5.5v4h1.5v-4zM7.25 11v1.5h1.5V11z",
    add: "M7.25 2h1.5v5.25H14v1.5H8.75V14h-1.5V8.75H2v-1.5h5.25z",
    edit: "M11.3 1.9l2.8 2.8-8.2 8.2-3.4.6.6-3.4zM2 14h4v1.5H2z",
    trash: "M6 1.5h4l.5 1.5H14v1.5H2V3h3.5zM3 5.5h10l-.8 9H3.8z",
    close: "M3.2 2.1L8 6.9l4.8-4.8 1.1 1.1L9.1 8l4.8 4.8-1.1 1.1L8 9.1l-4.8 4.8-1.1-1.1L6.9 8 2.1 3.2z",
    refresh: "M8 2a6 6 0 1 1-5.7 4.3l1.5.5A4.5 4.5 0 1 0 8 3.5V6L4.5 3.5 8 1z",
    chevron: "M4.2 6l3.8 3.8L11.8 6l1 1-4.8 4.8L3.2 7z",
    file: "M3 1.5h6L13 5.5V14.5H3zM8.5 2.6V6H12z",
    wand: "M11.5 1.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1L8.5 4.5l2.1-.9zM2 12.6l7-7 1.4 1.4-7 7L2 14z",
    "circle-slash": "M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zm4.9 3l-6.4 6.4A5 5 0 0 1 12.9 4.5zM3.1 11.5l6.4-6.4a5 5 0 0 1-6.4 6.4z",
    play: "M4.5 2.5l9 5.5-9 5.5z",
    pdf: "M3 1.5h6L13 5.5V14.5H3zM8.5 2.6V6H12zM4.4 11.6c1-.5 2-.8 3.3-.9.4-.4.8-.9 1-1.4-.4-1-.6-2-.3-2.5.4-.5 1.1-.2 1.2.5.1.7-.2 1.5-.5 2.1.6 1 1.4 1.8 2.3 2.4.5-.1 1-.1 1.4.1.5.3.2 1-.4 1-.7 0-1.3-.4-1.9-.9-1 .2-2 .6-2.9 1.1-.5 1.1-1.1 1.9-1.6 1.9-.4 0-.7-.4-.6-1 0-.7.4-1.4.9-2z"
  };
  function icon(name, className = "file-icon") {
    const path = ICONS[name] ?? ICONS.file;
    return `<svg class="${className}" viewBox="0 0 16 16" aria-hidden="true"><path d="${path}"/></svg>`;
  }
  function buttonIcon(name) {
    return icon(name, "icon-button");
  }
  function buttonIconInline(name) {
    return icon(name, "group-icon");
  }
  function post(message) {
    vscode.postMessage(message);
  }
  function escapeHtml(value) {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function highlight(text, needle) {
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
  function fileNameIcon(file) {
    const isPdf = file.name.toLowerCase().endsWith(".pdf");
    return icon(isPdf ? "pdf" : "file", `file-icon${isPdf ? " pdf" : ""}`);
  }
  function shortPath(file) {
    if (file.external) {
      return "Outside the project";
    }
    return file.relativePath ?? "";
  }
  var root = document.getElementById("app");
  root.innerHTML = `
  <div class="hub">
    <div class="toolbar">
      <span class="title">PDF Hub</span>
      <button class="icon-button" data-action="createGroup" title="New favorites group">${buttonIcon("add")}</button>
      <button class="icon-button" data-action="createSmartGroup" title="New smart group (auto-collected by pattern)">${buttonIcon("wand")}</button>
      <button class="icon-button" data-action="reindex" title="Rebuild PDF search index">${buttonIcon("refresh")}</button>
      <button class="icon-button" data-action="refresh" title="Refresh">${buttonIcon("list")}</button>
    </div>

    <div class="search">
      <div class="search-row">
        <input id="search-input" type="text" placeholder="Search PDFs (names + contents)" spellcheck="false" autocomplete="off" />
        <button class="clear" id="search-clear" type="button" title="Clear search" aria-label="Clear search">${icon("close", "clear")}</button>
      </div>
      <div class="search-controls">
        <label class="toggle" title="Only match PDF file names and paths">
          <input type="checkbox" id="name-only" /> Search names only
        </label>
        <button class="icon-button" data-action="openExternalPicker" title="Add a file outside the project">${buttonIcon("link-external")}</button>
      </div>
    </div>

    <div id="status"></div>
    <div class="results" id="results"></div>
    <div class="sections" id="sections"></div>
  </div>
`;
  var input = document.getElementById("search-input");
  var clearButton = document.getElementById("search-clear");
  var nameOnlyBox = document.getElementById("name-only");
  var statusEl = document.getElementById("status");
  var resultsEl = document.getElementById("results");
  var sectionsEl = document.getElementById("sections");
  var state = null;
  var debounce;
  var collapsed = /* @__PURE__ */ new Set();
  input.addEventListener("input", () => {
    if (debounce) {
      window.clearTimeout(debounce);
    }
    debounce = window.setTimeout(() => {
      post({ type: "search", text: input.value, nameOnly: nameOnlyBox.checked });
    }, 180);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      input.value = "";
      post({ type: "search", text: "", nameOnly: nameOnlyBox.checked });
    }
  });
  clearButton.addEventListener("click", () => {
    input.value = "";
    input.focus();
    post({ type: "search", text: "", nameOnly: nameOnlyBox.checked });
  });
  nameOnlyBox.addEventListener("change", () => {
    post({ type: "search", text: input.value, nameOnly: nameOnlyBox.checked });
  });
  document.addEventListener("click", (event) => {
    const target = event.target?.closest("[data-action]");
    if (!target) {
      return;
    }
    const action = target.dataset.action ?? "";
    const path = target.dataset.path;
    const groupId = target.dataset.groupId;
    switch (action) {
      case "open":
        if (path) {
          post({ type: "open", path });
        }
        break;
      case "removeFavorite":
        if (path) {
          post({ type: "removeFavorite", path });
        }
        break;
      case "removeExternal":
        if (path) {
          post({ type: "removeExternal", path });
        }
        break;
      case "moveToGroup":
        if (path) {
          chooseGroupThen(path);
        }
        break;
      case "renameGroup":
        if (groupId) {
          post({ type: "renameGroup", groupId });
        }
        break;
      case "deleteGroup":
        if (groupId) {
          post({ type: "deleteGroup", groupId });
        }
        break;
      case "createGroup":
        post({ type: "createGroup" });
        break;
      case "createSmartGroup":
        post({ type: "createSmartGroup" });
        break;
      case "editSmartGroup":
        if (groupId) {
          post({ type: "editSmartGroup", groupId });
        }
        break;
      case "toggleSmartGroup":
        if (groupId) {
          post({ type: "toggleSmartGroup", groupId });
        }
        break;
      case "deleteSmartGroup":
        if (groupId) {
          post({ type: "deleteSmartGroup", groupId });
        }
        break;
      case "cancelIndex":
        post({ type: "cancelIndex" });
        break;
      case "openExternalPicker":
        post({ type: "openExternalPicker" });
        break;
      case "reindex":
        post({ type: "reindex" });
        break;
      case "refresh":
        post({ type: "refresh" });
        break;
      case "toggleSection": {
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
  function chooseGroupThen(path) {
    const groups = state?.groups ?? [];
    if (!groups.length) {
      post({ type: "createGroup" });
      return;
    }
    const list = groups.map((group, index2) => `${index2 + 1}: ${group.name}`).join("\n");
    const answer = window.prompt(`Move to which group?
${list}`, "1");
    const index = Number(answer) - 1;
    if (Number.isInteger(index) && groups[index]) {
      post({ type: "moveToGroup", path, groupId: groups[index].id });
    }
  }
  window.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type === "state") {
      const previous = state;
      state = message.state;
      render(previous);
    } else if (message.type === "error") {
      statusEl.innerHTML = `<div class="error">${escapeHtml(message.message)}</div>`;
    }
  });
  function render(previous) {
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
  function renderStatus() {
    if (!state) {
      return;
    }
    const index = state.index;
    const busy = index.phase === "indexing" || index.phase === "scanning";
    if (busy) {
      const pct = index.total ? Math.round(index.processed / index.total * 100) : 0;
      statusEl.innerHTML = `
      <div class="index-progress" role="status" aria-live="polite">
        <div class="index-progress-head">
          <span class="spinner"></span>
          <span class="index-label">
            ${index.phase === "scanning" ? "Checking for changes" : "Indexing PDFs"}
            <strong>${index.processed}/${index.total}</strong>
          </span>
          <button class="icon-button" data-action="cancelIndex" title="Cancel indexing">${buttonIcon("close")}</button>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="index-detail">
          ${index.currentFile ? `<span title="${escapeHtml(index.currentFile)}">${escapeHtml(index.currentFile)}</span>` : ""}
          ${index.extracted ? `<span>${index.extracted} extracted</span>` : ""}
          ${index.cached ? `<span>${index.cached} cached</span>` : ""}
        </div>
      </div>`;
      return;
    }
    const parts = [];
    const search = state.search;
    if (search?.running) {
      parts.push(
        `<span class="spinner"></span><span>${search.nameOnly ? "Searching names" : "Searching PDF contents"}\u2026</span>`
      );
    } else if (search?.note) {
      parts.push(`<span>${escapeHtml(search.note)}</span>`);
    } else if (index.phase === "ready" && index.summary) {
      parts.push(`<span title="Index is up to date">${escapeHtml(index.summary)}</span>`);
    } else if (index.phase === "cancelled") {
      parts.push(`<span>Indexing cancelled \u2014 ${index.extracted} file(s) indexed so far</span>`);
    } else if (index.failed) {
      parts.push(`<span>${index.failed} PDF(s) could not be read</span>`);
    }
    if (!parts.length && state.externalCount === 0) {
      parts.push(`<span>${state.groups.length} group(s) \xB7 no external favorites yet</span>`);
    }
    statusEl.innerHTML = parts.length ? `<div class="status">${parts.join("")}</div>` : "";
  }
  function renderResults() {
    if (!state) {
      resultsEl.innerHTML = "";
      return;
    }
    const search = state.search;
    if (!search || !search.hits.length && !search.running) {
      if (search && !search.hits.length && !search.running) {
        resultsEl.innerHTML = `<div class="empty">No matches for \u201C${escapeHtml(search.text)}\u201D.</div>`;
      } else {
        resultsEl.innerHTML = "";
      }
      return;
    }
    if (search.running && !search.hits.length) {
      resultsEl.innerHTML = "";
      return;
    }
    resultsEl.innerHTML = search.hits.map((hit) => {
      const excerpt = hit.excerpt ? `<div class="hit-excerpt">${hit.source === "content" ? highlight(hit.excerpt, search.text) : escapeHtml(hit.excerpt)}</div>` : "";
      const name = highlight(hit.name, hit.source === "name" ? search.text : "");
      return `
        <div class="hit" role="button" tabindex="0" data-action="open" data-path="${escapeHtml(hit.path)}">
          <div class="hit-title">
            ${icon(hit.name.toLowerCase().endsWith(".pdf") ? "pdf" : "file", "file-icon pdf")}
            <span class="hit-name">${name}</span>
            ${hit.location ? `<span class="hit-loc">${escapeHtml(hit.location)}</span>` : ""}
            <span class="badge">${hit.source === "content" ? "text" : "name"}</span>
          </div>
          ${excerpt}
        </div>`;
    }).join("");
  }
  function renderSections() {
    if (!state) {
      sectionsEl.innerHTML = "";
      return;
    }
    sectionsEl.innerHTML = state.sections.map(renderSection).join("");
  }
  function renderSection(section) {
    const isCollapsed = collapsed.has(section.id);
    const fileCount = section.files?.length ?? section.groups?.reduce((sum, group) => sum + group.files.length, 0) ?? 0;
    const body = [];
    if (section.files?.length) {
      body.push(section.files.map((file) => renderFileRow(file, section)).join(""));
    }
    if (section.groups?.length) {
      body.push(
        section.groups.map((group) => {
          const rows = group.files.length ? group.files.map((file) => renderFileRow(file, section, group.id)).join("") : `<div class="empty">No files yet \u2014 right-click a file and choose \u201CAdd to Favorites\u201D.</div>`;
          if (group.smart) {
            return `
              <div class="group-title smart${group.enabled === false ? " disabled" : ""}">
                <span class="smart-icon">${buttonIconInline("wand")}</span>
                <span>${escapeHtml(group.title)}</span>
                <span class="detail">${group.files.length}</span>
                <span class="actions">
                  <button class="icon-button" data-action="toggleSmartGroup" data-group-id="${escapeHtml(group.id)}" title="${group.enabled === false ? "Enable rule" : "Disable rule"}">${buttonIcon(group.enabled === false ? "play" : "circle-slash")}</button>
                  <button class="icon-button" data-action="editSmartGroup" data-group-id="${escapeHtml(group.id)}" title="Edit rule">${buttonIcon("edit")}</button>
                  <button class="icon-button" data-action="deleteSmartGroup" data-group-id="${escapeHtml(group.id)}" title="Delete smart group">${buttonIcon("trash")}</button>
                </span>
              </div>
              ${group.hint ? `<div class="group-hint" title="${escapeHtml(group.hint)}">${escapeHtml(group.hint)}</div>` : ""}
              ${rows}`;
          }
          return `
            <div class="group-title">
              <span>${escapeHtml(group.title)}</span>
              <span class="detail">${group.files.length}</span>
              <span class="actions">
                <button class="icon-button" data-action="renameGroup" data-group-id="${escapeHtml(group.id)}" title="Rename group">${buttonIcon("edit")}</button>
                <button class="icon-button" data-action="deleteGroup" data-group-id="${escapeHtml(group.id)}" title="Delete group">${buttonIcon("trash")}</button>
              </span>
            </div>
            ${rows}`;
        }).join("")
      );
    }
    if (!body.length && section.hint) {
      body.push(`<div class="empty">${escapeHtml(section.hint)}</div>`);
    }
    return `
    <div class="section${isCollapsed ? " collapsed" : ""}">
      <button class="section-header" data-action="toggleSection" data-section-id="${escapeHtml(section.id)}">
        ${icon("chevron", "chevron")}
        <span>${escapeHtml(section.title)}</span>
        <span class="count">${fileCount}</span>
      </button>
      <div class="section-body">${body.join("")}</div>
    </div>`;
  }
  function renderFileRow(file, section, groupId) {
    const removable = section.id === "external" ? "removeExternal" : "removeFavorite";
    const automatic = section.supportsSmartGroups === true;
    const canMove = !automatic && section.supportsGroups === true && groupId !== void 0;
    return `
    <div class="file-row" role="button" tabindex="0" data-action="open" data-path="${escapeHtml(file.path)}" title="${escapeHtml(file.path)}">
      ${fileNameIcon(file)}
      <span class="name">${escapeHtml(file.name)}</span>
      ${file.detail ? `<span class="detail">${escapeHtml(file.detail)}</span>` : ""}
      ${shortPath(file) ? `<span class="detail">${escapeHtml(shortPath(file))}</span>` : ""}
      <span class="row-actions">
        ${canMove ? `<button class="icon-button" data-action="moveToGroup" data-path="${escapeHtml(file.path)}" title="Move to another group">${buttonIcon("list")}</button>` : ""}
        ${automatic ? `<button class="icon-button" data-action="editSmartGroup" data-group-id="${escapeHtml(groupId ?? "")}" title="Change the rule that collects this file">${buttonIcon("wand")}</button>` : `<button class="icon-button" data-action="${removable}" data-path="${escapeHtml(file.path)}" title="Remove">${buttonIcon("close")}</button>`}
      </span>
    </div>`;
  }
  post({ type: "ready" });
})();
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsibWFpbi50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLyoqXG4gKiBTaWRlYmFyIFVJIGZvciBQREYgSHViLlxuICpcbiAqIERlbGliZXJhdGVseSBmcmFtZXdvcmstZnJlZSBhbmQgZHJpdmVuIGJ5IGEgc2luZ2xlIHN0YXRlIG1lc3NhZ2UgZnJvbSB0aGVcbiAqIGV4dGVuc2lvbiBob3N0LCBzbyBhZGRpbmcgc2VjdGlvbnMgb3Igc2VhcmNoIHByb3ZpZGVycyBuZXZlciByZXF1aXJlcyBVSVxuICogY2hhbmdlcy4gVGhlIHNlYXJjaCBpbnB1dCBpcyByZW5kZXJlZCBvbmNlIGFuZCBuZXZlciByZS1jcmVhdGVkLCB3aGljaCBrZWVwc1xuICogdHlwaW5nIHNtb290aCB3aGlsZSByZXN1bHRzIHN0cmVhbSBpbi5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEhvc3RUb1dlYnZpZXcsIFVpRmlsZSwgVWlTZWN0aW9uLCBVaVN0YXRlLCBXZWJ2aWV3VG9Ib3N0IH0gZnJvbSAnLi4vLi4vc3JjL3VpL3Byb3RvY29sJztcblxuZGVjbGFyZSBmdW5jdGlvbiBhY3F1aXJlVnNDb2RlQXBpKCk6IHsgcG9zdE1lc3NhZ2UobWVzc2FnZTogdW5rbm93bik6IHZvaWQ7IHNldFN0YXRlKHN0YXRlOiB1bmtub3duKTogdm9pZCB9O1xuXG5jb25zdCB2c2NvZGUgPSBhY3F1aXJlVnNDb2RlQXBpKCk7XG5cbmNvbnN0IElDT05TOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xuICBoaXN0b3J5OiAnTTEzLjUgOGE1LjUgNS41IDAgMSAxLTEuNi0zLjlsMS4yLTEuMkE3IDcgMCAxIDAgMTUgOGgtMmwzIDMgMy0zaC0yYTUuNSA1LjUgMCAwIDEtMi41IDB6IE0xMSA1aDF2NGgzdjFoLTR6JyxcbiAgc3RhcjogJ004IDEuNWwxLjkgMy45IDQuMy42LTMuMSAzIC43IDQuM0w4IDExLjNsLTMuOCAyIC43LTQuMy0zLjEtMyA0LjMtLjZ6JyxcbiAgJ2xpbmstZXh0ZXJuYWwnOiAnTTYgMkgzYTEgMSAwIDAgMC0xIDF2MTBhMSAxIDAgMCAwIDEgMWgxMGExIDEgMCAwIDAgMS0xdi0zaC0xLjV2Mi41aC05di05SDZ6TTkgMnYxLjVoMi45TDYuNCA5bDEgMSA1LjYtNS41VjdIMTQuNVYyeicsXG4gIGxpc3Q6ICdNMiAzaDEydjEuNUgyek0yIDcuMjVoMTJ2MS41SDJ6TTIgMTEuNWgxMlYxM0gyeicsXG4gIHdhcm5pbmc6ICdNOCAxbDcgMTNIMXpNNy4yNSA1LjV2NGgxLjV2LTR6TTcuMjUgMTF2MS41aDEuNVYxMXonLFxuICBhZGQ6ICdNNy4yNSAyaDEuNXY1LjI1SDE0djEuNUg4Ljc1VjE0aC0xLjVWOC43NUgydi0xLjVoNS4yNXonLFxuICBlZGl0OiAnTTExLjMgMS45bDIuOCAyLjgtOC4yIDguMi0zLjQuNi42LTMuNHpNMiAxNGg0djEuNUgyeicsXG4gIHRyYXNoOiAnTTYgMS41aDRsLjUgMS41SDE0djEuNUgyVjNoMy41ek0zIDUuNWgxMGwtLjggOUgzLjh6JyxcbiAgY2xvc2U6ICdNMy4yIDIuMUw4IDYuOWw0LjgtNC44IDEuMSAxLjFMOS4xIDhsNC44IDQuOC0xLjEgMS4xTDggOS4xbC00LjggNC44LTEuMS0xLjFMNi45IDggMi4xIDMuMnonLFxuICByZWZyZXNoOiAnTTggMmE2IDYgMCAxIDEtNS43IDQuM2wxLjUuNUE0LjUgNC41IDAgMSAwIDggMy41VjZMNC41IDMuNSA4IDF6JyxcbiAgY2hldnJvbjogJ000LjIgNmwzLjggMy44TDExLjggNmwxIDEtNC44IDQuOEwzLjIgN3onLFxuICBmaWxlOiAnTTMgMS41aDZMMTMgNS41VjE0LjVIM3pNOC41IDIuNlY2SDEyeicsXG4gIHdhbmQ6ICdNMTEuNSAxLjVsLjkgMi4xIDIuMS45LTIuMS45LS45IDIuMS0uOS0yLjFMOC41IDQuNWwyLjEtLjl6TTIgMTIuNmw3LTcgMS40IDEuNC03IDdMMiAxNHonLFxuICAnY2lyY2xlLXNsYXNoJzogJ004IDEuNWE2LjUgNi41IDAgMSAwIDAgMTMgNi41IDYuNSAwIDAgMCAwLTEzem00LjkgM2wtNi40IDYuNEE1IDUgMCAwIDEgMTIuOSA0LjV6TTMuMSAxMS41bDYuNC02LjRhNSA1IDAgMCAxLTYuNCA2LjR6JyxcbiAgcGxheTogJ000LjUgMi41bDkgNS41LTkgNS41eicsXG4gIHBkZjogJ00zIDEuNWg2TDEzIDUuNVYxNC41SDN6TTguNSAyLjZWNkgxMnpNNC40IDExLjZjMS0uNSAyLS44IDMuMy0uOS40LS40LjgtLjkgMS0xLjQtLjQtMS0uNi0yLS4zLTIuNS40LS41IDEuMS0uMiAxLjIuNS4xLjctLjIgMS41LS41IDIuMS42IDEgMS40IDEuOCAyLjMgMi40LjUtLjEgMS0uMSAxLjQuMS41LjMuMiAxLS40IDEtLjcgMC0xLjMtLjQtMS45LS45LTEgLjItMiAuNi0yLjkgMS4xLS41IDEuMS0xLjEgMS45LTEuNiAxLjktLjQgMC0uNy0uNC0uNi0xIDAtLjcuNC0xLjQuOS0yeicsXG59O1xuXG5mdW5jdGlvbiBpY29uKG5hbWU6IHN0cmluZywgY2xhc3NOYW1lID0gJ2ZpbGUtaWNvbicpOiBzdHJpbmcge1xuICBjb25zdCBwYXRoID0gSUNPTlNbbmFtZV0gPz8gSUNPTlMuZmlsZTtcbiAgcmV0dXJuIGA8c3ZnIGNsYXNzPVwiJHtjbGFzc05hbWV9XCIgdmlld0JveD1cIjAgMCAxNiAxNlwiIGFyaWEtaGlkZGVuPVwidHJ1ZVwiPjxwYXRoIGQ9XCIke3BhdGh9XCIvPjwvc3ZnPmA7XG59XG5cbmZ1bmN0aW9uIGJ1dHRvbkljb24obmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGljb24obmFtZSwgJ2ljb24tYnV0dG9uJyk7XG59XG5cbmZ1bmN0aW9uIGJ1dHRvbkljb25JbmxpbmUobmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIGljb24obmFtZSwgJ2dyb3VwLWljb24nKTtcbn1cblxuZnVuY3Rpb24gcG9zdChtZXNzYWdlOiBXZWJ2aWV3VG9Ib3N0KTogdm9pZCB7XG4gIHZzY29kZS5wb3N0TWVzc2FnZShtZXNzYWdlKTtcbn1cblxuZnVuY3Rpb24gZXNjYXBlSHRtbCh2YWx1ZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHZhbHVlXG4gICAgLnJlcGxhY2UoLyYvZywgJyZhbXA7JylcbiAgICAucmVwbGFjZSgvPC9nLCAnJmx0OycpXG4gICAgLnJlcGxhY2UoLz4vZywgJyZndDsnKVxuICAgIC5yZXBsYWNlKC9cIi9nLCAnJnF1b3Q7Jyk7XG59XG5cbmZ1bmN0aW9uIGhpZ2hsaWdodCh0ZXh0OiBzdHJpbmcsIG5lZWRsZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3Qgc2FmZSA9IGVzY2FwZUh0bWwodGV4dCk7XG4gIGlmICghbmVlZGxlKSB7XG4gICAgcmV0dXJuIHNhZmU7XG4gIH1cbiAgY29uc3QgYXQgPSBzYWZlLnRvTG93ZXJDYXNlKCkuaW5kZXhPZihlc2NhcGVIdG1sKG5lZWRsZSkudG9Mb3dlckNhc2UoKSk7XG4gIGlmIChhdCA9PT0gLTEpIHtcbiAgICByZXR1cm4gc2FmZTtcbiAgfVxuICBjb25zdCBsZW4gPSBuZWVkbGUubGVuZ3RoO1xuICByZXR1cm4gYCR7c2FmZS5zbGljZSgwLCBhdCl9PG1hcms+JHtzYWZlLnNsaWNlKGF0LCBhdCArIGxlbil9PC9tYXJrPiR7c2FmZS5zbGljZShhdCArIGxlbil9YDtcbn1cblxuZnVuY3Rpb24gZmlsZU5hbWVJY29uKGZpbGU6IFVpRmlsZSk6IHN0cmluZyB7XG4gIGNvbnN0IGlzUGRmID0gZmlsZS5uYW1lLnRvTG93ZXJDYXNlKCkuZW5kc1dpdGgoJy5wZGYnKTtcbiAgcmV0dXJuIGljb24oaXNQZGYgPyAncGRmJyA6ICdmaWxlJywgYGZpbGUtaWNvbiR7aXNQZGYgPyAnIHBkZicgOiAnJ31gKTtcbn1cblxuZnVuY3Rpb24gc2hvcnRQYXRoKGZpbGU6IFVpRmlsZSk6IHN0cmluZyB7XG4gIGlmIChmaWxlLmV4dGVybmFsKSB7XG4gICAgcmV0dXJuICdPdXRzaWRlIHRoZSBwcm9qZWN0JztcbiAgfVxuICByZXR1cm4gZmlsZS5yZWxhdGl2ZVBhdGggPz8gJyc7XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gc2tlbGV0b25cblxuY29uc3Qgcm9vdCA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdhcHAnKSBhcyBIVE1MRWxlbWVudDtcblxucm9vdC5pbm5lckhUTUwgPSBgXG4gIDxkaXYgY2xhc3M9XCJodWJcIj5cbiAgICA8ZGl2IGNsYXNzPVwidG9vbGJhclwiPlxuICAgICAgPHNwYW4gY2xhc3M9XCJ0aXRsZVwiPlBERiBIdWI8L3NwYW4+XG4gICAgICA8YnV0dG9uIGNsYXNzPVwiaWNvbi1idXR0b25cIiBkYXRhLWFjdGlvbj1cImNyZWF0ZUdyb3VwXCIgdGl0bGU9XCJOZXcgZmF2b3JpdGVzIGdyb3VwXCI+JHtidXR0b25JY29uKCdhZGQnKX08L2J1dHRvbj5cbiAgICAgIDxidXR0b24gY2xhc3M9XCJpY29uLWJ1dHRvblwiIGRhdGEtYWN0aW9uPVwiY3JlYXRlU21hcnRHcm91cFwiIHRpdGxlPVwiTmV3IHNtYXJ0IGdyb3VwIChhdXRvLWNvbGxlY3RlZCBieSBwYXR0ZXJuKVwiPiR7YnV0dG9uSWNvbignd2FuZCcpfTwvYnV0dG9uPlxuICAgICAgPGJ1dHRvbiBjbGFzcz1cImljb24tYnV0dG9uXCIgZGF0YS1hY3Rpb249XCJyZWluZGV4XCIgdGl0bGU9XCJSZWJ1aWxkIFBERiBzZWFyY2ggaW5kZXhcIj4ke2J1dHRvbkljb24oJ3JlZnJlc2gnKX08L2J1dHRvbj5cbiAgICAgIDxidXR0b24gY2xhc3M9XCJpY29uLWJ1dHRvblwiIGRhdGEtYWN0aW9uPVwicmVmcmVzaFwiIHRpdGxlPVwiUmVmcmVzaFwiPiR7YnV0dG9uSWNvbignbGlzdCcpfTwvYnV0dG9uPlxuICAgIDwvZGl2PlxuXG4gICAgPGRpdiBjbGFzcz1cInNlYXJjaFwiPlxuICAgICAgPGRpdiBjbGFzcz1cInNlYXJjaC1yb3dcIj5cbiAgICAgICAgPGlucHV0IGlkPVwic2VhcmNoLWlucHV0XCIgdHlwZT1cInRleHRcIiBwbGFjZWhvbGRlcj1cIlNlYXJjaCBQREZzIChuYW1lcyArIGNvbnRlbnRzKVwiIHNwZWxsY2hlY2s9XCJmYWxzZVwiIGF1dG9jb21wbGV0ZT1cIm9mZlwiIC8+XG4gICAgICAgIDxidXR0b24gY2xhc3M9XCJjbGVhclwiIGlkPVwic2VhcmNoLWNsZWFyXCIgdHlwZT1cImJ1dHRvblwiIHRpdGxlPVwiQ2xlYXIgc2VhcmNoXCIgYXJpYS1sYWJlbD1cIkNsZWFyIHNlYXJjaFwiPiR7aWNvbignY2xvc2UnLCAnY2xlYXInKX08L2J1dHRvbj5cbiAgICAgIDwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cInNlYXJjaC1jb250cm9sc1wiPlxuICAgICAgICA8bGFiZWwgY2xhc3M9XCJ0b2dnbGVcIiB0aXRsZT1cIk9ubHkgbWF0Y2ggUERGIGZpbGUgbmFtZXMgYW5kIHBhdGhzXCI+XG4gICAgICAgICAgPGlucHV0IHR5cGU9XCJjaGVja2JveFwiIGlkPVwibmFtZS1vbmx5XCIgLz4gU2VhcmNoIG5hbWVzIG9ubHlcbiAgICAgICAgPC9sYWJlbD5cbiAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImljb24tYnV0dG9uXCIgZGF0YS1hY3Rpb249XCJvcGVuRXh0ZXJuYWxQaWNrZXJcIiB0aXRsZT1cIkFkZCBhIGZpbGUgb3V0c2lkZSB0aGUgcHJvamVjdFwiPiR7YnV0dG9uSWNvbignbGluay1leHRlcm5hbCcpfTwvYnV0dG9uPlxuICAgICAgPC9kaXY+XG4gICAgPC9kaXY+XG5cbiAgICA8ZGl2IGlkPVwic3RhdHVzXCI+PC9kaXY+XG4gICAgPGRpdiBjbGFzcz1cInJlc3VsdHNcIiBpZD1cInJlc3VsdHNcIj48L2Rpdj5cbiAgICA8ZGl2IGNsYXNzPVwic2VjdGlvbnNcIiBpZD1cInNlY3Rpb25zXCI+PC9kaXY+XG4gIDwvZGl2PlxuYDtcblxuY29uc3QgaW5wdXQgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2VhcmNoLWlucHV0JykgYXMgSFRNTElucHV0RWxlbWVudDtcbmNvbnN0IGNsZWFyQnV0dG9uID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3NlYXJjaC1jbGVhcicpIGFzIEhUTUxCdXR0b25FbGVtZW50O1xuY29uc3QgbmFtZU9ubHlCb3ggPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnbmFtZS1vbmx5JykgYXMgSFRNTElucHV0RWxlbWVudDtcbmNvbnN0IHN0YXR1c0VsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3N0YXR1cycpIGFzIEhUTUxFbGVtZW50O1xuY29uc3QgcmVzdWx0c0VsID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3Jlc3VsdHMnKSBhcyBIVE1MRWxlbWVudDtcbmNvbnN0IHNlY3Rpb25zRWwgPSBkb2N1bWVudC5nZXRFbGVtZW50QnlJZCgnc2VjdGlvbnMnKSBhcyBIVE1MRWxlbWVudDtcblxubGV0IHN0YXRlOiBVaVN0YXRlIHwgbnVsbCA9IG51bGw7XG5sZXQgZGVib3VuY2U6IG51bWJlciB8IHVuZGVmaW5lZDtcbmNvbnN0IGNvbGxhcHNlZCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gZXZlbnRzXG5cbmlucHV0LmFkZEV2ZW50TGlzdGVuZXIoJ2lucHV0JywgKCkgPT4ge1xuICBpZiAoZGVib3VuY2UpIHtcbiAgICB3aW5kb3cuY2xlYXJUaW1lb3V0KGRlYm91bmNlKTtcbiAgfVxuICBkZWJvdW5jZSA9IHdpbmRvdy5zZXRUaW1lb3V0KCgpID0+IHtcbiAgICBwb3N0KHsgdHlwZTogJ3NlYXJjaCcsIHRleHQ6IGlucHV0LnZhbHVlLCBuYW1lT25seTogbmFtZU9ubHlCb3guY2hlY2tlZCB9KTtcbiAgfSwgMTgwKTtcbn0pO1xuXG5pbnB1dC5hZGRFdmVudExpc3RlbmVyKCdrZXlkb3duJywgKGV2ZW50KSA9PiB7XG4gIGlmIChldmVudC5rZXkgPT09ICdFc2NhcGUnKSB7XG4gICAgaW5wdXQudmFsdWUgPSAnJztcbiAgICBwb3N0KHsgdHlwZTogJ3NlYXJjaCcsIHRleHQ6ICcnLCBuYW1lT25seTogbmFtZU9ubHlCb3guY2hlY2tlZCB9KTtcbiAgfVxufSk7XG5cbmNsZWFyQnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKCkgPT4ge1xuICBpbnB1dC52YWx1ZSA9ICcnO1xuICBpbnB1dC5mb2N1cygpO1xuICBwb3N0KHsgdHlwZTogJ3NlYXJjaCcsIHRleHQ6ICcnLCBuYW1lT25seTogbmFtZU9ubHlCb3guY2hlY2tlZCB9KTtcbn0pO1xuXG5uYW1lT25seUJveC5hZGRFdmVudExpc3RlbmVyKCdjaGFuZ2UnLCAoKSA9PiB7XG4gIHBvc3QoeyB0eXBlOiAnc2VhcmNoJywgdGV4dDogaW5wdXQudmFsdWUsIG5hbWVPbmx5OiBuYW1lT25seUJveC5jaGVja2VkIH0pO1xufSk7XG5cbmRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ2NsaWNrJywgKGV2ZW50KSA9PiB7XG4gIGNvbnN0IHRhcmdldCA9IChldmVudC50YXJnZXQgYXMgSFRNTEVsZW1lbnQgfCBudWxsKT8uY2xvc2VzdDxIVE1MRWxlbWVudD4oJ1tkYXRhLWFjdGlvbl0nKTtcbiAgaWYgKCF0YXJnZXQpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgYWN0aW9uID0gdGFyZ2V0LmRhdGFzZXQuYWN0aW9uID8/ICcnO1xuICBjb25zdCBwYXRoID0gdGFyZ2V0LmRhdGFzZXQucGF0aDtcbiAgY29uc3QgZ3JvdXBJZCA9IHRhcmdldC5kYXRhc2V0Lmdyb3VwSWQ7XG4gIHN3aXRjaCAoYWN0aW9uKSB7XG4gICAgY2FzZSAnb3Blbic6XG4gICAgICBpZiAocGF0aCkge1xuICAgICAgICBwb3N0KHsgdHlwZTogJ29wZW4nLCBwYXRoIH0pO1xuICAgICAgfVxuICAgICAgYnJlYWs7XG4gICAgY2FzZSAncmVtb3ZlRmF2b3JpdGUnOlxuICAgICAgaWYgKHBhdGgpIHtcbiAgICAgICAgcG9zdCh7IHR5cGU6ICdyZW1vdmVGYXZvcml0ZScsIHBhdGggfSk7XG4gICAgICB9XG4gICAgICBicmVhaztcbiAgICBjYXNlICdyZW1vdmVFeHRlcm5hbCc6XG4gICAgICBpZiAocGF0aCkge1xuICAgICAgICBwb3N0KHsgdHlwZTogJ3JlbW92ZUV4dGVybmFsJywgcGF0aCB9KTtcbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ21vdmVUb0dyb3VwJzpcbiAgICAgIGlmIChwYXRoKSB7XG4gICAgICAgIGNob29zZUdyb3VwVGhlbihwYXRoKTtcbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ3JlbmFtZUdyb3VwJzpcbiAgICAgIGlmIChncm91cElkKSB7XG4gICAgICAgIHBvc3QoeyB0eXBlOiAncmVuYW1lR3JvdXAnLCBncm91cElkIH0pO1xuICAgICAgfVxuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnZGVsZXRlR3JvdXAnOlxuICAgICAgaWYgKGdyb3VwSWQpIHtcbiAgICAgICAgcG9zdCh7IHR5cGU6ICdkZWxldGVHcm91cCcsIGdyb3VwSWQgfSk7XG4gICAgICB9XG4gICAgICBicmVhaztcbiAgICBjYXNlICdjcmVhdGVHcm91cCc6XG4gICAgICBwb3N0KHsgdHlwZTogJ2NyZWF0ZUdyb3VwJyB9KTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ2NyZWF0ZVNtYXJ0R3JvdXAnOlxuICAgICAgcG9zdCh7IHR5cGU6ICdjcmVhdGVTbWFydEdyb3VwJyB9KTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ2VkaXRTbWFydEdyb3VwJzpcbiAgICAgIGlmIChncm91cElkKSB7XG4gICAgICAgIHBvc3QoeyB0eXBlOiAnZWRpdFNtYXJ0R3JvdXAnLCBncm91cElkIH0pO1xuICAgICAgfVxuICAgICAgYnJlYWs7XG4gICAgY2FzZSAndG9nZ2xlU21hcnRHcm91cCc6XG4gICAgICBpZiAoZ3JvdXBJZCkge1xuICAgICAgICBwb3N0KHsgdHlwZTogJ3RvZ2dsZVNtYXJ0R3JvdXAnLCBncm91cElkIH0pO1xuICAgICAgfVxuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnZGVsZXRlU21hcnRHcm91cCc6XG4gICAgICBpZiAoZ3JvdXBJZCkge1xuICAgICAgICBwb3N0KHsgdHlwZTogJ2RlbGV0ZVNtYXJ0R3JvdXAnLCBncm91cElkIH0pO1xuICAgICAgfVxuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnY2FuY2VsSW5kZXgnOlxuICAgICAgcG9zdCh7IHR5cGU6ICdjYW5jZWxJbmRleCcgfSk7XG4gICAgICBicmVhaztcbiAgICBjYXNlICdvcGVuRXh0ZXJuYWxQaWNrZXInOlxuICAgICAgcG9zdCh7IHR5cGU6ICdvcGVuRXh0ZXJuYWxQaWNrZXInIH0pO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAncmVpbmRleCc6XG4gICAgICBwb3N0KHsgdHlwZTogJ3JlaW5kZXgnIH0pO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAncmVmcmVzaCc6XG4gICAgICBwb3N0KHsgdHlwZTogJ3JlZnJlc2gnIH0pO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAndG9nZ2xlU2VjdGlvbic6IHtcbiAgICAgIGNvbnN0IGlkID0gdGFyZ2V0LmRhdGFzZXQuc2VjdGlvbklkO1xuICAgICAgaWYgKGlkKSB7XG4gICAgICAgIGlmIChjb2xsYXBzZWQuaGFzKGlkKSkge1xuICAgICAgICAgIGNvbGxhcHNlZC5kZWxldGUoaWQpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNvbGxhcHNlZC5hZGQoaWQpO1xuICAgICAgICB9XG4gICAgICAgIHJlbmRlclNlY3Rpb25zKCk7XG4gICAgICB9XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgZGVmYXVsdDpcbiAgICAgIGJyZWFrO1xuICB9XG59KTtcblxuZnVuY3Rpb24gY2hvb3NlR3JvdXBUaGVuKHBhdGg6IHN0cmluZyk6IHZvaWQge1xuICBjb25zdCBncm91cHMgPSBzdGF0ZT8uZ3JvdXBzID8/IFtdO1xuICBpZiAoIWdyb3Vwcy5sZW5ndGgpIHtcbiAgICBwb3N0KHsgdHlwZTogJ2NyZWF0ZUdyb3VwJyB9KTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgbGlzdCA9IGdyb3Vwcy5tYXAoKGdyb3VwLCBpbmRleCkgPT4gYCR7aW5kZXggKyAxfTogJHtncm91cC5uYW1lfWApLmpvaW4oJ1xcbicpO1xuICBjb25zdCBhbnN3ZXIgPSB3aW5kb3cucHJvbXB0KGBNb3ZlIHRvIHdoaWNoIGdyb3VwP1xcbiR7bGlzdH1gLCAnMScpO1xuICBjb25zdCBpbmRleCA9IE51bWJlcihhbnN3ZXIpIC0gMTtcbiAgaWYgKE51bWJlci5pc0ludGVnZXIoaW5kZXgpICYmIGdyb3Vwc1tpbmRleF0pIHtcbiAgICBwb3N0KHsgdHlwZTogJ21vdmVUb0dyb3VwJywgcGF0aCwgZ3JvdXBJZDogZ3JvdXBzW2luZGV4XS5pZCB9KTtcbiAgfVxufVxuXG53aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIChldmVudDogTWVzc2FnZUV2ZW50PEhvc3RUb1dlYnZpZXc+KSA9PiB7XG4gIGNvbnN0IG1lc3NhZ2UgPSBldmVudC5kYXRhO1xuICBpZiAobWVzc2FnZS50eXBlID09PSAnc3RhdGUnKSB7XG4gICAgY29uc3QgcHJldmlvdXMgPSBzdGF0ZTtcbiAgICBzdGF0ZSA9IG1lc3NhZ2Uuc3RhdGU7XG4gICAgcmVuZGVyKHByZXZpb3VzKTtcbiAgfSBlbHNlIGlmIChtZXNzYWdlLnR5cGUgPT09ICdlcnJvcicpIHtcbiAgICBzdGF0dXNFbC5pbm5lckhUTUwgPSBgPGRpdiBjbGFzcz1cImVycm9yXCI+JHtlc2NhcGVIdG1sKG1lc3NhZ2UubWVzc2FnZSl9PC9kaXY+YDtcbiAgfVxufSk7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSByZW5kZXJcblxuZnVuY3Rpb24gcmVuZGVyKHByZXZpb3VzOiBVaVN0YXRlIHwgbnVsbCk6IHZvaWQge1xuICBpZiAoIXN0YXRlKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIHJlbmRlclN0YXR1cygpO1xuICByZW5kZXJSZXN1bHRzKCk7XG4gIHJlbmRlclNlY3Rpb25zKCk7XG5cbiAgY29uc3Qgc2VhcmNoID0gc3RhdGUuc2VhcmNoO1xuICBjb25zdCB0ZXh0Q2hhbmdlZCA9ICFwcmV2aW91cyB8fCBwcmV2aW91cy5zZWFyY2g/LnRleHQgIT09IHNlYXJjaD8udGV4dDtcbiAgY29uc3QgbW9kZUNoYW5nZWQgPSAhcHJldmlvdXMgfHwgcHJldmlvdXMuc2VhcmNoPy5uYW1lT25seSAhPT0gc2VhcmNoPy5uYW1lT25seTtcbiAgaWYgKHRleHRDaGFuZ2VkIHx8IG1vZGVDaGFuZ2VkKSB7XG4gICAgaWYgKGRvY3VtZW50LmFjdGl2ZUVsZW1lbnQgIT09IGlucHV0ICYmIHNlYXJjaCkge1xuICAgICAgaW5wdXQudmFsdWUgPSBzZWFyY2gudGV4dDtcbiAgICB9XG4gICAgbmFtZU9ubHlCb3guY2hlY2tlZCA9IHNlYXJjaCA/IHNlYXJjaC5uYW1lT25seSA6IG5hbWVPbmx5Qm94LmNoZWNrZWQ7XG4gIH1cbn1cblxuZnVuY3Rpb24gcmVuZGVyU3RhdHVzKCk6IHZvaWQge1xuICBpZiAoIXN0YXRlKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IGluZGV4ID0gc3RhdGUuaW5kZXg7XG4gIGNvbnN0IGJ1c3kgPSBpbmRleC5waGFzZSA9PT0gJ2luZGV4aW5nJyB8fCBpbmRleC5waGFzZSA9PT0gJ3NjYW5uaW5nJztcblxuICBpZiAoYnVzeSkge1xuICAgIGNvbnN0IHBjdCA9IGluZGV4LnRvdGFsID8gTWF0aC5yb3VuZCgoaW5kZXgucHJvY2Vzc2VkIC8gaW5kZXgudG90YWwpICogMTAwKSA6IDA7XG4gICAgc3RhdHVzRWwuaW5uZXJIVE1MID0gYFxuICAgICAgPGRpdiBjbGFzcz1cImluZGV4LXByb2dyZXNzXCIgcm9sZT1cInN0YXR1c1wiIGFyaWEtbGl2ZT1cInBvbGl0ZVwiPlxuICAgICAgICA8ZGl2IGNsYXNzPVwiaW5kZXgtcHJvZ3Jlc3MtaGVhZFwiPlxuICAgICAgICAgIDxzcGFuIGNsYXNzPVwic3Bpbm5lclwiPjwvc3Bhbj5cbiAgICAgICAgICA8c3BhbiBjbGFzcz1cImluZGV4LWxhYmVsXCI+XG4gICAgICAgICAgICAke2luZGV4LnBoYXNlID09PSAnc2Nhbm5pbmcnID8gJ0NoZWNraW5nIGZvciBjaGFuZ2VzJyA6ICdJbmRleGluZyBQREZzJ31cbiAgICAgICAgICAgIDxzdHJvbmc+JHtpbmRleC5wcm9jZXNzZWR9LyR7aW5kZXgudG90YWx9PC9zdHJvbmc+XG4gICAgICAgICAgPC9zcGFuPlxuICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJpY29uLWJ1dHRvblwiIGRhdGEtYWN0aW9uPVwiY2FuY2VsSW5kZXhcIiB0aXRsZT1cIkNhbmNlbCBpbmRleGluZ1wiPiR7YnV0dG9uSWNvbignY2xvc2UnKX08L2J1dHRvbj5cbiAgICAgICAgPC9kaXY+XG4gICAgICAgIDxkaXYgY2xhc3M9XCJwcm9ncmVzcy10cmFja1wiPjxkaXYgY2xhc3M9XCJwcm9ncmVzcy1maWxsXCIgc3R5bGU9XCJ3aWR0aDoke3BjdH0lXCI+PC9kaXY+PC9kaXY+XG4gICAgICAgIDxkaXYgY2xhc3M9XCJpbmRleC1kZXRhaWxcIj5cbiAgICAgICAgICAke2luZGV4LmN1cnJlbnRGaWxlID8gYDxzcGFuIHRpdGxlPVwiJHtlc2NhcGVIdG1sKGluZGV4LmN1cnJlbnRGaWxlKX1cIj4ke2VzY2FwZUh0bWwoaW5kZXguY3VycmVudEZpbGUpfTwvc3Bhbj5gIDogJyd9XG4gICAgICAgICAgJHtpbmRleC5leHRyYWN0ZWQgPyBgPHNwYW4+JHtpbmRleC5leHRyYWN0ZWR9IGV4dHJhY3RlZDwvc3Bhbj5gIDogJyd9XG4gICAgICAgICAgJHtpbmRleC5jYWNoZWQgPyBgPHNwYW4+JHtpbmRleC5jYWNoZWR9IGNhY2hlZDwvc3Bhbj5gIDogJyd9XG4gICAgICAgIDwvZGl2PlxuICAgICAgPC9kaXY+YDtcbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCBwYXJ0czogc3RyaW5nW10gPSBbXTtcbiAgY29uc3Qgc2VhcmNoID0gc3RhdGUuc2VhcmNoO1xuICBpZiAoc2VhcmNoPy5ydW5uaW5nKSB7XG4gICAgcGFydHMucHVzaChcbiAgICAgIGA8c3BhbiBjbGFzcz1cInNwaW5uZXJcIj48L3NwYW4+PHNwYW4+JHtcbiAgICAgICAgc2VhcmNoLm5hbWVPbmx5ID8gJ1NlYXJjaGluZyBuYW1lcycgOiAnU2VhcmNoaW5nIFBERiBjb250ZW50cydcbiAgICAgIH1cdTIwMjY8L3NwYW4+YFxuICAgICk7XG4gIH0gZWxzZSBpZiAoc2VhcmNoPy5ub3RlKSB7XG4gICAgcGFydHMucHVzaChgPHNwYW4+JHtlc2NhcGVIdG1sKHNlYXJjaC5ub3RlKX08L3NwYW4+YCk7XG4gIH0gZWxzZSBpZiAoaW5kZXgucGhhc2UgPT09ICdyZWFkeScgJiYgaW5kZXguc3VtbWFyeSkge1xuICAgIHBhcnRzLnB1c2goYDxzcGFuIHRpdGxlPVwiSW5kZXggaXMgdXAgdG8gZGF0ZVwiPiR7ZXNjYXBlSHRtbChpbmRleC5zdW1tYXJ5KX08L3NwYW4+YCk7XG4gIH0gZWxzZSBpZiAoaW5kZXgucGhhc2UgPT09ICdjYW5jZWxsZWQnKSB7XG4gICAgcGFydHMucHVzaChgPHNwYW4+SW5kZXhpbmcgY2FuY2VsbGVkIFx1MjAxNCAke2luZGV4LmV4dHJhY3RlZH0gZmlsZShzKSBpbmRleGVkIHNvIGZhcjwvc3Bhbj5gKTtcbiAgfSBlbHNlIGlmIChpbmRleC5mYWlsZWQpIHtcbiAgICBwYXJ0cy5wdXNoKGA8c3Bhbj4ke2luZGV4LmZhaWxlZH0gUERGKHMpIGNvdWxkIG5vdCBiZSByZWFkPC9zcGFuPmApO1xuICB9XG4gIGlmICghcGFydHMubGVuZ3RoICYmIHN0YXRlLmV4dGVybmFsQ291bnQgPT09IDApIHtcbiAgICBwYXJ0cy5wdXNoKGA8c3Bhbj4ke3N0YXRlLmdyb3Vwcy5sZW5ndGh9IGdyb3VwKHMpIFx1MDBCNyBubyBleHRlcm5hbCBmYXZvcml0ZXMgeWV0PC9zcGFuPmApO1xuICB9XG4gIHN0YXR1c0VsLmlubmVySFRNTCA9IHBhcnRzLmxlbmd0aCA/IGA8ZGl2IGNsYXNzPVwic3RhdHVzXCI+JHtwYXJ0cy5qb2luKCcnKX08L2Rpdj5gIDogJyc7XG59XG5cbmZ1bmN0aW9uIHJlbmRlclJlc3VsdHMoKTogdm9pZCB7XG4gIGlmICghc3RhdGUpIHtcbiAgICByZXN1bHRzRWwuaW5uZXJIVE1MID0gJyc7XG4gICAgcmV0dXJuO1xuICB9XG4gIGNvbnN0IHNlYXJjaCA9IHN0YXRlLnNlYXJjaDtcbiAgaWYgKCFzZWFyY2ggfHwgKCFzZWFyY2guaGl0cy5sZW5ndGggJiYgIXNlYXJjaC5ydW5uaW5nKSkge1xuICAgIGlmIChzZWFyY2ggJiYgIXNlYXJjaC5oaXRzLmxlbmd0aCAmJiAhc2VhcmNoLnJ1bm5pbmcpIHtcbiAgICAgIHJlc3VsdHNFbC5pbm5lckhUTUwgPSBgPGRpdiBjbGFzcz1cImVtcHR5XCI+Tm8gbWF0Y2hlcyBmb3IgXHUyMDFDJHtlc2NhcGVIdG1sKHNlYXJjaC50ZXh0KX1cdTIwMUQuPC9kaXY+YDtcbiAgICB9IGVsc2Uge1xuICAgICAgcmVzdWx0c0VsLmlubmVySFRNTCA9ICcnO1xuICAgIH1cbiAgICByZXR1cm47XG4gIH1cbiAgaWYgKHNlYXJjaC5ydW5uaW5nICYmICFzZWFyY2guaGl0cy5sZW5ndGgpIHtcbiAgICByZXN1bHRzRWwuaW5uZXJIVE1MID0gJyc7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgcmVzdWx0c0VsLmlubmVySFRNTCA9IHNlYXJjaC5oaXRzXG4gICAgLm1hcCgoaGl0KSA9PiB7XG4gICAgICBjb25zdCBleGNlcnB0ID0gaGl0LmV4Y2VycHRcbiAgICAgICAgPyBgPGRpdiBjbGFzcz1cImhpdC1leGNlcnB0XCI+JHtcbiAgICAgICAgICAgIGhpdC5zb3VyY2UgPT09ICdjb250ZW50J1xuICAgICAgICAgICAgICA/IGhpZ2hsaWdodChoaXQuZXhjZXJwdCwgc2VhcmNoLnRleHQpXG4gICAgICAgICAgICAgIDogZXNjYXBlSHRtbChoaXQuZXhjZXJwdClcbiAgICAgICAgICB9PC9kaXY+YFxuICAgICAgICA6ICcnO1xuICAgICAgY29uc3QgbmFtZSA9IGhpZ2hsaWdodChoaXQubmFtZSwgaGl0LnNvdXJjZSA9PT0gJ25hbWUnID8gc2VhcmNoLnRleHQgOiAnJyk7XG4gICAgICByZXR1cm4gYFxuICAgICAgICA8ZGl2IGNsYXNzPVwiaGl0XCIgcm9sZT1cImJ1dHRvblwiIHRhYmluZGV4PVwiMFwiIGRhdGEtYWN0aW9uPVwib3BlblwiIGRhdGEtcGF0aD1cIiR7ZXNjYXBlSHRtbChoaXQucGF0aCl9XCI+XG4gICAgICAgICAgPGRpdiBjbGFzcz1cImhpdC10aXRsZVwiPlxuICAgICAgICAgICAgJHtpY29uKGhpdC5uYW1lLnRvTG93ZXJDYXNlKCkuZW5kc1dpdGgoJy5wZGYnKSA/ICdwZGYnIDogJ2ZpbGUnLCAnZmlsZS1pY29uIHBkZicpfVxuICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJoaXQtbmFtZVwiPiR7bmFtZX08L3NwYW4+XG4gICAgICAgICAgICAke2hpdC5sb2NhdGlvbiA/IGA8c3BhbiBjbGFzcz1cImhpdC1sb2NcIj4ke2VzY2FwZUh0bWwoaGl0LmxvY2F0aW9uKX08L3NwYW4+YCA6ICcnfVxuICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJiYWRnZVwiPiR7aGl0LnNvdXJjZSA9PT0gJ2NvbnRlbnQnID8gJ3RleHQnIDogJ25hbWUnfTwvc3Bhbj5cbiAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICAke2V4Y2VycHR9XG4gICAgICAgIDwvZGl2PmA7XG4gICAgfSlcbiAgICAuam9pbignJyk7XG59XG5cbmZ1bmN0aW9uIHJlbmRlclNlY3Rpb25zKCk6IHZvaWQge1xuICBpZiAoIXN0YXRlKSB7XG4gICAgc2VjdGlvbnNFbC5pbm5lckhUTUwgPSAnJztcbiAgICByZXR1cm47XG4gIH1cbiAgc2VjdGlvbnNFbC5pbm5lckhUTUwgPSBzdGF0ZS5zZWN0aW9ucy5tYXAocmVuZGVyU2VjdGlvbikuam9pbignJyk7XG59XG5cbmZ1bmN0aW9uIHJlbmRlclNlY3Rpb24oc2VjdGlvbjogVWlTZWN0aW9uKTogc3RyaW5nIHtcbiAgY29uc3QgaXNDb2xsYXBzZWQgPSBjb2xsYXBzZWQuaGFzKHNlY3Rpb24uaWQpO1xuICBjb25zdCBmaWxlQ291bnQgPVxuICAgIHNlY3Rpb24uZmlsZXM/Lmxlbmd0aCA/PyBzZWN0aW9uLmdyb3Vwcz8ucmVkdWNlKChzdW0sIGdyb3VwKSA9PiBzdW0gKyBncm91cC5maWxlcy5sZW5ndGgsIDApID8/IDA7XG5cbiAgY29uc3QgYm9keTogc3RyaW5nW10gPSBbXTtcbiAgaWYgKHNlY3Rpb24uZmlsZXM/Lmxlbmd0aCkge1xuICAgIGJvZHkucHVzaChzZWN0aW9uLmZpbGVzLm1hcCgoZmlsZSkgPT4gcmVuZGVyRmlsZVJvdyhmaWxlLCBzZWN0aW9uKSkuam9pbignJykpO1xuICB9XG4gIGlmIChzZWN0aW9uLmdyb3Vwcz8ubGVuZ3RoKSB7XG4gICAgYm9keS5wdXNoKFxuICAgICAgc2VjdGlvbi5ncm91cHNcbiAgICAgICAgLm1hcCgoZ3JvdXApID0+IHtcbiAgICAgICAgICBjb25zdCByb3dzID0gZ3JvdXAuZmlsZXMubGVuZ3RoXG4gICAgICAgICAgICA/IGdyb3VwLmZpbGVzLm1hcCgoZmlsZSkgPT4gcmVuZGVyRmlsZVJvdyhmaWxlLCBzZWN0aW9uLCBncm91cC5pZCkpLmpvaW4oJycpXG4gICAgICAgICAgICA6IGA8ZGl2IGNsYXNzPVwiZW1wdHlcIj5ObyBmaWxlcyB5ZXQgXHUyMDE0IHJpZ2h0LWNsaWNrIGEgZmlsZSBhbmQgY2hvb3NlIFx1MjAxQ0FkZCB0byBGYXZvcml0ZXNcdTIwMUQuPC9kaXY+YDtcbiAgICAgICAgICBpZiAoZ3JvdXAuc21hcnQpIHtcbiAgICAgICAgICAgIHJldHVybiBgXG4gICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJncm91cC10aXRsZSBzbWFydCR7Z3JvdXAuZW5hYmxlZCA9PT0gZmFsc2UgPyAnIGRpc2FibGVkJyA6ICcnfVwiPlxuICAgICAgICAgICAgICAgIDxzcGFuIGNsYXNzPVwic21hcnQtaWNvblwiPiR7YnV0dG9uSWNvbklubGluZSgnd2FuZCcpfTwvc3Bhbj5cbiAgICAgICAgICAgICAgICA8c3Bhbj4ke2VzY2FwZUh0bWwoZ3JvdXAudGl0bGUpfTwvc3Bhbj5cbiAgICAgICAgICAgICAgICA8c3BhbiBjbGFzcz1cImRldGFpbFwiPiR7Z3JvdXAuZmlsZXMubGVuZ3RofTwvc3Bhbj5cbiAgICAgICAgICAgICAgICA8c3BhbiBjbGFzcz1cImFjdGlvbnNcIj5cbiAgICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJpY29uLWJ1dHRvblwiIGRhdGEtYWN0aW9uPVwidG9nZ2xlU21hcnRHcm91cFwiIGRhdGEtZ3JvdXAtaWQ9XCIke2VzY2FwZUh0bWwoZ3JvdXAuaWQpfVwiIHRpdGxlPVwiJHtncm91cC5lbmFibGVkID09PSBmYWxzZSA/ICdFbmFibGUgcnVsZScgOiAnRGlzYWJsZSBydWxlJ31cIj4ke2J1dHRvbkljb24oZ3JvdXAuZW5hYmxlZCA9PT0gZmFsc2UgPyAncGxheScgOiAnY2lyY2xlLXNsYXNoJyl9PC9idXR0b24+XG4gICAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwiaWNvbi1idXR0b25cIiBkYXRhLWFjdGlvbj1cImVkaXRTbWFydEdyb3VwXCIgZGF0YS1ncm91cC1pZD1cIiR7ZXNjYXBlSHRtbChncm91cC5pZCl9XCIgdGl0bGU9XCJFZGl0IHJ1bGVcIj4ke2J1dHRvbkljb24oJ2VkaXQnKX08L2J1dHRvbj5cbiAgICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJpY29uLWJ1dHRvblwiIGRhdGEtYWN0aW9uPVwiZGVsZXRlU21hcnRHcm91cFwiIGRhdGEtZ3JvdXAtaWQ9XCIke2VzY2FwZUh0bWwoZ3JvdXAuaWQpfVwiIHRpdGxlPVwiRGVsZXRlIHNtYXJ0IGdyb3VwXCI+JHtidXR0b25JY29uKCd0cmFzaCcpfTwvYnV0dG9uPlxuICAgICAgICAgICAgICAgIDwvc3Bhbj5cbiAgICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgICAgICR7Z3JvdXAuaGludCA/IGA8ZGl2IGNsYXNzPVwiZ3JvdXAtaGludFwiIHRpdGxlPVwiJHtlc2NhcGVIdG1sKGdyb3VwLmhpbnQpfVwiPiR7ZXNjYXBlSHRtbChncm91cC5oaW50KX08L2Rpdj5gIDogJyd9XG4gICAgICAgICAgICAgICR7cm93c31gO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gYFxuICAgICAgICAgICAgPGRpdiBjbGFzcz1cImdyb3VwLXRpdGxlXCI+XG4gICAgICAgICAgICAgIDxzcGFuPiR7ZXNjYXBlSHRtbChncm91cC50aXRsZSl9PC9zcGFuPlxuICAgICAgICAgICAgICA8c3BhbiBjbGFzcz1cImRldGFpbFwiPiR7Z3JvdXAuZmlsZXMubGVuZ3RofTwvc3Bhbj5cbiAgICAgICAgICAgICAgPHNwYW4gY2xhc3M9XCJhY3Rpb25zXCI+XG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImljb24tYnV0dG9uXCIgZGF0YS1hY3Rpb249XCJyZW5hbWVHcm91cFwiIGRhdGEtZ3JvdXAtaWQ9XCIke2VzY2FwZUh0bWwoZ3JvdXAuaWQpfVwiIHRpdGxlPVwiUmVuYW1lIGdyb3VwXCI+JHtidXR0b25JY29uKCdlZGl0Jyl9PC9idXR0b24+XG4gICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cImljb24tYnV0dG9uXCIgZGF0YS1hY3Rpb249XCJkZWxldGVHcm91cFwiIGRhdGEtZ3JvdXAtaWQ9XCIke2VzY2FwZUh0bWwoZ3JvdXAuaWQpfVwiIHRpdGxlPVwiRGVsZXRlIGdyb3VwXCI+JHtidXR0b25JY29uKCd0cmFzaCcpfTwvYnV0dG9uPlxuICAgICAgICAgICAgICA8L3NwYW4+XG4gICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICAgICR7cm93c31gO1xuICAgICAgICB9KVxuICAgICAgICAuam9pbignJylcbiAgICApO1xuICB9XG4gIGlmICghYm9keS5sZW5ndGggJiYgc2VjdGlvbi5oaW50KSB7XG4gICAgYm9keS5wdXNoKGA8ZGl2IGNsYXNzPVwiZW1wdHlcIj4ke2VzY2FwZUh0bWwoc2VjdGlvbi5oaW50KX08L2Rpdj5gKTtcbiAgfVxuXG4gIHJldHVybiBgXG4gICAgPGRpdiBjbGFzcz1cInNlY3Rpb24ke2lzQ29sbGFwc2VkID8gJyBjb2xsYXBzZWQnIDogJyd9XCI+XG4gICAgICA8YnV0dG9uIGNsYXNzPVwic2VjdGlvbi1oZWFkZXJcIiBkYXRhLWFjdGlvbj1cInRvZ2dsZVNlY3Rpb25cIiBkYXRhLXNlY3Rpb24taWQ9XCIke2VzY2FwZUh0bWwoc2VjdGlvbi5pZCl9XCI+XG4gICAgICAgICR7aWNvbignY2hldnJvbicsICdjaGV2cm9uJyl9XG4gICAgICAgIDxzcGFuPiR7ZXNjYXBlSHRtbChzZWN0aW9uLnRpdGxlKX08L3NwYW4+XG4gICAgICAgIDxzcGFuIGNsYXNzPVwiY291bnRcIj4ke2ZpbGVDb3VudH08L3NwYW4+XG4gICAgICA8L2J1dHRvbj5cbiAgICAgIDxkaXYgY2xhc3M9XCJzZWN0aW9uLWJvZHlcIj4ke2JvZHkuam9pbignJyl9PC9kaXY+XG4gICAgPC9kaXY+YDtcbn1cblxuZnVuY3Rpb24gcmVuZGVyRmlsZVJvdyhmaWxlOiBVaUZpbGUsIHNlY3Rpb246IFVpU2VjdGlvbiwgZ3JvdXBJZD86IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHJlbW92YWJsZSA9IHNlY3Rpb24uaWQgPT09ICdleHRlcm5hbCcgPyAncmVtb3ZlRXh0ZXJuYWwnIDogJ3JlbW92ZUZhdm9yaXRlJztcbiAgLy8gRmlsZXMgaW4gYSBzbWFydCBncm91cCBhcmUgY29sbGVjdGVkIGJ5IGEgcnVsZSwgc28gdGhleSBjYW5ub3QgYmUgcmVtb3ZlZFxuICAvLyBpbmRpdmlkdWFsbHk7IHRoZSBydWxlIGhhcyB0byBjaGFuZ2UgaW5zdGVhZC5cbiAgY29uc3QgYXV0b21hdGljID0gc2VjdGlvbi5zdXBwb3J0c1NtYXJ0R3JvdXBzID09PSB0cnVlO1xuICBjb25zdCBjYW5Nb3ZlID0gIWF1dG9tYXRpYyAmJiBzZWN0aW9uLnN1cHBvcnRzR3JvdXBzID09PSB0cnVlICYmIGdyb3VwSWQgIT09IHVuZGVmaW5lZDtcbiAgcmV0dXJuIGBcbiAgICA8ZGl2IGNsYXNzPVwiZmlsZS1yb3dcIiByb2xlPVwiYnV0dG9uXCIgdGFiaW5kZXg9XCIwXCIgZGF0YS1hY3Rpb249XCJvcGVuXCIgZGF0YS1wYXRoPVwiJHtlc2NhcGVIdG1sKGZpbGUucGF0aCl9XCIgdGl0bGU9XCIke2VzY2FwZUh0bWwoZmlsZS5wYXRoKX1cIj5cbiAgICAgICR7ZmlsZU5hbWVJY29uKGZpbGUpfVxuICAgICAgPHNwYW4gY2xhc3M9XCJuYW1lXCI+JHtlc2NhcGVIdG1sKGZpbGUubmFtZSl9PC9zcGFuPlxuICAgICAgJHtmaWxlLmRldGFpbCA/IGA8c3BhbiBjbGFzcz1cImRldGFpbFwiPiR7ZXNjYXBlSHRtbChmaWxlLmRldGFpbCl9PC9zcGFuPmAgOiAnJ31cbiAgICAgICR7c2hvcnRQYXRoKGZpbGUpID8gYDxzcGFuIGNsYXNzPVwiZGV0YWlsXCI+JHtlc2NhcGVIdG1sKHNob3J0UGF0aChmaWxlKSl9PC9zcGFuPmAgOiAnJ31cbiAgICAgIDxzcGFuIGNsYXNzPVwicm93LWFjdGlvbnNcIj5cbiAgICAgICAgJHtcbiAgICAgICAgICBjYW5Nb3ZlXG4gICAgICAgICAgICA/IGA8YnV0dG9uIGNsYXNzPVwiaWNvbi1idXR0b25cIiBkYXRhLWFjdGlvbj1cIm1vdmVUb0dyb3VwXCIgZGF0YS1wYXRoPVwiJHtlc2NhcGVIdG1sKGZpbGUucGF0aCl9XCIgdGl0bGU9XCJNb3ZlIHRvIGFub3RoZXIgZ3JvdXBcIj4ke2J1dHRvbkljb24oJ2xpc3QnKX08L2J1dHRvbj5gXG4gICAgICAgICAgICA6ICcnXG4gICAgICAgIH1cbiAgICAgICAgJHtcbiAgICAgICAgICBhdXRvbWF0aWNcbiAgICAgICAgICAgID8gYDxidXR0b24gY2xhc3M9XCJpY29uLWJ1dHRvblwiIGRhdGEtYWN0aW9uPVwiZWRpdFNtYXJ0R3JvdXBcIiBkYXRhLWdyb3VwLWlkPVwiJHtlc2NhcGVIdG1sKGdyb3VwSWQgPz8gJycpfVwiIHRpdGxlPVwiQ2hhbmdlIHRoZSBydWxlIHRoYXQgY29sbGVjdHMgdGhpcyBmaWxlXCI+JHtidXR0b25JY29uKCd3YW5kJyl9PC9idXR0b24+YFxuICAgICAgICAgICAgOiBgPGJ1dHRvbiBjbGFzcz1cImljb24tYnV0dG9uXCIgZGF0YS1hY3Rpb249XCIke3JlbW92YWJsZX1cIiBkYXRhLXBhdGg9XCIke2VzY2FwZUh0bWwoZmlsZS5wYXRoKX1cIiB0aXRsZT1cIlJlbW92ZVwiPiR7YnV0dG9uSWNvbignY2xvc2UnKX08L2J1dHRvbj5gXG4gICAgICAgIH1cbiAgICAgIDwvc3Bhbj5cbiAgICA8L2Rpdj5gO1xufVxuXG5wb3N0KHsgdHlwZTogJ3JlYWR5JyB9KTtcbiJdLAogICJtYXBwaW5ncyI6ICI7OztBQWFBLE1BQU0sU0FBUyxpQkFBaUI7QUFFaEMsTUFBTSxRQUFnQztBQUFBLElBQ3BDLFNBQVM7QUFBQSxJQUNULE1BQU07QUFBQSxJQUNOLGlCQUFpQjtBQUFBLElBQ2pCLE1BQU07QUFBQSxJQUNOLFNBQVM7QUFBQSxJQUNULEtBQUs7QUFBQSxJQUNMLE1BQU07QUFBQSxJQUNOLE9BQU87QUFBQSxJQUNQLE9BQU87QUFBQSxJQUNQLFNBQVM7QUFBQSxJQUNULFNBQVM7QUFBQSxJQUNULE1BQU07QUFBQSxJQUNOLE1BQU07QUFBQSxJQUNOLGdCQUFnQjtBQUFBLElBQ2hCLE1BQU07QUFBQSxJQUNOLEtBQUs7QUFBQSxFQUNQO0FBRUEsV0FBUyxLQUFLLE1BQWMsWUFBWSxhQUFxQjtBQUMzRCxVQUFNLE9BQU8sTUFBTSxJQUFJLEtBQUssTUFBTTtBQUNsQyxXQUFPLGVBQWUsU0FBUyxxREFBcUQsSUFBSTtBQUFBLEVBQzFGO0FBRUEsV0FBUyxXQUFXLE1BQXNCO0FBQ3hDLFdBQU8sS0FBSyxNQUFNLGFBQWE7QUFBQSxFQUNqQztBQUVBLFdBQVMsaUJBQWlCLE1BQXNCO0FBQzlDLFdBQU8sS0FBSyxNQUFNLFlBQVk7QUFBQSxFQUNoQztBQUVBLFdBQVMsS0FBSyxTQUE4QjtBQUMxQyxXQUFPLFlBQVksT0FBTztBQUFBLEVBQzVCO0FBRUEsV0FBUyxXQUFXLE9BQXVC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
