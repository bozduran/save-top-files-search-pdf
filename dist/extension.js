"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode7 = __toESM(require("vscode"));

// src/api/registry.ts
var ProviderRegistry = class {
  searchProviders = /* @__PURE__ */ new Map();
  sectionProviders = /* @__PURE__ */ new Map();
  /** Generic feature hooks: name -> callbacks, for future functionality. */
  hooks = /* @__PURE__ */ new Map();
  /** Called whenever the registry changes, so the sidebar can re-query. */
  listeners = /* @__PURE__ */ new Set();
  onDidChange(listener) {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }
  notify() {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
      }
    }
  }
  registerSearchProvider(provider) {
    if (this.searchProviders.has(provider.id)) {
      throw new Error(`Search provider "${provider.id}" is already registered.`);
    }
    this.searchProviders.set(provider.id, provider);
    this.notify();
    return { dispose: () => this.unregisterSearchProvider(provider.id) };
  }
  unregisterSearchProvider(id) {
    if (this.searchProviders.delete(id)) {
      this.notify();
    }
  }
  registerSectionProvider(provider) {
    if (this.sectionProviders.has(provider.id)) {
      throw new Error(`Section provider "${provider.id}" is already registered.`);
    }
    this.sectionProviders.set(provider.id, provider);
    this.notify();
    return { dispose: () => this.unregisterSectionProvider(provider.id) };
  }
  unregisterSectionProvider(id) {
    if (this.sectionProviders.delete(id)) {
      this.notify();
    }
  }
  getSearchProviders() {
    return [...this.searchProviders.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  }
  getSectionProviders() {
    return [...this.sectionProviders.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  }
  /** Extension hook: `api.hook('onFileOpened', fn)` to observe or extend behaviour. */
  hook(name, callback) {
    let set = this.hooks.get(name);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      this.hooks.set(name, set);
    }
    set.add(callback);
    return { dispose: () => set?.delete(callback) };
  }
  async fire(name, ...args) {
    const set = this.hooks.get(name);
    if (!set) {
      return;
    }
    for (const callback of [...set]) {
      try {
        await callback(...args);
      } catch {
      }
    }
  }
  dispose() {
    this.searchProviders.clear();
    this.sectionProviders.clear();
    this.hooks.clear();
    this.listeners.clear();
  }
};

// src/api/providers/pdfSearchProvider.ts
var PdfSearchProvider = class {
  constructor(service, getExternal) {
    this.service = service;
    this.getExternal = getExternal;
  }
  id = "pdf";
  label = "PDF";
  order = 10;
  async search(query) {
    const files = await this.service.searchableFiles(this.getExternal());
    const nameHits = this.service.searchNames(query.text, files).map((file) => ({
      path: file.path,
      name: file.name,
      location: file.relativePath ?? "external",
      source: "name",
      excerpt: file.relativePath && file.relativePath !== file.name ? file.relativePath : void 0
    }));
    if (query.nameOnly) {
      return { providerId: this.id, label: this.label, hits: nameHits };
    }
    await this.service.ensureIndex();
    const contentHits = await this.service.searchContent(query.text, files, query.token);
    const hits = [...nameHits];
    for (const hit of contentHits) {
      if (query.token.isCancellationRequested) {
        break;
      }
      for (const match of hit.matches.slice(0, 5)) {
        hits.push({
          path: hit.file.path,
          name: hit.file.name,
          location: `Page ${match.page}`,
          excerpt: match.excerpt,
          matchLength: match.length,
          source: "content"
        });
      }
      if (hit.matches.length > 5) {
        hits.push({
          path: hit.file.path,
          name: hit.file.name,
          location: `${hit.matchCount - 5} more matches`,
          excerpt: `Open to see the remaining matches in ${hit.file.name}`,
          source: "content"
        });
      }
    }
    const note = this.service.isIndexed() ? void 0 : "Content index still warming up";
    return { providerId: this.id, label: this.label, hits, note };
  }
};

// src/api/providers/recentProvider.ts
var RecentFilesProvider = class {
  constructor(store, workspaceFiles) {
    this.store = store;
    this.workspaceFiles = workspaceFiles;
  }
  id = "recent";
  label = "Top files";
  order = 10;
  async getSections() {
    const top = this.store.getTopFiles(true);
    const names = new Map(this.workspaceFiles().map((f) => [f.path.replace(/\\/g, "/").toLowerCase(), f]));
    return [
      {
        id: "recent",
        title: "Most opened in this project",
        items: top.map((stat3) => {
          const key = stat3.path.replace(/\\/g, "/").toLowerCase();
          const known = names.get(key);
          return {
            kind: "file",
            file: known ?? {
              path: stat3.path,
              name: stat3.name,
              relativePath: stat3.relativePath
            },
            detail: `${stat3.count}\xD7`
          };
        }),
        hint: top.length ? void 0 : "Open some files and they will show up here."
      }
    ];
  }
};

// src/api/providers/favoritesProvider.ts
var FavoritesProvider = class {
  id = "favorites";
  label = "Favorites";
  order = 20;
  store;
  constructor(store) {
    this.store = store;
  }
  async getSections() {
    const groups = this.store.getGroups();
    return [
      {
        id: "favorites",
        title: "Favorite files",
        groups: groups.map((group) => ({
          id: group.id,
          title: group.name,
          items: group.files.map((file) => ({ kind: "file", file, groupId: group.id }))
        })),
        hint: groups.length ? void 0 : 'Right-click a file in the Explorer and choose "Add to Favorites".'
      }
    ];
  }
};

// src/api/providers/externalProvider.ts
var ExternalFilesProvider = class {
  id = "external";
  label = "Outside the project";
  order = 30;
  store;
  constructor(store) {
    this.store = store;
  }
  async getSections() {
    const files = this.store.getExternal();
    const max = this.store.externalMax;
    const shots = [];
    if (files.length === 0) {
      return shots;
    }
    shots.push({
      id: "external",
      title: "Favorites outside the project",
      items: files.map((file) => ({ kind: "file", file })),
      hint: `${files.length}/${max} used \u2014 ${max - files.length} slot(s) left`
    });
    return shots;
  }
};

// src/api/providers/smartGroupsProvider.ts
var fs = __toESM(require("node:fs/promises"));

// src/search/glob.ts
function normalizePath(value) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/{2,}/g, "/");
}
function expandBraces(pattern) {
  const open = pattern.indexOf("{");
  if (open === -1) {
    return [pattern];
  }
  let depth = 0;
  let close = -1;
  for (let i = open; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) {
    return [pattern];
  }
  const prefix = pattern.slice(0, open);
  const body = pattern.slice(open + 1, close);
  const suffix = pattern.slice(close + 1);
  const options = [];
  let current = "";
  let nesting = 0;
  for (const char of body) {
    if (char === "{") {
      nesting += 1;
    } else if (char === "}") {
      nesting -= 1;
    }
    if (char === "," && nesting === 0) {
      options.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  options.push(current);
  return options.flatMap((option) => expandBraces(`${prefix}${option}${suffix}`));
}
function globToRegExpSource(pattern) {
  let source = "";
  let i = 0;
  while (i < pattern.length) {
    const char = pattern[i];
    if (char === "*" && pattern[i + 1] === "*" && (i === 0 || pattern[i - 1] === "/")) {
      if (pattern[i + 2] === "/") {
        source += "(?:[^/]+/)*";
        i += 3;
        continue;
      }
      source += ".*";
      i += 2;
      continue;
    }
    if (char === "*") {
      source += "[^/]*";
      i += 1;
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      i += 1;
      continue;
    }
    if (char === "[") {
      const close = pattern.indexOf("]", i + 1);
      if (close === -1) {
        source += "\\[";
        i += 1;
        continue;
      }
      let body = pattern.slice(i + 1, close);
      let negated = false;
      if (body.startsWith("!") || body.startsWith("^")) {
        negated = true;
        body = body.slice(1);
      }
      const escaped = body.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
      source += `[${negated ? "^" : ""}${escaped}]`;
      i = close + 1;
      continue;
    }
    source += char.replace(/[.+^${}()|\\[\]]/g, "\\$&");
    i += 1;
  }
  return source;
}
function compileOne(pattern, ignoreCase) {
  return new RegExp(`^${globToRegExpSource(pattern)}$`, ignoreCase ? "i" : "");
}
var CACHE_LIMIT = 512;
var compiledCache = /* @__PURE__ */ new Map();
function compile(pattern, ignoreCase) {
  const normalized = normalizePath(pattern);
  const key = `${ignoreCase ? "i" : "s"}\0${normalized}`;
  const cached = compiledCache.get(key);
  if (cached) {
    compiledCache.delete(key);
    compiledCache.set(key, cached);
    return cached;
  }
  const expanded = expandBraces(normalized);
  const value = {
    full: expanded.map((entry) => compileOne(entry, ignoreCase)),
    suffix: normalized.includes("/") ? [] : expanded.map((entry) => compileOne(entry, ignoreCase))
  };
  compiledCache.set(key, value);
  if (compiledCache.size > CACHE_LIMIT) {
    const oldest = compiledCache.keys().next().value;
    if (oldest !== void 0) {
      compiledCache.delete(oldest);
    }
  }
  return value;
}
function matchesGlob(pattern, relativePath, ignoreCase = true) {
  const path3 = normalizePath(relativePath);
  const { full, suffix } = compile(pattern, ignoreCase);
  for (const matcher of full) {
    if (matcher.test(path3)) {
      return true;
    }
  }
  if (suffix.length) {
    const parts = path3.split("/");
    const name = parts[parts.length - 1];
    for (const matcher of suffix) {
      if (matcher.test(name)) {
        return true;
      }
    }
    for (let i = 1; i < parts.length; i += 1) {
      const candidate = parts.slice(i).join("/");
      for (const matcher of suffix) {
        if (matcher.test(candidate)) {
          return true;
        }
      }
    }
  }
  return false;
}
function matchesRegex(source, relativePath, ignoreCase = true) {
  try {
    const flags = ignoreCase ? "i" : "";
    return new RegExp(source, flags).test(normalizePath(relativePath));
  } catch {
    return false;
  }
}

// src/search/smartRules.ts
function patternsFrom(value) {
  return (value ?? []).map((entry) => entry.trim()).filter(Boolean);
}
function daysToMs(days) {
  return Math.max(0, days) * 24 * 60 * 60 * 1e3;
}
function evaluateRule(rule, candidate, now = Date.now()) {
  const reasons = [];
  const misses = [];
  const ignoreCase = rule.ignoreCase;
  const path3 = normalizePath(candidate.relativePath);
  const includeGlobs = patternsFrom(rule.conditions.includeGlobs);
  const excludeGlobs = patternsFrom(rule.conditions.excludeGlobs);
  const extensions = patternsFrom(rule.conditions.extensions).map(
    (ext) => ext.replace(/^\./, "").toLowerCase()
  );
  const positives = [];
  if (includeGlobs.length) {
    const hit = includeGlobs.some((pattern) => matchesGlob(pattern, path3, ignoreCase));
    const matchedPattern = includeGlobs.find((pattern) => matchesGlob(pattern, path3, ignoreCase));
    positives.push({
      label: `matches ${matchedPattern ?? includeGlobs.join(" or ")}`,
      hit
    });
  }
  if (rule.conditions.includeRegex) {
    const hit = matchesRegex(rule.conditions.includeRegex, path3, ignoreCase);
    positives.push({ label: `matches /${rule.conditions.includeRegex}/`, hit });
  }
  if (rule.conditions.globOrRegex && positives.length > 1) {
    const combined = {
      label: positives.map((entry) => entry.label).join(" or "),
      hit: positives.some((entry) => entry.hit)
    };
    positives.length = 0;
    positives.push(combined);
  }
  if (extensions.length) {
    const ext = (candidate.name.split(".").pop() ?? "").toLowerCase();
    positives.push({ label: `extension .${ext || "?"}`, hit: extensions.includes(ext) });
  }
  if (rule.conditions.minSizeKb !== void 0) {
    const kb = (candidate.sizeBytes ?? 0) / 1024;
    positives.push({ label: `at least ${rule.conditions.minSizeKb} KB`, hit: kb >= rule.conditions.minSizeKb });
  }
  if (rule.conditions.maxSizeKb !== void 0) {
    const kb = (candidate.sizeBytes ?? 0) / 1024;
    positives.push({ label: `at most ${rule.conditions.maxSizeKb} KB`, hit: kb <= rule.conditions.maxSizeKb });
  }
  if (rule.conditions.modifiedWithinDays !== void 0) {
    const age = now - (candidate.modifiedMs ?? 0);
    positives.push({
      label: `changed in the last ${rule.conditions.modifiedWithinDays} day(s)`,
      hit: age >= 0 && age <= daysToMs(rule.conditions.modifiedWithinDays)
    });
  }
  for (const condition of positives) {
    (condition.hit ? reasons : misses).push(condition.label);
  }
  let matched;
  if (!positives.length) {
    matched = true;
  } else if (rule.matchMode === "any") {
    matched = positives.some((condition) => condition.hit);
  } else {
    matched = positives.every((condition) => condition.hit);
  }
  for (const pattern of excludeGlobs) {
    if (matchesGlob(pattern, path3, ignoreCase)) {
      matched = false;
      misses.push(`excluded by ${pattern}`);
    }
  }
  return { matched, reasons, misses };
}
function filterByRule(rule, candidates, now = Date.now()) {
  return candidates.filter((candidate) => evaluateRule(rule, candidate, now).matched);
}
function describeRule(rule) {
  const parts = [];
  const { includeGlobs, excludeGlobs, includeRegex, extensions, minSizeKb, maxSizeKb, modifiedWithinDays } = rule.conditions;
  const globs = patternsFrom(includeGlobs);
  if (globs.length) {
    parts.push(globs.join(" or "));
  }
  if (includeRegex) {
    parts.push(`/${includeRegex}/`);
  }
  const exts = patternsFrom(extensions);
  if (exts.length) {
    parts.push(`*.{${exts.map((e) => e.replace(/^\./, "")).join(",")}}`);
  }
  if (minSizeKb !== void 0 || maxSizeKb !== void 0) {
    parts.push(`${minSizeKb ?? 0}\u2013${maxSizeKb ?? "\u221E"} KB`);
  }
  if (modifiedWithinDays !== void 0) {
    parts.push(`changed in ${modifiedWithinDays}d`);
  }
  const excluded = patternsFrom(excludeGlobs);
  if (!parts.length && !excluded.length) {
    return "everything (no conditions yet)";
  }
  parts.push(rule.matchMode === "any" ? "any of these" : "all of these");
  const base = parts.length > 1 ? parts.join(" \xB7 ") : "everything";
  return excluded.length ? `${base} \xB7 except ${excluded.join(", ")}` : base;
}
function validateRule(rule) {
  const problems = [];
  if (!rule.name.trim()) {
    problems.push("A name is required.");
  }
  const { includeGlobs, excludeGlobs, includeRegex, extensions, minSizeKb, maxSizeKb, modifiedWithinDays } = rule.conditions;
  const hasPositive = patternsFrom(includeGlobs).length > 0 || Boolean(includeRegex) || patternsFrom(extensions).length > 0 || minSizeKb !== void 0 || maxSizeKb !== void 0 || modifiedWithinDays !== void 0;
  if (!hasPositive) {
    problems.push("Add at least one condition (a pattern, extension, size or date filter).");
  }
  if (includeRegex && !isValidRegexSafe(includeRegex)) {
    problems.push(`The regular expression /${includeRegex}/ is not valid.`);
  }
  for (const pattern of [...patternsFrom(includeGlobs), ...patternsFrom(excludeGlobs)]) {
    if (pattern.includes("[") && !pattern.includes("]")) {
      problems.push(`The pattern "${pattern}" has an unclosed character class.`);
    }
  }
  if (minSizeKb !== void 0 && maxSizeKb !== void 0 && minSizeKb > maxSizeKb) {
    problems.push("The minimum size is larger than the maximum size.");
  }
  if (modifiedWithinDays !== void 0 && modifiedWithinDays <= 0) {
    problems.push("The recency window must be at least one day.");
  }
  return problems;
}
function isValidRegexSafe(source) {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}
function createRule(name, conditions, overrides = {}) {
  return {
    id: overrides.id ?? `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    description: overrides.description,
    enabled: overrides.enabled ?? true,
    matchMode: overrides.matchMode ?? "all",
    ignoreCase: overrides.ignoreCase ?? true,
    order: overrides.order ?? 100,
    ...overrides,
    // The explicitly passed name and conditions always win over the overrides.
    name,
    conditions
  };
}

// src/api/providers/smartGroupsProvider.ts
var SmartGroupsProvider = class {
  id = "smart";
  label = "Smart groups";
  order = 15;
  store;
  candidates;
  options;
  constructor(store, candidates, options = {}) {
    this.store = store;
    this.candidates = candidates;
    this.options = options;
  }
  async getSections() {
    const rules = this.store.getSmartGroups();
    if (!rules.length) {
      return [];
    }
    const files = this.candidates();
    const metadata = await this.collectMetadata(files);
    const now = this.options.now?.() ?? Date.now();
    const groups = rules.filter((rule) => rule.enabled).map((rule) => {
      const candidates = files.map((file) => ({
        relativePath: file.relativePath ?? file.name,
        name: file.name,
        sizeBytes: metadata.get(file.path)?.sizeBytes,
        modifiedMs: metadata.get(file.path)?.modifiedMs
      }));
      const matchedFiles = files.filter(
        (_, index) => filterByRule(rule, [candidates[index]], now).length > 0
      );
      const invalid = validateRule(rule);
      return {
        id: rule.id,
        title: rule.name,
        items: matchedFiles.map((file) => ({ kind: "file", file })),
        hint: invalid.length > 0 ? `Rule needs attention: ${invalid[0]}` : describeRule(rule),
        rules: [rule]
      };
    });
    return [
      {
        id: "smart",
        title: "Smart groups",
        groups: groups.map((group) => ({
          id: group.id,
          title: group.title,
          items: group.items,
          hint: group.hint
        })),
        hint: groups.length ? void 0 : "Add a smart group to auto-collect files by pattern."
      }
    ];
  }
  /** Reads sizes and modification times once per distinct file. */
  async collectMetadata(files) {
    const metadata = /* @__PURE__ */ new Map();
    const statFile = this.options.statFile ?? (async (path3) => {
      const stats = await fs.stat(path3).catch(() => void 0);
      return stats ? { sizeBytes: stats.size, modifiedMs: stats.mtimeMs } : void 0;
    });
    const queue = [...files];
    const workers = Array.from({ length: Math.min(16, queue.length) }, async () => {
      for (; ; ) {
        const file = queue.pop();
        if (!file) {
          return;
        }
        const stats = await statFile(file.path);
        if (stats) {
          metadata.set(file.path, stats);
        }
      }
    });
    await Promise.all(workers);
    return metadata;
  }
};

// src/commands.ts
var vscode2 = __toESM(require("vscode"));

// src/fileRef.ts
var vscode = __toESM(require("vscode"));
function toFileRef(fsPath) {
  const normalized = vscode.Uri.file(fsPath).fsPath;
  const name = normalized.replace(/\\/g, "/").split("/").pop() ?? normalized;
  const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(normalized));
  if (!folder) {
    return { path: normalized, name, external: true };
  }
  return {
    path: normalized,
    name,
    relativePath: vscode.workspace.asRelativePath(vscode.Uri.file(normalized), false),
    folderName: folder.name,
    external: false
  };
}

// src/commands.ts
var NEW_GROUP_SENTINEL = "__pdfhub_new_group__";
function resolveTargetFiles(uri) {
  if (uri && uri.scheme === "file") {
    return [toFileRef(uri.fsPath)];
  }
  const editor = vscode2.window.activeTextEditor;
  if (editor && editor.document.uri.scheme === "file") {
    const selection = editor.selection;
    if (!selection.isEmpty) {
      return [toFileRef(editor.document.uri.fsPath)];
    }
    return [toFileRef(editor.document.uri.fsPath)];
  }
  const active = vscode2.window.tabGroups.activeTabGroup.activeTab;
  const input = active?.input;
  if (input?.uri && input.uri.scheme === "file") {
    return [toFileRef(input.uri.fsPath)];
  }
  return [];
}
async function addToFavorites(store, uris) {
  const targets = [];
  for (const uri of uris ?? []) {
    if (uri.scheme === "file") {
      targets.push(toFileRef(uri.fsPath));
    }
  }
  if (!targets.length) {
    targets.push(...resolveTargetFiles(void 0));
  }
  if (!targets.length) {
    void vscode2.window.showWarningMessage("PDF Hub: no file selected.");
    return;
  }
  const inProject = targets.filter((f) => !f.external);
  const external = targets.filter((f) => f.external);
  if (inProject.length) {
    const groupId = await pickGroup(store, inProject.length > 1 ? `Add ${inProject.length} files to favorites` : "Add to favorites");
    if (groupId !== void 0) {
      for (const file of inProject) {
        store.addFavorite(file, groupId === NEW_GROUP_SENTINEL ? void 0 : groupId);
      }
      showAddedConfirmation(inProject.length, store.getGroup(groupId)?.name);
    }
  }
  if (external.length) {
    await addExternalFiles(store, external);
  }
}
async function pickGroup(store, title) {
  const groups = store.getGroups().map((group) => ({
    label: group.name,
    description: `${group.files.length} file(s)`,
    id: group.id
  }));
  if (!groups.length) {
    const name2 = await vscode2.window.showInputBox({
      title: "New favorites group",
      prompt: 'Name the group, for example "Python" or "Java"',
      value: vscode2.workspace.getConfiguration("pdfHub").get("favorites.defaultGroupName", "Favorites"),
      validateInput: (value) => value.trim().length ? void 0 : "A group name is required"
    });
    if (name2 === void 0) {
      return void 0;
    }
    return store.createGroup(name2).id;
  }
  const picked = await vscode2.window.showQuickPick(
    [
      ...groups,
      { label: "$(add) New group...", description: "Create another named group", id: NEW_GROUP_SENTINEL }
    ],
    { title, placeHolder: "Pick a group" }
  );
  if (!picked) {
    return void 0;
  }
  if (picked.id !== NEW_GROUP_SENTINEL) {
    return picked.id;
  }
  const name = await vscode2.window.showInputBox({
    title: "New favorites group",
    prompt: 'Name the group, for example "Python" or "Java"',
    validateInput: (value) => value.trim().length ? void 0 : "A group name is required"
  });
  if (name === void 0) {
    return void 0;
  }
  return store.createGroup(name).id;
}
function showAddedConfirmation(count, groupName) {
  const where = groupName ? ` to "${groupName}"` : "";
  void vscode2.window.setStatusBarMessage(`PDF Hub: added ${count} file(s)${where}`, 4e3);
}
async function addExternalFiles(store, files) {
  let added = 0;
  const skipped = [];
  for (const file of files) {
    const result = store.addExternal({ ...file, external: true });
    if (result === "added") {
      added += 1;
    } else {
      skipped.push(`${file.name} (${result === "full" ? "list is full" : "already added"})`);
    }
  }
  if (added) {
    void vscode2.window.setStatusBarMessage(`PDF Hub: added ${added} external favorite(s)`, 4e3);
  }
  if (skipped.length) {
    const max = store.externalMax;
    const choice = await vscode2.window.showWarningMessage(
      `PDF Hub: ${skipped.join(", ")}. The external list holds at most ${max} files.`,
      "Manage external files"
    );
    if (choice) {
      await vscode2.commands.executeCommand("pdfHub.focus");
    }
  }
}
async function pickExternalFiles(store) {
  const remaining = store.externalMax - store.getExternal().length;
  if (remaining <= 0) {
    void vscode2.window.showWarningMessage(
      `PDF Hub: the external favorites list is full (${store.externalMax}/${store.externalMax}). Remove one first.`
    );
    return;
  }
  const picked = await vscode2.window.showOpenDialog({
    canSelectMany: true,
    canSelectFiles: true,
    canSelectFolders: false,
    openLabel: `Add (max ${remaining} more)`,
    title: `Add files outside the project \u2014 ${remaining} slot(s) left`
  });
  if (!picked?.length) {
    return;
  }
  const inside = picked.filter((uri) => vscode2.workspace.getWorkspaceFolder(uri));
  const outside = picked.filter((uri) => !vscode2.workspace.getWorkspaceFolder(uri));
  if (inside.length) {
    void vscode2.window.showWarningMessage(
      `PDF Hub: ${inside.length} selected file(s) are inside the project. Use "Add to Favorites" for those.`
    );
  }
  await addExternalFiles(
    store,
    outside.map((uri) => toFileRef(uri.fsPath))
  );
}
async function createGroup(store) {
  const name = await vscode2.window.showInputBox({
    title: "New favorites group",
    prompt: 'Name the group, for example "Python" or "Java"',
    validateInput: (value) => value.trim().length ? void 0 : "A group name is required"
  });
  if (name !== void 0) {
    store.createGroup(name);
  }
}
async function renameGroup(store, groupId) {
  const group = groupId ? store.getGroup(groupId) : await pickGroupOnly(store);
  if (!group) {
    return;
  }
  const name = await vscode2.window.showInputBox({
    title: `Rename "${group.name}"`,
    value: group.name,
    validateInput: (value) => value.trim().length ? void 0 : "A group name is required"
  });
  if (name !== void 0) {
    store.renameGroup(group.id, name);
  }
}
async function deleteGroup(store, groupId) {
  const group = groupId ? store.getGroup(groupId) : await pickGroupOnly(store);
  if (!group) {
    return;
  }
  const confirmed = await vscode2.window.showWarningMessage(
    `Delete the group "${group.name}" and its ${group.files.length} favorite(s)?`,
    { modal: true },
    "Delete"
  );
  if (confirmed === "Delete") {
    store.deleteGroup(group.id);
  }
}
async function pickGroupOnly(store) {
  const groups = store.getGroups();
  if (!groups.length) {
    void vscode2.window.showInformationMessage("PDF Hub: there are no favorites groups yet.");
    return void 0;
  }
  const picked = await vscode2.window.showQuickPick(
    groups.map((group) => ({ label: group.name, description: `${group.files.length} file(s)`, id: group.id })),
    { title: "Pick a favorites group" }
  );
  return picked ? store.getGroup(picked.id) : void 0;
}
async function removeFromFavorites(store, uri) {
  const targets = uri ? [toFileRef(uri.fsPath)] : resolveTargetFiles(void 0);
  let removed = 0;
  for (const file of targets) {
    if (store.removeFavorite(file.path)) {
      removed += 1;
    }
    if (store.removeExternal(file.path)) {
      removed += 1;
    }
  }
  if (removed === 0) {
    void vscode2.window.showInformationMessage("PDF Hub: that file is not a favorite.");
  }
}
function registerCommands(context, store, service, focus) {
  const register = (id, handler) => {
    context.subscriptions.push(vscode2.commands.registerCommand(id, handler));
  };
  register("pdfHub.focus", () => focus());
  register("pdfHub.addToFavorites", (uri) => addToFavorites(store, uri ? [uri] : void 0));
  register("pdfHub.addSelectionToFavorites", (uri) => addToFavorites(store, uri ? [uri] : void 0));
  register("pdfHub.removeFromFavorites", (uri) => removeFromFavorites(store, uri));
  register("pdfHub.createGroup", () => createGroup(store));
  register("pdfHub.renameGroup", (groupId) => renameGroup(store, groupId));
  register("pdfHub.deleteGroup", (groupId) => deleteGroup(store, groupId));
  register("pdfHub.addExternalFile", () => pickExternalFiles(store));
  register("pdfHub.clearRecents", () => {
    store.clearRecents();
    void vscode2.window.setStatusBarMessage("PDF Hub: recent files cleared", 3e3);
  });
  register("pdfHub.reindex", async () => {
    await service.resetIndex();
    await vscode2.window.withProgress(
      { location: vscode2.ProgressLocation.Notification, title: "PDF Hub: rebuilding PDF index" },
      async () => {
        await service.ensureIndex();
      }
    );
    void vscode2.window.showInformationMessage("PDF Hub: PDF index rebuilt.");
  });
}
var SMART_PRESETS = [
  {
    label: "$(file-pdf) All PDFs",
    detail: "**/*.pdf",
    name: "All PDFs",
    conditions: { extensions: ["pdf"] }
  },
  {
    label: "$(file-media) Recent PDFs",
    detail: "changed in the last 30 days",
    name: "Recent PDFs",
    conditions: { extensions: ["pdf"], modifiedWithinDays: 30 }
  },
  {
    label: "$(markdown) Markdown notes",
    detail: "**/*.md",
    name: "Markdown notes",
    conditions: { extensions: ["md"] }
  },
  {
    label: "$(calendar) Changed this week",
    detail: "any file modified in the last 7 days",
    name: "Changed this week",
    conditions: { modifiedWithinDays: 7 }
  },
  {
    label: "$(edit) Custom pattern...",
    detail: "Enter your own glob, extension or date rule",
    name: "",
    conditions: {}
  }
];
async function createSmartGroup(store) {
  const preset = await vscode2.window.showQuickPick(
    SMART_PRESETS.map((entry) => ({ label: entry.label, detail: entry.detail, preset: entry })),
    { title: "New smart group", placeHolder: "What should it collect?" }
  );
  if (!preset) {
    return void 0;
  }
  let name = preset.preset.name;
  let conditions = { ...preset.preset.conditions };
  if (!name) {
    const pattern = await vscode2.window.showInputBox({
      title: "New smart group",
      prompt: "Glob pattern, for example *.pdf, docs/** or invoice-*",
      placeHolder: "**/*.pdf",
      validateInput: (value) => value.trim() ? void 0 : "A pattern is required"
    });
    if (pattern === void 0) {
      return void 0;
    }
    conditions = { includeGlobs: [pattern.trim()] };
    name = pattern.trim();
  }
  const finalName = await vscode2.window.showInputBox({
    title: "Name this smart group",
    value: name,
    prompt: "Shown as a section in the sidebar",
    validateInput: (value) => value.trim() ? void 0 : "A name is required"
  });
  if (finalName === void 0) {
    return void 0;
  }
  const rule = store.createSmartGroup(finalName, conditions);
  const problems = validateRule(rule);
  if (problems.length) {
    void vscode2.window.showWarningMessage(`PDF Hub: ${problems[0]}`);
    return rule;
  }
  void vscode2.window.setStatusBarMessage(`PDF Hub: smart group "${rule.name}" added`, 4e3);
  return rule;
}
async function editSmartGroup(store, groupId) {
  const rules = store.getSmartGroups();
  if (!rules.length) {
    void vscode2.window.showInformationMessage("PDF Hub: there are no smart groups yet.");
    return;
  }
  const rule = groupId ? store.getSmartGroup(groupId) : void 0;
  const chosen = rule ?? await vscode2.window.showQuickPick(
    rules.map((entry) => ({ label: entry.name, description: describeRule(entry), id: entry.id })),
    { title: "Edit smart group" }
  ).then((picked) => picked ? store.getSmartGroup(picked.id) : void 0);
  if (!chosen) {
    return;
  }
  const action = await vscode2.window.showQuickPick(
    [
      { label: "$(edit) Change pattern", id: "pattern" },
      { label: "$(check) Require all conditions", id: "mode-all" },
      { label: "$(list-ordered) Match any condition", id: "mode-any" },
      chosen.enabled ? { label: "$(circle-slash) Disable", id: "disable" } : { label: "$(play) Enable", id: "enable" },
      { label: "$(trash) Delete", id: "delete" }
    ],
    { title: chosen.name }
  );
  if (!action) {
    return;
  }
  switch (action.id) {
    case "pattern": {
      const value = await vscode2.window.showInputBox({
        title: `Pattern for "${chosen.name}"`,
        value: (chosen.conditions.includeGlobs ?? []).join(", "),
        prompt: "Comma-separated globs, for example *.pdf, docs/**"
      });
      if (value === void 0) {
        return;
      }
      const globs = value.split(",").map((entry) => entry.trim()).filter(Boolean);
      store.updateSmartGroup(chosen.id, { conditions: { ...chosen.conditions, includeGlobs: globs } });
      break;
    }
    case "mode-all":
      store.updateSmartGroup(chosen.id, { matchMode: "all" });
      break;
    case "mode-any":
      store.updateSmartGroup(chosen.id, { matchMode: "any" });
      break;
    case "disable":
      store.updateSmartGroup(chosen.id, { enabled: false });
      break;
    case "enable":
      store.updateSmartGroup(chosen.id, { enabled: true });
      break;
    case "delete":
      await deleteSmartGroup(store, chosen.id);
      return;
    default:
      return;
  }
  void vscode2.window.setStatusBarMessage(`PDF Hub: updated "${chosen.name}"`, 3e3);
}
async function deleteSmartGroup(store, groupId) {
  const rule = groupId ? store.getSmartGroup(groupId) : void 0;
  if (!rule) {
    return;
  }
  const confirmed = await vscode2.window.showWarningMessage(
    `Delete the smart group "${rule.name}"?`,
    { modal: true },
    "Delete"
  );
  if (confirmed === "Delete") {
    store.removeSmartGroup(rule.id);
  }
}
function registerSmartGroupCommands(context, store, hooks) {
  const register = (id, handler) => {
    context.subscriptions.push(
      vscode2.commands.registerCommand(id, handler)
    );
  };
  register("pdfHub.createSmartGroup", async () => {
    await createSmartGroup(store);
    await hooks.refresh();
  });
  register("pdfHub.editSmartGroup", async (groupId) => {
    await editSmartGroup(store, groupId);
    await hooks.refresh();
  });
  register("pdfHub.deleteSmartGroup", async (groupId) => {
    await deleteSmartGroup(store, groupId);
    await hooks.refresh();
  });
  register("pdfHub.refreshSmartGroups", async () => {
    await hooks.refresh();
  });
  register("pdfHub.toggleSmartGroup", async (groupId) => {
    const rule = store.getSmartGroup(groupId);
    if (rule) {
      store.updateSmartGroup(groupId, { enabled: !rule.enabled });
      await hooks.refresh();
    }
  });
}

// src/search/indexStore.ts
var INDEX_FORMAT_VERSION = 2;
var DEFAULT_LIMITS = {
  maxBytes: 24 * 1024 * 1024,
  maxEntries: 4e3
};
function indexKey(path3) {
  return path3.replace(/\\/g, "/");
}
function emptySnapshot(now = Date.now()) {
  return {
    version: INDEX_FORMAT_VERSION,
    savedAt: now,
    entries: [],
    stats: { bytes: 0, extractions: 0, cacheHits: 0 }
  };
}
function isEntryValid(entry, stats) {
  return Boolean(entry && entry.mtimeMs === stats.mtimeMs && entry.size === stats.size);
}
function parseSnapshot(raw, now = Date.now()) {
  if (!raw) {
    return emptySnapshot(now);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptySnapshot(now);
  }
  if (!parsed || typeof parsed !== "object") {
    return emptySnapshot(now);
  }
  const candidate = parsed;
  if (candidate.version !== INDEX_FORMAT_VERSION || !Array.isArray(candidate.entries)) {
    return emptySnapshot(now);
  }
  const entries = [];
  for (const entry of candidate.entries) {
    if (entry && typeof entry.path === "string" && typeof entry.mtimeMs === "number" && typeof entry.size === "number" && Array.isArray(entry.text) && entry.text.every((page) => typeof page === "string")) {
      const text = entry.text;
      entries.push({
        path: entry.path,
        mtimeMs: entry.mtimeMs,
        size: entry.size,
        pages: typeof entry.pages === "number" ? entry.pages : text.length,
        text,
        // Older snapshots may predate the lowercase cache; rebuild on load.
        lower: Array.isArray(entry.lower) && entry.lower.length === text.length ? entry.lower : text.map((page) => page.toLowerCase()),
        truncated: Boolean(entry.truncated),
        lastAccess: typeof entry.lastAccess === "number" ? entry.lastAccess : candidate.savedAt ?? now
      });
    }
  }
  return {
    version: INDEX_FORMAT_VERSION,
    savedAt: typeof candidate.savedAt === "number" ? candidate.savedAt : now,
    entries,
    stats: {
      bytes: candidate.stats?.bytes ?? 0,
      extractions: candidate.stats?.extractions ?? 0,
      cacheHits: candidate.stats?.cacheHits ?? 0
    }
  };
}
function serializeSnapshot(snapshot, limits = DEFAULT_LIMITS) {
  const byRecency = [...snapshot.entries].sort((a, b) => b.lastAccess - a.lastAccess);
  const kept = [];
  let dropped = 0;
  const perEntryOverhead = 220;
  let bytes = 0;
  for (const entry of byRecency) {
    const entryBytes = perEntryOverhead + entry.text.reduce((total, page) => total + page.length * 2, 0);
    const wouldExceed = kept.length >= limits.maxEntries || bytes + entryBytes > limits.maxBytes;
    if (wouldExceed) {
      dropped += 1;
      continue;
    }
    bytes += entryBytes;
    kept.push(entry);
  }
  kept.sort((a, b) => indexKey(a.path).localeCompare(indexKey(b.path)));
  const json = JSON.stringify({
    version: INDEX_FORMAT_VERSION,
    savedAt: snapshot.savedAt,
    stats: snapshot.stats,
    entries: kept
  });
  return { json, dropped };
}
var PdfIndexStore = class {
  entries = /* @__PURE__ */ new Map();
  stats = { bytes: 0, extractions: 0, cacheHits: 0 };
  dirty = false;
  storage;
  limits;
  now;
  constructor(storage, limits = DEFAULT_LIMITS, now = Date.now) {
    this.storage = storage;
    this.limits = limits;
    this.now = now;
  }
  get size() {
    return this.entries.size;
  }
  get isDirty() {
    return this.dirty;
  }
  getStats() {
    return { ...this.stats };
  }
  /** Loads the persisted index, rebuilding the lowercase cache if needed. */
  async load() {
    const raw = await this.storage.read();
    const snapshot = parseSnapshot(raw, this.now());
    this.entries = new Map(snapshot.entries.map((entry) => [indexKey(entry.path), entry]));
    this.stats = snapshot.stats;
    this.dirty = false;
    return { entries: this.entries.size, dropped: Boolean(raw) && snapshot.entries.length === 0 };
  }
  get(path3) {
    const entry = this.entries.get(indexKey(path3));
    if (entry) {
      entry.lastAccess = this.now();
      this.dirty = true;
    }
    return entry;
  }
  /** Looks up without touching the LRU timestamp. */
  peek(path3) {
    return this.entries.get(indexKey(path3));
  }
  /** Records a cache hit (a file that did not need re-extraction). */
  noteCacheHit(bytes) {
    this.stats.cacheHits += 1;
    this.stats.bytes += bytes;
    this.dirty = true;
  }
  set(entry) {
    const key = indexKey(entry.path);
    this.entries.set(key, { ...entry, path: key, lastAccess: this.now() });
    this.stats.extractions += 1;
    this.dirty = true;
  }
  delete(path3) {
    const removed = this.entries.delete(indexKey(path3));
    if (removed) {
      this.dirty = true;
    }
    return removed;
  }
  clear() {
    this.entries.clear();
    this.stats = { bytes: 0, extractions: 0, cacheHits: 0 };
    this.dirty = true;
  }
  /** Drops entries for paths that are no longer part of the workspace. */
  retainOnly(paths) {
    const keep = new Set([...paths].map(indexKey));
    let removed = 0;
    for (const key of [...this.entries.keys()]) {
      if (!keep.has(key)) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    if (removed) {
      this.dirty = true;
    }
    return removed;
  }
  snapshot() {
    return {
      version: INDEX_FORMAT_VERSION,
      savedAt: this.now(),
      entries: [...this.entries.values()],
      stats: this.getStats()
    };
  }
  /** Persists the index if it changed. Returns what happened, for logging/tests. */
  async save(force = false) {
    if (!this.dirty && !force) {
      return { saved: false, dropped: 0, bytes: 0 };
    }
    const { json, dropped } = serializeSnapshot(this.snapshot(), this.limits);
    await this.storage.write(json);
    this.dirty = false;
    return { saved: true, dropped, bytes: json.length };
  }
  async drop() {
    this.entries.clear();
    this.stats = { bytes: 0, extractions: 0, cacheHits: 0 };
    this.dirty = false;
    await this.storage.drop();
  }
  dispose() {
    this.entries.clear();
  }
};

// src/search/pdfSearch.ts
var vscode3 = __toESM(require("vscode"));

// src/search/recents.ts
function rankOpenStats(stats, options) {
  const now = options.now ?? Date.now();
  const rows = stats.filter((row) => options.projectOnly ? row.inProject : true);
  const scored = rows.map((row) => {
    const ageHours = Math.max(0, (now - row.lastOpened) / 36e5);
    const recency = 1 / (1 + ageHours / 48);
    const score = options.strategy === "frequency" ? row.count : options.strategy === "recent" ? row.lastOpened : row.count * 1.5 + recency * 10;
    return { row, score };
  });
  scored.sort((a, b) => b.score - a.score || a.row.name.localeCompare(b.row.name));
  return scored.slice(0, Math.max(1, options.limit)).map((entry) => ({ ...entry.row }));
}
function pruneMissing(value, exists) {
  const before = value.recents.length + value.external.length + value.groups.reduce((total, group) => total + group.files.length, 0);
  const recents = value.recents.filter((row) => exists(row.path));
  const external = value.external.filter((file) => exists(file.path));
  const groups = value.groups.map((group) => ({
    ...group,
    files: group.files.filter((file) => exists(file.path))
  }));
  const after = recents.length + external.length + groups.reduce((total, group) => total + group.files.length, 0);
  return {
    value: { ...value, recents, external, groups },
    removed: before - after
  };
}
function recordOpenStat(stats, entry, options = {}) {
  const now = options.now ?? Date.now();
  const cap = Math.max(1, options.cap ?? 200);
  const key = entry.path.replace(/\\/g, "/").toLowerCase();
  const existing = stats.find((row) => row.path.replace(/\\/g, "/").toLowerCase() === key);
  const next = existing ? stats.map(
    (row) => row === existing ? {
      ...row,
      count: row.count + 1,
      lastOpened: now,
      name: entry.name,
      inProject: entry.inProject,
      relativePath: entry.relativePath
    } : row
  ) : [
    ...stats,
    {
      path: entry.path,
      name: entry.name,
      count: 1,
      lastOpened: now,
      inProject: entry.inProject,
      relativePath: entry.relativePath
    }
  ];
  next.sort((a, b) => b.lastOpened - a.lastOpened);
  return next.slice(0, cap);
}
function planReindex(policy, reason, now, pendingSince) {
  if (reason === "explicit") {
    return { runNow: true, delayMs: 0 };
  }
  if (reason === "change") {
    const waited = pendingSince > 0 ? now - pendingSince : 0;
    if (pendingSince > 0 && waited >= policy.maxDelayMs) {
      return { runNow: true, delayMs: 0 };
    }
    const remaining = Math.max(0, policy.debounceMs - waited);
    return remaining === 0 ? { runNow: true, delayMs: 0 } : { runNow: false, delayMs: remaining };
  }
  if (reason === "viewOpen") {
    return policy.trigger === "onDemand" ? { runNow: false, delayMs: 0 } : { runNow: true, delayMs: 0 };
  }
  return policy.trigger === "onStartup" ? { runNow: true, delayMs: 0 } : { runNow: false, delayMs: 0 };
}
function describeScan(unchanged, changed, bytes) {
  const mb = bytes / (1024 * 1024);
  const size = mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
  if (changed === 0) {
    return `Nothing to index \u2014 ${unchanged} PDF(s) already cached`;
  }
  return `${changed} PDF(s) need indexing (${size})${unchanged ? `, ${unchanged} unchanged` : ""}`;
}

// src/indexService.ts
var IDLE = {
  phase: "idle",
  processed: 0,
  total: 0,
  cached: 0,
  extracted: 0,
  fromCache: 0,
  skipped: 0,
  failed: 0,
  bytes: 0,
  elapsedMs: 0
};
var IndexService = class {
  store;
  environment;
  config;
  onProgressCallback;
  now;
  current = { ...IDLE };
  running;
  cancelRequested = false;
  loaded = false;
  lastSaveAt = 0;
  constructor(options) {
    this.store = options.store;
    this.environment = options.environment;
    this.config = options.config;
    this.onProgressCallback = options.onProgress ?? (() => void 0);
    this.now = options.now ?? (() => Date.now());
  }
  get progress() {
    return { ...this.current };
  }
  get isRunning() {
    return Boolean(this.running);
  }
  /** Loads the persisted index once. Cheap: one file read. */
  async load() {
    if (this.loaded) {
      return { entries: this.store.size };
    }
    const result = await this.store.load();
    this.loaded = true;
    return { entries: result.entries };
  }
  /** Requests cancellation of the pass currently running. */
  cancel() {
    if (this.running) {
      this.cancelRequested = true;
    }
  }
  /**
   * Indexes what needs indexing. Concurrent calls share one pass, so a burst of
   * triggers (view open, typing, file change) cannot start overlapping work.
   */
  async ensureIndexed(options = {}) {
    if (this.running) {
      return this.running;
    }
    this.running = this.run(options).finally(() => {
      this.running = void 0;
      this.cancelRequested = false;
    });
    return this.running;
  }
  /**
   * Decides what a pass would cost without extracting anything.
   * Used to show "12 unchanged, 2 changed" before starting.
   */
  async planPass() {
    await this.load();
    const config2 = this.config();
    const files = await this.environment.listFiles();
    let changed = 0;
    let unchanged = 0;
    let bytes = 0;
    let oversized = 0;
    for (const file of files) {
      const stats = await this.environment.stat(file.path);
      if (!stats) {
        continue;
      }
      if (stats.size > config2.maxFileSizeBytes) {
        oversized += 1;
        continue;
      }
      if (isEntryValid(this.store.peek(file.path), stats)) {
        unchanged += 1;
      } else {
        changed += 1;
        bytes += stats.size;
      }
    }
    return {
      total: files.length,
      changed,
      unchanged,
      bytes,
      oversized,
      description: describeScan(unchanged, changed, bytes)
    };
  }
  emit(progress) {
    this.current = progress;
    this.onProgressCallback({ ...progress });
  }
  async run(options) {
    const started = this.now();
    const silent = options.silent ?? false;
    const config2 = this.config();
    this.cancelRequested = false;
    const base = {
      ...IDLE,
      phase: "scanning",
      elapsedMs: 0
    };
    if (!silent) {
      this.emit(base);
    }
    await this.load();
    const files = await this.environment.listFiles().catch(() => []);
    const queue = [];
    let cached = 0;
    let skipped = 0;
    for (const file of files) {
      if (this.cancelRequested) {
        break;
      }
      const stats = await this.environment.stat(file.path);
      if (!stats) {
        skipped += 1;
        continue;
      }
      if (stats.size > config2.maxFileSizeBytes) {
        skipped += 1;
        continue;
      }
      if (isEntryValid(this.store.peek(file.path), stats)) {
        cached += 1;
        this.store.noteCacheHit(stats.size);
        continue;
      }
      queue.push({ file, stats });
    }
    const total = files.length;
    let progress = {
      ...base,
      phase: queue.length ? "indexing" : "ready",
      processed: cached + skipped,
      total,
      cached,
      fromCache: cached,
      skipped,
      extracted: 0,
      failed: 0,
      bytes: queue.reduce((sum, item) => sum + item.stats.size, 0),
      elapsedMs: this.now() - started
    };
    if (!silent) {
      this.emit(progress);
    }
    if (this.cancelRequested) {
      const finished2 = {
        ...progress,
        phase: "cancelled",
        summary: `Cancelled after ${cached} cached, ${queue.length} pending`,
        elapsedMs: this.now() - started
      };
      if (!silent) {
        this.emit(finished2);
      }
      return finished2;
    }
    if (!queue.length) {
      const finished2 = {
        ...progress,
        phase: "ready",
        summary: describeScan(cached, 0, 0),
        elapsedMs: this.now() - started
      };
      if (!silent) {
        this.emit(finished2);
      }
      options.onComplete?.(finished2);
      return finished2;
    }
    let cursor = 0;
    let extracted = 0;
    let failed = 0;
    const concurrency = Math.max(1, Math.min(4, config2.concurrency));
    const worker = async () => {
      while (cursor < queue.length && !this.cancelRequested) {
        const item = queue[cursor];
        cursor += 1;
        progress = { ...progress, currentFile: item.file.name };
        if (!silent) {
          this.emit(progress);
        }
        try {
          const bytes = await this.environment.read(item.file.path);
          const result = await this.environment.extract(bytes);
          const maxChars = config2.maxTextCharsPerFile;
          let used = 0;
          let truncated = result.truncated;
          const kept = [];
          for (const page of result.pages) {
            if (used >= maxChars) {
              truncated = true;
              break;
            }
            const slice = page.length > maxChars - used ? page.slice(0, maxChars - used) : page;
            used += slice.length;
            kept.push(slice);
          }
          this.store.set({
            path: item.file.path,
            mtimeMs: item.stats.mtimeMs,
            size: item.stats.size,
            pages: result.totalPages,
            text: kept,
            lower: kept.map((page) => page.toLowerCase()),
            truncated
          });
          extracted += 1;
          await this.maybeSave();
        } catch {
          failed += 1;
        }
        progress = {
          ...progress,
          processed: cached + skipped + extracted + failed,
          extracted,
          failed,
          elapsedMs: this.now() - started
        };
        if (!silent) {
          this.emit(progress);
        }
      }
    };
    try {
      await Promise.all(
        Array.from({ length: Math.min(concurrency, queue.length) }, () => worker())
      );
    } catch (error) {
      const failedRun = {
        ...progress,
        phase: "error",
        error: String(error),
        elapsedMs: this.now() - started
      };
      this.emit(failedRun);
      return failedRun;
    }
    await this.save(true);
    const finished = this.cancelRequested ? {
      ...progress,
      phase: "cancelled",
      summary: `Cancelled after ${extracted} file(s)`,
      elapsedMs: this.now() - started
    } : {
      ...progress,
      phase: "ready",
      currentFile: void 0,
      summary: extracted === 0 ? describeScan(cached, 0, 0) : `Indexed ${extracted} file(s)${cached ? `, ${cached} already cached` : ""}${failed ? `, ${failed} failed` : ""} in ${Math.max(1, Math.round((this.now() - started) / 100) / 10)}s`,
      elapsedMs: this.now() - started
    };
    if (!silent) {
      this.emit(finished);
    }
    if (finished.phase === "ready") {
      options.onComplete?.(finished);
    }
    return finished;
  }
  /** Persists at most every few seconds during a long pass. */
  async maybeSave() {
    const now = this.now();
    if (now - this.lastSaveAt < 5e3) {
      return;
    }
    this.lastSaveAt = now;
    await this.save(false);
  }
  /** Reads one indexed entry without touching its LRU timestamp. */
  peekEntry(path3) {
    return this.store.peek(path3);
  }
  /** Drops one file from the index (used when a PDF changes or disappears). */
  invalidate(path3) {
    if (path3) {
      this.store.delete(path3);
    } else {
      this.store.clear();
    }
  }
  /** Removes cached entries for PDFs that are no longer in the workspace. */
  async pruneToKnownFiles() {
    const files = await this.environment.listFiles().catch(() => []);
    const removed = this.store.retainOnly(files.map((file) => file.path));
    if (removed > 0) {
      await this.save(true);
    }
    return removed;
  }
  async save(force = false) {
    try {
      await this.store.save(force);
    } catch {
    }
  }
  async reset() {
    this.store.clear();
    await this.store.drop();
    this.emit({ ...IDLE });
  }
  get indexedFiles() {
    return this.store.size;
  }
};

// src/search/textMatch.ts
var EXCERPT_PAD = 60;
var MAX_MATCHES_PER_FILE = 40;
function condense(text) {
  return text.replace(/\s+/g, " ");
}
function matchPages(pages, lowerPages, needle, maxMatches = MAX_MATCHES_PER_FILE) {
  const query = needle.toLowerCase();
  const matches = [];
  let matchCount = 0;
  if (!query) {
    return { matches, matchCount };
  }
  for (let pageIndex = 0; pageIndex < lowerPages.length; pageIndex += 1) {
    const pageLower = lowerPages[pageIndex];
    const pageText = pages[pageIndex] ?? "";
    let from = 0;
    let ordinal = 0;
    for (; ; ) {
      const at = pageLower.indexOf(query, from);
      if (at === -1) {
        break;
      }
      ordinal += 1;
      matchCount += 1;
      if (matches.length < maxMatches) {
        const start = Math.max(0, at - EXCERPT_PAD);
        const end = Math.min(pageText.length, at + query.length + EXCERPT_PAD);
        const raw = pageText.slice(start, end);
        const condensed = condense(raw);
        const before = condense(pageText.slice(start, at));
        const offset = before.length;
        matches.push({
          page: pageIndex + 1,
          ordinal,
          excerpt: `${start > 0 ? "\u2026" : ""}${condensed}${end < pageText.length ? "\u2026" : ""}`,
          offset: Math.min(offset + (start > 0 ? 1 : 0), condensed.length),
          length: query.length
        });
      }
      from = at + query.length;
    }
  }
  return { matches, matchCount };
}
function rankNameMatches(files, query) {
  const needle = query.toLowerCase();
  if (!needle) {
    return [];
  }
  const scored = [];
  for (const file of files) {
    const name = file.name.toLowerCase();
    const rel = (file.relativePath ?? "").toLowerCase();
    const inName = name.indexOf(needle);
    const inPath = rel.indexOf(needle);
    if (inName !== -1) {
      scored.push({ file, score: 1e3 - inName * 5 });
    } else if (inPath !== -1) {
      scored.push({ file, score: 500 - inPath * 2 });
    }
  }
  scored.sort((a, b) => b.score - a.score || a.file.name.localeCompare(b.file.name));
  return scored.map((row) => row.file);
}

// src/search/workspaceFiles.ts
var fs2 = __toESM(require("node:fs/promises"));
var path = __toESM(require("node:path"));
var DEFAULT_SKIP = /* @__PURE__ */ new Set(["node_modules", ".git", "dist", "build", "out", ".next", ".venv"]);
async function findPdfFilesInDirectory(root, options = {}) {
  const skip = options.skipDirectories ?? DEFAULT_SKIP;
  const limit = options.limit ?? 5e3;
  const maxDepth = options.maxDepth ?? 24;
  const found = [];
  const visit = async (directory, depth) => {
    if (depth > maxDepth || found.length >= limit) {
      return;
    }
    let entries;
    try {
      entries = await fs2.readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= limit) {
        return;
      }
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (skip.has(entry.name) || entry.name.startsWith(".")) {
          continue;
        }
        await visit(absolute, depth + 1);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) {
        found.push(absolute);
      }
    }
  };
  await visit(root, 0);
  return found;
}

// src/search/pdfSearch.ts
function config(key, fallback) {
  return vscode3.workspace.getConfiguration("pdfHub").get(key, fallback);
}
function toExcludeGlob(patterns) {
  const cleaned = patterns.map((pattern) => pattern.trim()).filter(Boolean);
  if (!cleaned.length) {
    return void 0;
  }
  return cleaned.length === 1 ? cleaned[0] : `{${cleaned.join(",")}}`;
}
function skipNamesFromGlobs(patterns) {
  const names = /* @__PURE__ */ new Set(["node_modules", ".git", "dist", "build", "out", ".next", ".venv"]);
  for (const pattern of patterns) {
    const match = /\*\*\/([^/*]+)\/\*\*/.exec(pattern.trim());
    if (match) {
      names.add(match[1]);
    }
  }
  return names;
}
var PdfSearchService = class {
  index;
  emitter = new vscode3.EventEmitter();
  onProgress = this.emitter.event;
  lastSummary = {
    phase: "idle",
    processed: 0,
    total: 0,
    cached: 0,
    extracted: 0,
    skipped: 0,
    failed: 0,
    elapsedMs: 0
  };
  fileCache;
  constructor(deps) {
    this.index = new IndexService({
      store: deps.store,
      environment: deps.environment,
      config: deps.config,
      onProgress: (progress) => this.publish(progress)
    });
  }
  publish(progress) {
    this.lastSummary = {
      phase: progress.phase,
      processed: progress.processed,
      total: progress.total,
      currentFile: progress.currentFile,
      cached: progress.cached,
      extracted: progress.extracted,
      skipped: progress.skipped,
      failed: progress.failed,
      elapsedMs: progress.elapsedMs,
      summary: progress.summary
    };
    this.emitter.fire({ ...this.lastSummary });
  }
  get progress() {
    return { ...this.lastSummary };
  }
  get indexedFileCount() {
    return this.index.indexedFiles;
  }
  /** Loads the persisted index. Cheap: one file read, no extraction. */
  async loadIndex() {
    const result = await this.index.load();
    return result.entries;
  }
  /** Indexes whatever changed. Concurrent calls share one pass. */
  async ensureIndex() {
    await this.index.ensureIndexed();
    return this.progress;
  }
  /** Predicts the cost of a pass without extracting anything. */
  async planIndex() {
    return this.index.planPass();
  }
  cancelIndex() {
    this.index.cancel();
  }
  /** Forget one PDF (it changed) or everything. */
  invalidate(fsPath) {
    this.index.invalidate(fsPath);
    this.fileCache = void 0;
  }
  /** Drops index entries for PDFs that are no longer in the workspace. */
  async pruneIndex() {
    const removed = await this.index.pruneToKnownFiles();
    if (removed) {
      this.fileCache = void 0;
    }
    return removed;
  }
  /** Rebuilds the index from scratch. */
  async resetIndex() {
    await this.index.reset();
    this.fileCache = void 0;
  }
  async saveIndex() {
    await this.index.save(true);
  }
  /** Reads one indexed entry, for search and for tests. */
  peekEntry(filePath) {
    return this.index.peekEntry(filePath);
  }
  /**
   * All PDFs in the workspace. Cached briefly so frequent progress pushes and
   * section refreshes do not each trigger a filesystem search.
   */
  async findPdfFiles(force = false) {
    const now = Date.now();
    if (!force && this.fileCache && now - this.fileCache.at < 1e4) {
      return this.fileCache.files;
    }
    const exclude = toExcludeGlob(config("search.excludeGlobs", []));
    const folders = vscode3.workspace.workspaceFolders ?? [];
    const seen = /* @__PURE__ */ new Set();
    const files = [];
    const push = (fsPath) => {
      const key = fsPath.toLowerCase();
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      files.push(toFileRef(fsPath));
    };
    if (folders.length === 0) {
      const found = await vscode3.workspace.findFiles("**/*.pdf", exclude, 5e3);
      found.forEach((uri) => push(uri.fsPath));
    } else {
      for (const folder of folders) {
        const pattern = new vscode3.RelativePattern(folder, "**/*.pdf");
        let found = [];
        try {
          found = await vscode3.workspace.findFiles(pattern, exclude, 5e3);
        } catch (error) {
          console.warn("[pdf-hub] workspace search failed, falling back to a filesystem walk:", error);
        }
        if (!found.length) {
          const walked = await findPdfFilesInDirectory(folder.uri.fsPath, {
            skipDirectories: skipNamesFromGlobs(config("search.excludeGlobs", []))
          });
          walked.forEach(push);
          continue;
        }
        found.forEach((uri) => push(uri.fsPath));
      }
    }
    files.sort((a, b) => (a.relativePath ?? a.name).localeCompare(b.relativePath ?? b.name));
    this.fileCache = { files, at: now };
    return files;
  }
  /** Files the content search should consider, honouring the scope setting. */
  async searchableFiles(external) {
    const project = await this.findPdfFiles();
    const scope = config("search.scope", "project");
    if (scope !== "projectAndExternal") {
      return project;
    }
    const key = (p) => p.replace(/\\/g, "/").toLowerCase();
    const known = new Set(project.map((file) => key(file.path)));
    const extra = external.filter(
      (file) => file.path.toLowerCase().endsWith(".pdf") && !known.has(key(file.path))
    );
    return [...project, ...extra];
  }
  /** Searches indexed PDF text. */
  async searchContent(query, files, token) {
    const needle = query.toLowerCase();
    if (!needle) {
      return [];
    }
    await this.index.load();
    const hits = [];
    for (const file of files) {
      if (token.isCancellationRequested) {
        break;
      }
      const entry = this.index.peekEntry(file.path);
      if (!entry) {
        continue;
      }
      const { matches, matchCount } = matchPages(entry.text, entry.lower, needle);
      if (matchCount > 0) {
        hits.push({
          file,
          matchCount,
          pages: entry.pages,
          matches,
          note: entry.truncated ? "Indexed partially (size limit)" : void 0
        });
      }
    }
    hits.sort((a, b) => b.matchCount - a.matchCount || a.file.name.localeCompare(b.file.name));
    return hits;
  }
  /** File-name search, independent of the text index. */
  searchNames(query, files) {
    return rankNameMatches(files, query);
  }
  isIndexed() {
    return this.index.indexedFiles > 0;
  }
  dispose() {
    this.emitter.dispose();
  }
};

// src/search/pdfText.ts
var path2 = __toESM(require("node:path"));
var import_node_url = require("node:url");
var pdfjsPromise;
var assetBaseDirectory = __dirname;
async function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const moduleUrl = (0, import_node_url.pathToFileURL)(path2.join(assetBaseDirectory, "pdf.mjs")).href;
      const mod = await import(moduleUrl);
      mod.GlobalWorkerOptions.workerSrc = (0, import_node_url.pathToFileURL)(
        path2.join(assetBaseDirectory, "pdf.worker.mjs")
      ).href;
      return mod;
    })();
  }
  return pdfjsPromise;
}
function joinPage(items) {
  let out = "";
  for (const item of items) {
    if (typeof item.str === "string") {
      out += item.str;
    }
    out += item.hasEOL ? "\n" : " ";
  }
  return out.replace(/[ \t]+/g, " ").trim();
}
var pdfTextExtractor = {
  async extract(data) {
    const pdfjs = await loadPdfJs();
    const task = pdfjs.getDocument({
      data,
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      // Required: without it pdf.js cannot bootstrap its in-process worker.
      standardFontDataUrl: `${(0, import_node_url.pathToFileURL)(path2.join(assetBaseDirectory, "standard_fonts")).href}/`,
      // pdf.js only loads standard font metrics over http(s), which a Node
      // extension host never has, so it would warn for every PDF that uses one
      // of the 14 built-in fonts. Errors are still reported at this level.
      verbosity: 0
    });
    const doc = await task.promise;
    const pages = [];
    try {
      for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
        const page = await doc.getPage(pageNumber);
        const content = await page.getTextContent();
        pages.push(joinPage(content.items));
        const cleanup = page.cleanup;
        if (typeof cleanup === "function") {
          cleanup.call(page);
        }
      }
    } finally {
      await doc.destroy().catch(() => void 0);
    }
    return pages;
  }
};

// src/store.ts
var vscode4 = __toESM(require("vscode"));

// src/types.ts
var STATE_VERSION = 2;

// src/storeCore.ts
var DEFAULT_GROUP_ID = "default";
function makeId(now = Date.now()) {
  return `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function normalizeKey(path3) {
  return path3.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}
var StoreCore = class {
  state;
  deps;
  now;
  exists;
  constructor(deps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
    this.exists = deps.exists ?? (() => true);
    const workspace8 = deps.workspaceState.get("pdfHub.state");
    const globalExternal = deps.globalState.get("pdfHub.external");
    const asArray = (value, guard) => Array.isArray(value) ? value.filter(guard) : [];
    this.state = {
      version: STATE_VERSION,
      groups: asArray(workspace8?.groups, isGroupLike),
      external: asArray(workspace8?.external, isFileRefLike),
      recents: asArray(workspace8?.recents, isOpenStatLike),
      smartGroups: asArray(workspace8?.smartGroups, isSmartRuleLike)
    };
    if (!this.state.external.length) {
      this.state.external = asArray(globalExternal, isFileRefLike);
    }
  }
  touch() {
    this.deps.emitter.fire();
    this.deps.schedule?.(() => void this.flush());
  }
  /** Writes both mementos immediately. */
  async flush() {
    this.deps.cancelScheduled?.();
    await this.deps.workspaceState.update("pdfHub.state", this.state);
    await this.deps.globalState.update("pdfHub.external", this.state.external);
  }
  // ---------------------------------------------------------------- favorites
  getGroups() {
    return this.state.groups.map((group) => ({ ...group, files: [...group.files] }));
  }
  getGroup(id) {
    return this.state.groups.find((group) => group.id === id);
  }
  get defaultGroupId() {
    return this.state.groups[0]?.id ?? DEFAULT_GROUP_ID;
  }
  createGroup(name) {
    const trimmed = name.trim() || "Group";
    const existing = this.state.groups.find((group2) => group2.name.toLowerCase() === trimmed.toLowerCase());
    if (existing) {
      return existing;
    }
    const group = { id: makeId(this.now()), name: trimmed, files: [], createdAt: this.now() };
    this.state.groups.push(group);
    this.touch();
    return group;
  }
  renameGroup(id, name) {
    const group = this.state.groups.find((entry) => entry.id === id);
    if (!group) {
      return;
    }
    group.name = name.trim() || group.name;
    this.touch();
  }
  deleteGroup(id) {
    const index = this.state.groups.findIndex((group) => group.id === id);
    if (index === -1) {
      return;
    }
    this.state.groups.splice(index, 1);
    this.touch();
  }
  /** Adds a file to a group, moving it out of any other group first. */
  addFavorite(file, groupId) {
    let group = groupId ? this.state.groups.find((entry) => entry.id === groupId) : void 0;
    if (!group) {
      group = this.state.groups.find((entry) => entry.id === this.defaultGroupId);
    }
    if (!group) {
      const created = {
        id: this.state.groups.length ? makeId(this.now()) : DEFAULT_GROUP_ID,
        name: this.deps.defaultGroupName ?? "Favorites",
        files: [],
        createdAt: this.now()
      };
      this.state.groups.push(created);
      group = created;
    }
    const key = normalizeKey(file.path);
    for (const entry of this.state.groups) {
      entry.files = entry.files.filter((candidate) => normalizeKey(candidate.path) !== key);
    }
    group.files.push(file);
    this.touch();
    return group;
  }
  removeFavorite(path3) {
    const key = normalizeKey(path3);
    let changed = false;
    for (const group of this.state.groups) {
      const before = group.files.length;
      group.files = group.files.filter((file) => normalizeKey(file.path) !== key);
      changed = changed || group.files.length !== before;
    }
    if (changed) {
      this.touch();
    }
    return changed;
  }
  isFavorite(path3) {
    const key = normalizeKey(path3);
    return this.state.groups.some((group) => group.files.some((file) => normalizeKey(file.path) === key));
  }
  findFavoriteGroup(path3) {
    const key = normalizeKey(path3);
    return this.state.groups.find((group) => group.files.some((file) => normalizeKey(file.path) === key));
  }
  // ----------------------------------------------------------------- external
  get externalMax() {
    const raw = this.deps.config("external.maxItems", 10);
    return Math.max(1, Math.min(10, Math.floor(raw)));
  }
  getExternal() {
    return [...this.state.external];
  }
  addExternal(file) {
    const key = normalizeKey(file.path);
    if (this.state.external.some((entry) => normalizeKey(entry.path) === key)) {
      return "duplicate";
    }
    if (this.state.external.length >= this.externalMax) {
      return "full";
    }
    this.state.external.push({ ...file, external: true });
    this.touch();
    return "added";
  }
  removeExternal(path3) {
    const key = normalizeKey(path3);
    const before = this.state.external.length;
    this.state.external = this.state.external.filter((file) => normalizeKey(file.path) !== key);
    if (this.state.external.length !== before) {
      this.touch();
      return true;
    }
    return false;
  }
  // ------------------------------------------------------------------ recents
  recordOpen(fsPath, name, inProject, relativePath) {
    const cap = Math.max(50, this.deps.config("recent.maxItems", 15) * 4);
    this.state.recents = recordOpenStat(
      this.state.recents,
      { path: fsPath, name, inProject, relativePath },
      { now: this.now(), cap }
    );
    this.touch();
  }
  clearRecents() {
    this.state.recents = [];
    this.touch();
  }
  getTopFiles(projectOnly) {
    return rankOpenStats(this.state.recents, {
      strategy: this.deps.config("recent.ranking", "hybrid"),
      limit: this.deps.config("recent.maxItems", 15),
      projectOnly,
      now: this.now()
    });
  }
  /** Drops remembered files that no longer exist on disk. */
  pruneMissing() {
    const result = pruneMissing(this.state, (path3) => this.exists(path3));
    if (result.removed > 0) {
      this.state = { ...this.state, ...result.value, version: STATE_VERSION };
      this.touch();
    }
    return result.removed;
  }
  // -------------------------------------------------------------- smart groups
  /** Returns deep copies so callers cannot mutate stored rules by accident. */
  getSmartGroups() {
    return this.state.smartGroups.map(cloneRule);
  }
  getSmartGroup(id) {
    const rule = this.state.smartGroups.find((entry) => entry.id === id);
    return rule ? cloneRule(rule) : void 0;
  }
  addSmartGroup(rule) {
    this.state.smartGroups.push(rule);
    this.touch();
    return rule;
  }
  /** Creates and stores a rule in one step. */
  createSmartGroup(name, conditions, overrides = {}) {
    return this.addSmartGroup(createRule(name, conditions, overrides));
  }
  updateSmartGroup(id, patch) {
    const rule = this.state.smartGroups.find((entry) => entry.id === id);
    if (!rule) {
      return void 0;
    }
    Object.assign(rule, patch, { id: rule.id });
    if (patch.conditions) {
      rule.conditions = { ...patch.conditions };
    }
    this.touch();
    return rule;
  }
  removeSmartGroup(id) {
    const index = this.state.smartGroups.findIndex((rule) => rule.id === id);
    if (index === -1) {
      return false;
    }
    this.state.smartGroups.splice(index, 1);
    this.touch();
    return true;
  }
  // -------------------------------------------------------------------- misc
  /** Reads the current index policy from configuration. */
  getReindexPolicy() {
    return {
      trigger: this.deps.config("index.trigger", "onViewOpen"),
      debounceMs: this.deps.config("index.debounceMs", 1500),
      maxDelayMs: this.deps.config("index.maxDelayMs", 1e4)
    };
  }
  /** Exposed for tests: asks the pure policy whether a reindex should run. */
  planReindex(reason, now, pendingSince) {
    return planReindex(this.getReindexPolicy(), reason, now, pendingSince);
  }
  snapshot() {
    return JSON.parse(JSON.stringify(this.state));
  }
  dispose() {
    this.deps.cancelScheduled?.();
    this.deps.emitter.dispose();
  }
};
function isFileRefLike(value) {
  const candidate = value;
  return Boolean(candidate && typeof candidate.path === "string" && typeof candidate.name === "string");
}
function isGroupLike(value) {
  const candidate = value;
  return Boolean(
    candidate && typeof candidate.id === "string" && typeof candidate.name === "string" && Array.isArray(candidate.files)
  );
}
function isOpenStatLike(value) {
  const candidate = value;
  return Boolean(
    candidate && typeof candidate.path === "string" && typeof candidate.count === "number" && typeof candidate.lastOpened === "number"
  );
}
function cloneConditions(conditions) {
  return {
    ...conditions,
    includeGlobs: conditions.includeGlobs ? [...conditions.includeGlobs] : void 0,
    excludeGlobs: conditions.excludeGlobs ? [...conditions.excludeGlobs] : void 0,
    extensions: conditions.extensions ? [...conditions.extensions] : void 0
  };
}
function cloneRule(rule) {
  return { ...rule, conditions: cloneConditions(rule.conditions) };
}
function isSmartRuleLike(value) {
  const candidate = value;
  return Boolean(
    candidate && typeof candidate.id === "string" && typeof candidate.name === "string" && candidate.conditions && typeof candidate.conditions === "object"
  );
}

// src/store.ts
var Store = class {
  core;
  emitter = new vscode4.EventEmitter();
  onDidChange = this.emitter.event;
  saveTimer;
  constructor(context) {
    this.core = new StoreCore({
      workspaceState: asKeyValueStore(context.workspaceState),
      globalState: asKeyValueStore(context.globalState),
      config: (key, fallback) => vscode4.workspace.getConfiguration("pdfHub").get(key, fallback),
      emitter: { fire: () => this.emitter.fire(), dispose: () => void 0 },
      defaultGroupName: vscode4.workspace.getConfiguration("pdfHub").get("favorites.defaultGroupName", "Favorites"),
      exists: (path3) => {
        try {
          return require("node:fs").existsSync(path3);
        } catch {
          return false;
        }
      },
      schedule: (callback) => {
        if (this.saveTimer) {
          clearTimeout(this.saveTimer);
        }
        this.saveTimer = setTimeout(callback, 250);
      },
      cancelScheduled: () => {
        if (this.saveTimer) {
          clearTimeout(this.saveTimer);
          this.saveTimer = void 0;
        }
      }
    });
  }
  // The core owns the behaviour; the adapter forwards so call sites stay simple.
  get externalMax() {
    return this.core.externalMax;
  }
  get defaultGroupId() {
    return this.core.defaultGroupId;
  }
  async flush() {
    await this.core.flush();
  }
  getGroups() {
    return this.core.getGroups();
  }
  getGroup(id) {
    return this.core.getGroup(id);
  }
  createGroup(name) {
    return this.core.createGroup(name);
  }
  renameGroup(id, name) {
    this.core.renameGroup(id, name);
  }
  deleteGroup(id) {
    this.core.deleteGroup(id);
  }
  addFavorite(file, groupId) {
    return this.core.addFavorite(file, groupId);
  }
  removeFavorite(path3) {
    return this.core.removeFavorite(path3);
  }
  isFavorite(path3) {
    return this.core.isFavorite(path3);
  }
  findFavoriteGroup(path3) {
    return this.core.findFavoriteGroup(path3);
  }
  getExternal() {
    return this.core.getExternal();
  }
  addExternal(file) {
    return this.core.addExternal(file);
  }
  removeExternal(path3) {
    return this.core.removeExternal(path3);
  }
  recordOpen(fsPath, name, inProject, relativePath) {
    this.core.recordOpen(fsPath, name, inProject, relativePath);
  }
  clearRecents() {
    this.core.clearRecents();
  }
  getTopFiles(projectOnly) {
    return this.core.getTopFiles(projectOnly);
  }
  pruneMissing() {
    return this.core.pruneMissing();
  }
  getSmartGroups() {
    return this.core.getSmartGroups();
  }
  getSmartGroup(id) {
    return this.core.getSmartGroup(id);
  }
  addSmartGroup(rule) {
    return this.core.addSmartGroup(rule);
  }
  createSmartGroup(name, conditions, overrides = {}) {
    return this.core.createSmartGroup(name, conditions, overrides);
  }
  updateSmartGroup(id, patch) {
    return this.core.updateSmartGroup(id, patch);
  }
  removeSmartGroup(id) {
    return this.core.removeSmartGroup(id);
  }
  getReindexPolicy() {
    return this.core.getReindexPolicy();
  }
  planReindex(reason, now, pendingSince) {
    return this.core.planReindex(reason, now, pendingSince);
  }
  dispose() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = void 0;
    }
    this.core.dispose();
    this.emitter.dispose();
  }
};
function asKeyValueStore(memento) {
  return {
    get: (key) => memento.get(key),
    update: (key, value) => Promise.resolve(memento.update(key, value))
  };
}

// src/ui/hubViewProvider.ts
var vscode5 = __toESM(require("vscode"));
var SEARCH_DEBOUNCE_MS = 220;
function asUiFile(file, detail) {
  return {
    path: file.path,
    name: file.name,
    relativePath: file.relativePath,
    external: file.external,
    detail
  };
}
var HubViewProvider = class _HubViewProvider {
  constructor(extensionUri, store, service, registry, openFile, externalPicker, groupActions) {
    this.extensionUri = extensionUri;
    this.store = store;
    this.service = service;
    this.registry = registry;
    this.openFile = openFile;
    this.externalPicker = externalPicker;
    this.groupActions = groupActions;
    this.store.onDidChange(() => void this.push());
    this.registry.onDidChange(() => void this.push());
    this.service.onProgress((progress) => {
      this.indexProgress = progress;
      void this.push();
    });
  }
  static viewType = "pdfHub.main";
  view;
  state;
  searchText = "";
  nameOnly = false;
  searchTimer;
  searchRun = 0;
  indexProgress = {
    phase: "idle",
    processed: 0,
    total: 0,
    cached: 0,
    extracted: 0,
    skipped: 0,
    failed: 0,
    elapsedMs: 0
  };
  viewOpenedEmitter = new vscode5.EventEmitter();
  /** Fires when the sidebar becomes visible, so indexing can be deferrable. */
  onViewOpened = this.viewOpenedEmitter.event;
  viewOpenedOnce = false;
  resolveWebviewView(view) {
    this.view = view;
    if (!this.viewOpenedOnce) {
      this.viewOpenedOnce = true;
      this.viewOpenedEmitter.fire();
    }
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode5.Uri.joinPath(this.extensionUri, "media")]
    };
    view.webview.html = this.renderHtml(view.webview);
    view.webview.onDidReceiveMessage((message) => void this.onMessage(message));
    view.onDidDispose(() => {
      this.view = void 0;
    });
  }
  async focus() {
    await vscode5.commands.executeCommand(`${_HubViewProvider.viewType}.focus`);
  }
  /** Recomputes the whole sidebar payload and sends it to the webview. */
  async push() {
    if (!this.view) {
      return;
    }
    const state = await this.buildState();
    this.state = state;
    void this.view.webview.postMessage({ type: "state", state });
  }
  async buildState() {
    const sections = [];
    for (const provider of this.registry.getSectionProviders()) {
      try {
        const snapshots = await provider.getSections();
        for (const snapshot of snapshots) {
          sections.push({
            id: snapshot.id,
            title: snapshot.title,
            icon: iconFor(provider.id),
            files: snapshot.items?.map((item) => asUiFile(item.file, item.detail)),
            groups: snapshot.groups?.map((group) => ({
              id: group.id,
              title: group.title,
              files: group.items.map((item) => asUiFile(item.file, item.detail)),
              hint: group.hint,
              smart: provider.id === "smart",
              enabled: this.store.getSmartGroup(group.id)?.enabled ?? true
            })),
            hint: snapshot.hint,
            supportsGroups: provider.id === "favorites",
            supportsSmartGroups: provider.id === "smart"
          });
        }
      } catch (error) {
        sections.push({
          id: `${provider.id}-error`,
          title: provider.label,
          icon: "warning",
          files: [],
          hint: `Provider failed: ${String(error)}`
        });
      }
    }
    this.state = {
      sections,
      groups: this.store.getGroups().map((g) => ({ id: g.id, name: g.name, count: g.files.length })),
      externalCount: this.store.getExternal().length,
      externalMax: this.store.externalMax,
      index: {
        phase: this.indexProgress.phase,
        processed: this.indexProgress.processed,
        total: this.indexProgress.total,
        currentFile: this.indexProgress.currentFile,
        cached: this.indexProgress.cached,
        extracted: this.indexProgress.extracted,
        skipped: this.indexProgress.skipped,
        failed: this.indexProgress.failed,
        elapsedMs: this.indexProgress.elapsedMs,
        summary: this.indexProgress.summary
      },
      search: this.state?.search ?? null
    };
    return this.state;
  }
  async onMessage(message) {
    switch (message.type) {
      case "ready":
        await this.push();
        return;
      case "search":
        this.searchText = message.text;
        this.nameOnly = message.nameOnly;
        this.scheduleSearch();
        return;
      case "open": {
        await this.openFile({ path: message.path, name: message.path.split(/[\\/]/).pop() ?? message.path });
        return;
      }
      case "openExternalPicker":
        await this.externalPicker();
        return;
      case "createGroup":
        await this.groupActions.create();
        return;
      case "renameGroup":
        await this.groupActions.rename(message.groupId);
        return;
      case "deleteGroup":
        await this.groupActions.delete(message.groupId);
        return;
      case "removeFavorite":
        this.store.removeFavorite(message.path);
        return;
      case "removeExternal":
        this.store.removeExternal(message.path);
        return;
      case "moveToGroup": {
        const file = this.findFileRef(message.path);
        if (file) {
          this.store.addFavorite(file, message.groupId);
        }
        return;
      }
      case "reindex":
        await vscode5.commands.executeCommand("pdfHub.reindex");
        return;
      case "cancelIndex":
        this.service.cancelIndex();
        return;
      case "createSmartGroup":
        await vscode5.commands.executeCommand("pdfHub.createSmartGroup");
        return;
      case "editSmartGroup":
        await vscode5.commands.executeCommand("pdfHub.editSmartGroup", message.groupId);
        return;
      case "toggleSmartGroup":
        await vscode5.commands.executeCommand("pdfHub.toggleSmartGroup", message.groupId);
        return;
      case "deleteSmartGroup":
        await vscode5.commands.executeCommand("pdfHub.deleteSmartGroup", message.groupId);
        return;
      case "refresh":
        await this.push();
        return;
      default:
        return;
    }
  }
  findFileRef(path3) {
    const key = path3.replace(/\\/g, "/").toLowerCase();
    for (const group of this.store.getGroups()) {
      for (const file of group.files) {
        if (file.path.replace(/\\/g, "/").toLowerCase() === key) {
          return file;
        }
      }
    }
    return { path: path3, name: path3.split(/[\\/]/).pop() ?? path3 };
  }
  scheduleSearch() {
    if (this.searchTimer) {
      clearTimeout(this.searchTimer);
    }
    this.searchTimer = setTimeout(() => void this.runSearch(), SEARCH_DEBOUNCE_MS);
  }
  async runSearch() {
    const text = this.searchText.trim();
    const minChars = Math.max(1, vscode5.workspace.getConfiguration("pdfHub").get("search.minChars", 2));
    const run = ++this.searchRun;
    if (!this.view) {
      return;
    }
    if (text.length < minChars) {
      this.state = {
        ...this.state ?? await this.buildState(),
        search: null
      };
      await this.push();
      return;
    }
    const pending = {
      text,
      nameOnly: this.nameOnly,
      running: true,
      hits: [],
      contentSearched: !this.nameOnly
    };
    this.state = { ...this.state ?? await this.buildState(), search: pending };
    await this.push();
    const tokenSource = new vscode5.CancellationTokenSource();
    const started = Date.now();
    try {
      if (!this.nameOnly) {
        await this.service.ensureIndex();
        if (run !== this.searchRun) {
          tokenSource.cancel();
          return;
        }
      }
      const providers = this.registry.getSearchProviders();
      const results = (await Promise.all(
        providers.map(
          (provider) => provider.search({
            text,
            nameOnly: this.nameOnly,
            token: tokenSource.token
          }).catch((error) => ({ providerId: provider.id, label: provider.label, hits: [], note: String(error) }))
        )
      )).filter(Boolean).flat();
      if (run !== this.searchRun || !this.view) {
        tokenSource.cancel();
        return;
      }
      const hits = dedupeHits(results.flatMap((r) => r.hits));
      const notes = results.map((r) => r.note).filter((n) => Boolean(n));
      const note = notes.length ? notes[0] : `${hits.length} match(es) in ${Date.now() - started} ms`;
      this.state = {
        ...this.state ?? await this.buildState(),
        search: {
          text,
          nameOnly: this.nameOnly,
          running: false,
          hits: hits.slice(0, 300).map((hit) => ({
            path: hit.path,
            name: hit.name,
            location: hit.location,
            excerpt: hit.excerpt,
            matchLength: hit.matchLength,
            source: hit.source ?? "search"
          })),
          note,
          contentSearched: !this.nameOnly
        }
      };
      await this.push();
    } catch (error) {
      if (this.view) {
        void this.view.webview.postMessage({ type: "error", message: String(error) });
      }
    } finally {
      tokenSource.dispose();
    }
  }
  dispose() {
    this.viewOpenedEmitter.dispose();
  }
  renderHtml(webview) {
    const nonce = makeNonce();
    const scriptUri = webview.asWebviewUri(vscode5.Uri.joinPath(this.extensionUri, "media", "webview", "main.js"));
    const styleUri = webview.asWebviewUri(vscode5.Uri.joinPath(this.extensionUri, "media", "webview", "main.css"));
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`
    ].join("; ");
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link href="${styleUri}" rel="stylesheet" />
    <title>PDF Hub</title>
  </head>
  <body>
    <div id="app" data-nonce="${nonce}"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }
};
function makeNonce() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i += 1) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}
function dedupeHits(hits) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const hit of hits) {
    const key = `${hit.path.toLowerCase()}|${hit.location ?? ""}|${hit.source ?? ""}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(hit);
  }
  return out;
}
function iconFor(providerId) {
  switch (providerId) {
    case "recent":
      return "history";
    case "favorites":
      return "star";
    case "external":
      return "link-external";
    default:
      return "list";
  }
}

// src/vscodeIndexEnvironment.ts
var fs3 = __toESM(require("node:fs/promises"));
var vscode6 = __toESM(require("vscode"));
var VscodeIndexEnvironment = class {
  lister;
  /**
   * The file listing comes from `PdfSearchService`, which in turn needs this
   * environment. Supplying it after construction keeps the two free of a
   * circular reference.
   */
  useFileList(lister) {
    this.lister = lister;
  }
  async listFiles() {
    if (!this.lister) {
      throw new Error("VscodeIndexEnvironment.useFileList() was never called");
    }
    return this.lister();
  }
  async stat(path3) {
    const stats = await fs3.stat(path3).catch(() => void 0);
    if (!stats || !stats.isFile()) {
      return void 0;
    }
    return { mtimeMs: stats.mtimeMs, size: stats.size };
  }
  async read(path3) {
    const buffer = await fs3.readFile(path3);
    return new Uint8Array(buffer);
  }
  async extract(data) {
    const pages = await pdfTextExtractor.extract(data);
    return { pages, truncated: false, totalPages: pages.length };
  }
};
function readIndexConfig() {
  const config2 = vscode6.workspace.getConfiguration("pdfHub");
  return {
    maxFileSizeBytes: Math.max(1, config2.get("search.maxFileSizeMb", 40)) * 1024 * 1024,
    maxTextCharsPerFile: Math.max(64, config2.get("search.maxTextKbPerFile", 2048)) * 1024,
    concurrency: 2
  };
}

// src/extension.ts
function indexStorage(context) {
  const uri = vscode7.Uri.joinPath(context.storageUri ?? context.globalStorageUri, "pdf-index.json");
  return {
    async read() {
      try {
        const bytes = await vscode7.workspace.fs.readFile(uri);
        return Buffer.from(bytes).toString("utf8");
      } catch {
        return void 0;
      }
    },
    async write(contents) {
      const folder = vscode7.Uri.joinPath(uri, "..");
      await vscode7.workspace.fs.createDirectory(folder);
      await vscode7.workspace.fs.writeFile(uri, Buffer.from(contents, "utf8"));
    },
    async drop() {
      try {
        await vscode7.workspace.fs.delete(uri);
      } catch {
      }
    }
  };
}
async function activate(context) {
  const store = new Store(context);
  const indexStore = new PdfIndexStore(indexStorage(context));
  const registry = new ProviderRegistry();
  const environment = new VscodeIndexEnvironment();
  const service = new PdfSearchService({
    store: indexStore,
    environment,
    config: readIndexConfig
  });
  environment.useFileList(() => service.findPdfFiles(true));
  const externalFiles = () => store.getExternal();
  registry.registerSearchProvider(new PdfSearchProvider(service, externalFiles));
  registry.registerSectionProvider(new RecentFilesProvider(store, () => serviceFiles));
  registry.registerSectionProvider(new FavoritesProvider(store));
  registry.registerSectionProvider(new SmartGroupsProvider(store, () => serviceFiles));
  registry.registerSectionProvider(new ExternalFilesProvider(store));
  let serviceFiles = [];
  const refreshFileList = async () => {
    serviceFiles = await service.findPdfFiles(true);
  };
  const openFile = async (file) => {
    if (!file.path) {
      return;
    }
    const uri = vscode7.Uri.file(file.path);
    try {
      const doc = await vscode7.workspace.openTextDocument(uri);
      await vscode7.window.showTextDocument(doc, { preview: false });
    } catch {
      const opened = await vscode7.env.openExternal(uri);
      if (!opened) {
        void vscode7.commands.executeCommand("vscode.open", uri);
      }
    }
  };
  const provider = new HubViewProvider(
    context.extensionUri,
    store,
    service,
    registry,
    openFile,
    async () => {
      await vscode7.commands.executeCommand("pdfHub.addExternalFile");
    },
    {
      create: async () => {
        await vscode7.commands.executeCommand("pdfHub.createGroup");
      },
      rename: async (groupId) => {
        await vscode7.commands.executeCommand("pdfHub.renameGroup", groupId);
      },
      delete: async (groupId) => {
        await vscode7.commands.executeCommand("pdfHub.deleteGroup", groupId);
      }
    }
  );
  const pendingChanges = /* @__PURE__ */ new Set();
  let pendingSince = 0;
  let reindexTimer;
  const runIndex = async (reason) => {
    if (service.progress.phase === "indexing") {
      return;
    }
    if (pendingChanges.size) {
      for (const path3 of pendingChanges) {
        service.invalidate(path3);
      }
      pendingChanges.clear();
    }
    if (reason !== "explicit") {
      await refreshFileList();
    }
    const summary = await service.ensureIndex();
    await provider.push();
    await registry.fire("onIndexReady", summary.extracted);
  };
  const scheduleIndex = (reason) => {
    if (reason === "change") {
      pendingSince = pendingSince || Date.now();
    }
    const plan = store.planReindex(reason, Date.now(), pendingSince);
    if (reindexTimer) {
      clearTimeout(reindexTimer);
      reindexTimer = void 0;
    }
    if (plan.runNow) {
      pendingSince = 0;
      void runIndex(reason === "change" ? "change" : reason);
      return;
    }
    if (plan.delayMs > 0) {
      reindexTimer = setTimeout(() => {
        reindexTimer = void 0;
        pendingSince = 0;
        void runIndex("change");
      }, plan.delayMs);
    }
  };
  context.subscriptions.push(
    vscode7.window.registerWebviewViewProvider(HubViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );
  context.subscriptions.push(
    vscode7.workspace.onDidCreateFiles((event) => {
      if (event.files.some((uri) => uri.fsPath.toLowerCase().endsWith(".pdf"))) {
        scheduleIndex("change");
      }
    }),
    vscode7.workspace.onDidDeleteFiles((event) => {
      const pdfs = event.files.filter((uri) => uri.fsPath.toLowerCase().endsWith(".pdf"));
      if (pdfs.length) {
        for (const uri of pdfs) {
          service.invalidate(uri.fsPath);
        }
        scheduleIndex("change");
      }
    }),
    vscode7.workspace.onDidRenameFiles((event) => {
      if (event.files.some((file) => file.newUri.fsPath.toLowerCase().endsWith(".pdf"))) {
        scheduleIndex("change");
      }
    })
  );
  const watched = vscode7.workspace.createFileSystemWatcher("**/*.pdf");
  context.subscriptions.push(
    watched,
    watched.onDidChange((uri) => {
      pendingChanges.add(uri.fsPath);
      scheduleIndex("change");
    }),
    watched.onDidCreate(() => scheduleIndex("change")),
    watched.onDidDelete((uri) => {
      service.invalidate(uri.fsPath);
      scheduleIndex("change");
    })
  );
  const serviceHolder = service;
  provider.onViewOpened(() => {
    scheduleIndex("viewOpen");
    void serviceHolder.loadIndex().then(() => provider.push());
  });
  registerCommands(context, store, service, () => provider.focus());
  registerSmartGroupCommands(context, store, {
    refresh: async () => {
      await provider.push();
    },
    reindex: async () => {
      scheduleIndex("explicit");
    }
  });
  const track = (uri) => {
    if (!uri || uri.scheme !== "file") {
      return;
    }
    const ref = toFileRef(uri.fsPath);
    store.recordOpen(ref.path, ref.name, !ref.external, ref.relativePath);
    void registry.fire("onFileOpened", ref);
  };
  context.subscriptions.push(
    vscode7.window.onDidChangeActiveTextEditor((editor) => track(editor?.document.uri)),
    vscode7.window.tabGroups.onDidChangeTabs((event) => {
      for (const tab of event.opened) {
        const input = tab.input;
        if (input?.uri && input.uri.scheme === "file") {
          track(input.uri);
        }
      }
    }),
    vscode7.workspace.onDidChangeWorkspaceFolders(() => {
      store.pruneMissing();
      void refreshFileList().then(() => provider.push());
      void service.pruneIndex();
    }),
    vscode7.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("pdfHub")) {
        void provider.push();
      }
    })
  );
  store.pruneMissing();
  await service.loadIndex().catch(() => 0);
  await refreshFileList().catch(() => void 0);
  await provider.push().catch(() => void 0);
  scheduleIndex("startup");
  setTimeout(() => void service.pruneIndex().catch(() => 0), 15e3);
  const api = {
    registerSearchProvider: (p) => toDisposable(registry.registerSearchProvider(p)),
    registerSectionProvider: (p) => toDisposable(registry.registerSectionProvider(p)),
    addToFavorites: (fsPath, groupId) => {
      store.addFavorite(toFileRef(fsPath), groupId);
    },
    getGroups: () => store.getGroups().map((group) => ({ id: group.id, name: group.name, count: group.files.length })),
    createGroup: (name) => store.createGroup(name).id,
    listSmartGroups: () => store.getSmartGroups().map((rule) => ({
      id: rule.id,
      name: rule.name,
      enabled: rule.enabled,
      description: rule.description ?? ""
    })),
    createSmartGroup: (name, conditions) => store.createSmartGroup(name, conditions).id,
    reindex: async (options) => {
      if (options?.force) {
        await service.resetIndex();
      }
      const summary = await service.ensureIndex();
      return { phase: summary.phase, extracted: summary.extracted, cached: summary.cached };
    },
    hook: (name, callback) => toDisposable(registry.hook(name, callback)),
    version: context.extension.packageJSON.version,
    __test: {
      extractPdfText: (data) => pdfTextExtractor.extract(data),
      findPdfFiles: () => service.findPdfFiles(true)
    }
  };
  context.subscriptions.push(
    new vscode7.Disposable(() => {
      if (reindexTimer) {
        clearTimeout(reindexTimer);
      }
      store.dispose();
      service.dispose();
      registry.dispose();
    })
  );
  return api;
}
function toDisposable(value) {
  return new vscode7.Disposable(() => value.dispose());
}
function deactivate() {
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2V4dGVuc2lvbi50cyIsICIuLi9zcmMvYXBpL3JlZ2lzdHJ5LnRzIiwgIi4uL3NyYy9hcGkvcHJvdmlkZXJzL3BkZlNlYXJjaFByb3ZpZGVyLnRzIiwgIi4uL3NyYy9hcGkvcHJvdmlkZXJzL3JlY2VudFByb3ZpZGVyLnRzIiwgIi4uL3NyYy9hcGkvcHJvdmlkZXJzL2Zhdm9yaXRlc1Byb3ZpZGVyLnRzIiwgIi4uL3NyYy9hcGkvcHJvdmlkZXJzL2V4dGVybmFsUHJvdmlkZXIudHMiLCAiLi4vc3JjL2FwaS9wcm92aWRlcnMvc21hcnRHcm91cHNQcm92aWRlci50cyIsICIuLi9zcmMvc2VhcmNoL2dsb2IudHMiLCAiLi4vc3JjL3NlYXJjaC9zbWFydFJ1bGVzLnRzIiwgIi4uL3NyYy9jb21tYW5kcy50cyIsICIuLi9zcmMvZmlsZVJlZi50cyIsICIuLi9zcmMvc2VhcmNoL2luZGV4U3RvcmUudHMiLCAiLi4vc3JjL3NlYXJjaC9wZGZTZWFyY2gudHMiLCAiLi4vc3JjL3NlYXJjaC9yZWNlbnRzLnRzIiwgIi4uL3NyYy9pbmRleFNlcnZpY2UudHMiLCAiLi4vc3JjL3NlYXJjaC90ZXh0TWF0Y2gudHMiLCAiLi4vc3JjL3NlYXJjaC93b3Jrc3BhY2VGaWxlcy50cyIsICIuLi9zcmMvc2VhcmNoL3BkZlRleHQudHMiLCAiLi4vc3JjL3N0b3JlLnRzIiwgIi4uL3NyYy90eXBlcy50cyIsICIuLi9zcmMvc3RvcmVDb3JlLnRzIiwgIi4uL3NyYy91aS9odWJWaWV3UHJvdmlkZXIudHMiLCAiLi4vc3JjL3ZzY29kZUluZGV4RW52aXJvbm1lbnQudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCAqIGFzIHZzY29kZSBmcm9tICd2c2NvZGUnO1xuaW1wb3J0IHsgUHJvdmlkZXJSZWdpc3RyeSB9IGZyb20gJy4vYXBpL3JlZ2lzdHJ5LnRzJztcbmltcG9ydCB7IFBkZlNlYXJjaFByb3ZpZGVyIH0gZnJvbSAnLi9hcGkvcHJvdmlkZXJzL3BkZlNlYXJjaFByb3ZpZGVyLnRzJztcbmltcG9ydCB7IFJlY2VudEZpbGVzUHJvdmlkZXIgfSBmcm9tICcuL2FwaS9wcm92aWRlcnMvcmVjZW50UHJvdmlkZXIudHMnO1xuaW1wb3J0IHsgRmF2b3JpdGVzUHJvdmlkZXIgfSBmcm9tICcuL2FwaS9wcm92aWRlcnMvZmF2b3JpdGVzUHJvdmlkZXIudHMnO1xuaW1wb3J0IHsgRXh0ZXJuYWxGaWxlc1Byb3ZpZGVyIH0gZnJvbSAnLi9hcGkvcHJvdmlkZXJzL2V4dGVybmFsUHJvdmlkZXIudHMnO1xuaW1wb3J0IHsgU21hcnRHcm91cHNQcm92aWRlciB9IGZyb20gJy4vYXBpL3Byb3ZpZGVycy9zbWFydEdyb3Vwc1Byb3ZpZGVyLnRzJztcbmltcG9ydCB0eXBlIHsgU2VhcmNoUHJvdmlkZXIsIFNlY3Rpb25Qcm92aWRlciB9IGZyb20gJy4vYXBpL3R5cGVzLnRzJztcbmltcG9ydCB7IHJlZ2lzdGVyQ29tbWFuZHMsIHJlZ2lzdGVyU21hcnRHcm91cENvbW1hbmRzIH0gZnJvbSAnLi9jb21tYW5kcy50cyc7XG5pbXBvcnQgeyBQZGZJbmRleFN0b3JlIH0gZnJvbSAnLi9zZWFyY2gvaW5kZXhTdG9yZS50cyc7XG5pbXBvcnQgeyBQZGZTZWFyY2hTZXJ2aWNlIH0gZnJvbSAnLi9zZWFyY2gvcGRmU2VhcmNoLnRzJztcbmltcG9ydCB7IHBkZlRleHRFeHRyYWN0b3IgfSBmcm9tICcuL3NlYXJjaC9wZGZUZXh0LnRzJztcbmltcG9ydCB7IFN0b3JlIH0gZnJvbSAnLi9zdG9yZS50cyc7XG5pbXBvcnQgeyB0eXBlIEZpbGVSZWYgfSBmcm9tICcuL3R5cGVzLnRzJztcbmltcG9ydCB7IHRvRmlsZVJlZiB9IGZyb20gJy4vZmlsZVJlZi50cyc7XG5pbXBvcnQgeyBIdWJWaWV3UHJvdmlkZXIgfSBmcm9tICcuL3VpL2h1YlZpZXdQcm92aWRlci50cyc7XG5pbXBvcnQgeyByZWFkSW5kZXhDb25maWcsIFZzY29kZUluZGV4RW52aXJvbm1lbnQgfSBmcm9tICcuL3ZzY29kZUluZGV4RW52aXJvbm1lbnQudHMnO1xuXG4vKipcbiAqIFB1YmxpYyBleHRlbnNpb24gQVBJLiBBbnkgb3RoZXIgZXh0ZW5zaW9uIGNhbiBjYWxsXG4gKiBgdnNjb2RlLmV4dGVuc2lvbnMuZ2V0RXh0ZW5zaW9uKCdsb2NhbC1kZXYucGRmLWh1YicpPy5hY3RpdmF0ZSgpYCBhbmQgdGhlblxuICogcmVnaXN0ZXIgYWRkaXRpb25hbCBzZWFyY2ggb3Igc2VjdGlvbiBwcm92aWRlcnMsIHNvIG5ldyBmdW5jdGlvbmFsaXR5IGRvZXNcbiAqIG5vdCByZXF1aXJlIGVkaXRpbmcgdGhlIHNpZGViYXIuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUGRmSHViQXBpIHtcbiAgcmVnaXN0ZXJTZWFyY2hQcm92aWRlcihwcm92aWRlcjogU2VhcmNoUHJvdmlkZXIpOiB2c2NvZGUuRGlzcG9zYWJsZTtcbiAgcmVnaXN0ZXJTZWN0aW9uUHJvdmlkZXIocHJvdmlkZXI6IFNlY3Rpb25Qcm92aWRlcik6IHZzY29kZS5EaXNwb3NhYmxlO1xuICBhZGRUb0Zhdm9yaXRlcyhmc1BhdGg6IHN0cmluZywgZ3JvdXBJZD86IHN0cmluZyk6IHZvaWQ7XG4gIGdldEdyb3VwcygpOiB7IGlkOiBzdHJpbmc7IG5hbWU6IHN0cmluZzsgY291bnQ6IG51bWJlciB9W107XG4gIGNyZWF0ZUdyb3VwKG5hbWU6IHN0cmluZyk6IHN0cmluZztcbiAgLyoqIFNtYXJ0IGdyb3VwcyAoYXV0by1jb2xsZWN0aW9ucykgbWFuYWdlbWVudC4gKi9cbiAgbGlzdFNtYXJ0R3JvdXBzKCk6IHsgaWQ6IHN0cmluZzsgbmFtZTogc3RyaW5nOyBlbmFibGVkOiBib29sZWFuOyBkZXNjcmlwdGlvbjogc3RyaW5nIH1bXTtcbiAgY3JlYXRlU21hcnRHcm91cChuYW1lOiBzdHJpbmcsIGNvbmRpdGlvbnM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogc3RyaW5nO1xuICByZWluZGV4KG9wdGlvbnM/OiB7IGZvcmNlPzogYm9vbGVhbiB9KTogUHJvbWlzZTx7IHBoYXNlOiBzdHJpbmc7IGV4dHJhY3RlZDogbnVtYmVyOyBjYWNoZWQ6IG51bWJlciB9PjtcbiAgaG9vayhuYW1lOiBzdHJpbmcsIGNhbGxiYWNrOiAoLi4uYXJnczogdW5rbm93bltdKSA9PiB1bmtub3duKTogdnNjb2RlLkRpc3Bvc2FibGU7XG4gIHJlYWRvbmx5IHZlcnNpb246IHN0cmluZztcbiAgLyoqXG4gICAqIEludGVybmFsIHRlc3QgaG9vayBzbyB0aGUgcGFja2FnZWQgYnVuZGxlJ3MgUERGIHBpcGVsaW5lIGNhbiBiZSB2ZXJpZmllZFxuICAgKiBvdXRzaWRlIHRoZSBleHRlbnNpb24gaG9zdC4gTm90IHBhcnQgb2YgdGhlIHN1cHBvcnRlZCBBUEkgc3VyZmFjZS5cbiAgICovXG4gIHJlYWRvbmx5IF9fdGVzdDoge1xuICAgIGV4dHJhY3RQZGZUZXh0KGRhdGE6IFVpbnQ4QXJyYXkpOiBQcm9taXNlPHN0cmluZ1tdPjtcbiAgICBmaW5kUGRmRmlsZXMoKTogUHJvbWlzZTxGaWxlUmVmW10+O1xuICB9O1xufVxuXG4vKiogRGlzay1iYWNrZWQgc3RvcmFnZSBmb3IgdGhlIHBlcnNpc3RlbnQgaW5kZXggKHdvcmtzcGFjZS1zY29wZWQpLiAqL1xuZnVuY3Rpb24gaW5kZXhTdG9yYWdlKGNvbnRleHQ6IHZzY29kZS5FeHRlbnNpb25Db250ZXh0KSB7XG4gIGNvbnN0IHVyaSA9IHZzY29kZS5Vcmkuam9pblBhdGgoY29udGV4dC5zdG9yYWdlVXJpID8/IGNvbnRleHQuZ2xvYmFsU3RvcmFnZVVyaSwgJ3BkZi1pbmRleC5qc29uJyk7XG4gIHJldHVybiB7XG4gICAgYXN5bmMgcmVhZCgpOiBQcm9taXNlPHN0cmluZyB8IHVuZGVmaW5lZD4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgYnl0ZXMgPSBhd2FpdCB2c2NvZGUud29ya3NwYWNlLmZzLnJlYWRGaWxlKHVyaSk7XG4gICAgICAgIHJldHVybiBCdWZmZXIuZnJvbShieXRlcykudG9TdHJpbmcoJ3V0ZjgnKTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgfVxuICAgIH0sXG4gICAgYXN5bmMgd3JpdGUoY29udGVudHM6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgICAgY29uc3QgZm9sZGVyID0gdnNjb2RlLlVyaS5qb2luUGF0aCh1cmksICcuLicpO1xuICAgICAgYXdhaXQgdnNjb2RlLndvcmtzcGFjZS5mcy5jcmVhdGVEaXJlY3RvcnkoZm9sZGVyKTtcbiAgICAgIGF3YWl0IHZzY29kZS53b3Jrc3BhY2UuZnMud3JpdGVGaWxlKHVyaSwgQnVmZmVyLmZyb20oY29udGVudHMsICd1dGY4JykpO1xuICAgIH0sXG4gICAgYXN5bmMgZHJvcCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IHZzY29kZS53b3Jrc3BhY2UuZnMuZGVsZXRlKHVyaSk7XG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLyogYWxyZWFkeSBnb25lICovXG4gICAgICB9XG4gICAgfSxcbiAgfTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGFjdGl2YXRlKGNvbnRleHQ6IHZzY29kZS5FeHRlbnNpb25Db250ZXh0KTogUHJvbWlzZTxQZGZIdWJBcGk+IHtcbiAgY29uc3Qgc3RvcmUgPSBuZXcgU3RvcmUoY29udGV4dCk7XG4gIGNvbnN0IGluZGV4U3RvcmUgPSBuZXcgUGRmSW5kZXhTdG9yZShpbmRleFN0b3JhZ2UoY29udGV4dCkpO1xuICBjb25zdCByZWdpc3RyeSA9IG5ldyBQcm92aWRlclJlZ2lzdHJ5KCk7XG5cbiAgLy8gVGhlIGVudmlyb25tZW50IGlzIGNyZWF0ZWQgZmlyc3QsIHRoZW4gZ2l2ZW4gdGhlIHNlcnZpY2UncyBmaWxlIGxpc3RpbmcsIHNvXG4gIC8vIG5laXRoZXIgZGVwZW5kcyBvbiBhIGhhbGYtY29uc3RydWN0ZWQgdmVyc2lvbiBvZiB0aGUgb3RoZXIuXG4gIGNvbnN0IGVudmlyb25tZW50ID0gbmV3IFZzY29kZUluZGV4RW52aXJvbm1lbnQoKTtcbiAgY29uc3Qgc2VydmljZSA9IG5ldyBQZGZTZWFyY2hTZXJ2aWNlKHtcbiAgICBzdG9yZTogaW5kZXhTdG9yZSxcbiAgICBlbnZpcm9ubWVudCxcbiAgICBjb25maWc6IHJlYWRJbmRleENvbmZpZyxcbiAgfSk7XG4gIGVudmlyb25tZW50LnVzZUZpbGVMaXN0KCgpID0+IHNlcnZpY2UuZmluZFBkZkZpbGVzKHRydWUpKTtcblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBwcm92aWRlcnNcbiAgY29uc3QgZXh0ZXJuYWxGaWxlcyA9ICgpOiBGaWxlUmVmW10gPT4gc3RvcmUuZ2V0RXh0ZXJuYWwoKTtcbiAgcmVnaXN0cnkucmVnaXN0ZXJTZWFyY2hQcm92aWRlcihuZXcgUGRmU2VhcmNoUHJvdmlkZXIoc2VydmljZSwgZXh0ZXJuYWxGaWxlcykpO1xuICByZWdpc3RyeS5yZWdpc3RlclNlY3Rpb25Qcm92aWRlcihuZXcgUmVjZW50RmlsZXNQcm92aWRlcihzdG9yZSwgKCkgPT4gc2VydmljZUZpbGVzKSk7XG4gIHJlZ2lzdHJ5LnJlZ2lzdGVyU2VjdGlvblByb3ZpZGVyKG5ldyBGYXZvcml0ZXNQcm92aWRlcihzdG9yZSkpO1xuICByZWdpc3RyeS5yZWdpc3RlclNlY3Rpb25Qcm92aWRlcihuZXcgU21hcnRHcm91cHNQcm92aWRlcihzdG9yZSwgKCkgPT4gc2VydmljZUZpbGVzKSk7XG4gIHJlZ2lzdHJ5LnJlZ2lzdGVyU2VjdGlvblByb3ZpZGVyKG5ldyBFeHRlcm5hbEZpbGVzUHJvdmlkZXIoc3RvcmUpKTtcblxuICAvLyBDYWNoZWQgUERGIGxpc3QsIHJlZnJlc2hlZCB3aGVuIHRoZSB3b3Jrc3BhY2Ugb3IgdGhlIFBERiBpbmRleCBjaGFuZ2VzLlxuICBsZXQgc2VydmljZUZpbGVzOiBGaWxlUmVmW10gPSBbXTtcbiAgY29uc3QgcmVmcmVzaEZpbGVMaXN0ID0gYXN5bmMgKCk6IFByb21pc2U8dm9pZD4gPT4ge1xuICAgIHNlcnZpY2VGaWxlcyA9IGF3YWl0IHNlcnZpY2UuZmluZFBkZkZpbGVzKHRydWUpO1xuICB9O1xuXG4gIGNvbnN0IG9wZW5GaWxlID0gYXN5bmMgKGZpbGU6IEZpbGVSZWYpOiBQcm9taXNlPHZvaWQ+ID0+IHtcbiAgICBpZiAoIWZpbGUucGF0aCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCB1cmkgPSB2c2NvZGUuVXJpLmZpbGUoZmlsZS5wYXRoKTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgZG9jID0gYXdhaXQgdnNjb2RlLndvcmtzcGFjZS5vcGVuVGV4dERvY3VtZW50KHVyaSk7XG4gICAgICBhd2FpdCB2c2NvZGUud2luZG93LnNob3dUZXh0RG9jdW1lbnQoZG9jLCB7IHByZXZpZXc6IGZhbHNlIH0pO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gQmluYXJ5IGZpbGVzIChpbmNsdWRpbmcgUERGcykgb3BlbiB3aXRoIHRoZSBkZWZhdWx0IGhhbmRsZXIgaW5zdGVhZC5cbiAgICAgIGNvbnN0IG9wZW5lZCA9IGF3YWl0IHZzY29kZS5lbnYub3BlbkV4dGVybmFsKHVyaSk7XG4gICAgICBpZiAoIW9wZW5lZCkge1xuICAgICAgICB2b2lkIHZzY29kZS5jb21tYW5kcy5leGVjdXRlQ29tbWFuZCgndnNjb2RlLm9wZW4nLCB1cmkpO1xuICAgICAgfVxuICAgIH1cbiAgfTtcblxuICBjb25zdCBwcm92aWRlciA9IG5ldyBIdWJWaWV3UHJvdmlkZXIoXG4gICAgY29udGV4dC5leHRlbnNpb25VcmksXG4gICAgc3RvcmUsXG4gICAgc2VydmljZSxcbiAgICByZWdpc3RyeSxcbiAgICBvcGVuRmlsZSxcbiAgICBhc3luYyAoKSA9PiB7XG4gICAgICBhd2FpdCB2c2NvZGUuY29tbWFuZHMuZXhlY3V0ZUNvbW1hbmQoJ3BkZkh1Yi5hZGRFeHRlcm5hbEZpbGUnKTtcbiAgICB9LFxuICAgIHtcbiAgICAgIGNyZWF0ZTogYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCB2c2NvZGUuY29tbWFuZHMuZXhlY3V0ZUNvbW1hbmQoJ3BkZkh1Yi5jcmVhdGVHcm91cCcpO1xuICAgICAgfSxcbiAgICAgIHJlbmFtZTogYXN5bmMgKGdyb3VwSWQ6IHN0cmluZykgPT4ge1xuICAgICAgICBhd2FpdCB2c2NvZGUuY29tbWFuZHMuZXhlY3V0ZUNvbW1hbmQoJ3BkZkh1Yi5yZW5hbWVHcm91cCcsIGdyb3VwSWQpO1xuICAgICAgfSxcbiAgICAgIGRlbGV0ZTogYXN5bmMgKGdyb3VwSWQ6IHN0cmluZykgPT4ge1xuICAgICAgICBhd2FpdCB2c2NvZGUuY29tbWFuZHMuZXhlY3V0ZUNvbW1hbmQoJ3BkZkh1Yi5kZWxldGVHcm91cCcsIGdyb3VwSWQpO1xuICAgICAgfSxcbiAgICB9XG4gICk7XG5cbiAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gaW5kZXhpbmdcblxuICBjb25zdCBwZW5kaW5nQ2hhbmdlcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBsZXQgcGVuZGluZ1NpbmNlID0gMDtcbiAgbGV0IHJlaW5kZXhUaW1lcjogTm9kZUpTLlRpbWVvdXQgfCB1bmRlZmluZWQ7XG5cbiAgY29uc3QgcnVuSW5kZXggPSBhc3luYyAocmVhc29uOiAnZXhwbGljaXQnIHwgJ2NoYW5nZScgfCAndmlld09wZW4nIHwgJ3N0YXJ0dXAnKTogUHJvbWlzZTx2b2lkPiA9PiB7XG4gICAgaWYgKHNlcnZpY2UucHJvZ3Jlc3MucGhhc2UgPT09ICdpbmRleGluZycpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKHBlbmRpbmdDaGFuZ2VzLnNpemUpIHtcbiAgICAgIGZvciAoY29uc3QgcGF0aCBvZiBwZW5kaW5nQ2hhbmdlcykge1xuICAgICAgICBzZXJ2aWNlLmludmFsaWRhdGUocGF0aCk7XG4gICAgICB9XG4gICAgICBwZW5kaW5nQ2hhbmdlcy5jbGVhcigpO1xuICAgIH1cbiAgICBpZiAocmVhc29uICE9PSAnZXhwbGljaXQnKSB7XG4gICAgICBhd2FpdCByZWZyZXNoRmlsZUxpc3QoKTtcbiAgICB9XG4gICAgY29uc3Qgc3VtbWFyeSA9IGF3YWl0IHNlcnZpY2UuZW5zdXJlSW5kZXgoKTtcbiAgICBhd2FpdCBwcm92aWRlci5wdXNoKCk7XG4gICAgdm9pZCBzdW1tYXJ5O1xuICAgIGF3YWl0IHJlZ2lzdHJ5LmZpcmUoJ29uSW5kZXhSZWFkeScsIHN1bW1hcnkuZXh0cmFjdGVkKTtcbiAgfTtcblxuICAvKipcbiAgICogQ29hbGVzY2VzIHJlaW5kZXggcmVxdWVzdHMuIE9wZW5pbmcgYSB3aW5kb3csIHN3aXRjaGluZyB0YWJzIG9yIHNhdmluZyBhblxuICAgKiB1bnJlbGF0ZWQgZmlsZSBtdXN0IG5vdCB0cmlnZ2VyIFBERiBleHRyYWN0aW9uOiBvbmx5IHJlYWwgUERGIGNoYW5nZXMsXG4gICAqIGFuIG9wdGVkLWluIHN0YXJ0dXAgcG9saWN5LCBvciBhbiBleHBsaWNpdCByZXF1ZXN0IHNjaGVkdWxlIHdvcmsuXG4gICAqL1xuICBjb25zdCBzY2hlZHVsZUluZGV4ID0gKHJlYXNvbjogJ2V4cGxpY2l0JyB8ICdjaGFuZ2UnIHwgJ3ZpZXdPcGVuJyB8ICdzdGFydHVwJyk6IHZvaWQgPT4ge1xuICAgIGlmIChyZWFzb24gPT09ICdjaGFuZ2UnKSB7XG4gICAgICBwZW5kaW5nU2luY2UgPSBwZW5kaW5nU2luY2UgfHwgRGF0ZS5ub3coKTtcbiAgICB9XG4gICAgY29uc3QgcGxhbiA9IHN0b3JlLnBsYW5SZWluZGV4KHJlYXNvbiwgRGF0ZS5ub3coKSwgcGVuZGluZ1NpbmNlKTtcbiAgICBpZiAocmVpbmRleFRpbWVyKSB7XG4gICAgICBjbGVhclRpbWVvdXQocmVpbmRleFRpbWVyKTtcbiAgICAgIHJlaW5kZXhUaW1lciA9IHVuZGVmaW5lZDtcbiAgICB9XG4gICAgaWYgKHBsYW4ucnVuTm93KSB7XG4gICAgICBwZW5kaW5nU2luY2UgPSAwO1xuICAgICAgdm9pZCBydW5JbmRleChyZWFzb24gPT09ICdjaGFuZ2UnID8gJ2NoYW5nZScgOiByZWFzb24pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAocGxhbi5kZWxheU1zID4gMCkge1xuICAgICAgcmVpbmRleFRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIHJlaW5kZXhUaW1lciA9IHVuZGVmaW5lZDtcbiAgICAgICAgcGVuZGluZ1NpbmNlID0gMDtcbiAgICAgICAgdm9pZCBydW5JbmRleCgnY2hhbmdlJyk7XG4gICAgICB9LCBwbGFuLmRlbGF5TXMpO1xuICAgIH1cbiAgfTtcblxuICBjb250ZXh0LnN1YnNjcmlwdGlvbnMucHVzaChcbiAgICB2c2NvZGUud2luZG93LnJlZ2lzdGVyV2Vidmlld1ZpZXdQcm92aWRlcihIdWJWaWV3UHJvdmlkZXIudmlld1R5cGUsIHByb3ZpZGVyLCB7XG4gICAgICB3ZWJ2aWV3T3B0aW9uczogeyByZXRhaW5Db250ZXh0V2hlbkhpZGRlbjogdHJ1ZSB9LFxuICAgIH0pXG4gICk7XG5cbiAgY29udGV4dC5zdWJzY3JpcHRpb25zLnB1c2goXG4gICAgdnNjb2RlLndvcmtzcGFjZS5vbkRpZENyZWF0ZUZpbGVzKChldmVudCkgPT4ge1xuICAgICAgaWYgKGV2ZW50LmZpbGVzLnNvbWUoKHVyaSkgPT4gdXJpLmZzUGF0aC50b0xvd2VyQ2FzZSgpLmVuZHNXaXRoKCcucGRmJykpKSB7XG4gICAgICAgIHNjaGVkdWxlSW5kZXgoJ2NoYW5nZScpO1xuICAgICAgfVxuICAgIH0pLFxuICAgIHZzY29kZS53b3Jrc3BhY2Uub25EaWREZWxldGVGaWxlcygoZXZlbnQpID0+IHtcbiAgICAgIGNvbnN0IHBkZnMgPSBldmVudC5maWxlcy5maWx0ZXIoKHVyaSkgPT4gdXJpLmZzUGF0aC50b0xvd2VyQ2FzZSgpLmVuZHNXaXRoKCcucGRmJykpO1xuICAgICAgaWYgKHBkZnMubGVuZ3RoKSB7XG4gICAgICAgIGZvciAoY29uc3QgdXJpIG9mIHBkZnMpIHtcbiAgICAgICAgICBzZXJ2aWNlLmludmFsaWRhdGUodXJpLmZzUGF0aCk7XG4gICAgICAgIH1cbiAgICAgICAgc2NoZWR1bGVJbmRleCgnY2hhbmdlJyk7XG4gICAgICB9XG4gICAgfSksXG4gICAgdnNjb2RlLndvcmtzcGFjZS5vbkRpZFJlbmFtZUZpbGVzKChldmVudCkgPT4ge1xuICAgICAgaWYgKGV2ZW50LmZpbGVzLnNvbWUoKGZpbGUpID0+IGZpbGUubmV3VXJpLmZzUGF0aC50b0xvd2VyQ2FzZSgpLmVuZHNXaXRoKCcucGRmJykpKSB7XG4gICAgICAgIHNjaGVkdWxlSW5kZXgoJ2NoYW5nZScpO1xuICAgICAgfVxuICAgIH0pXG4gICk7XG5cbiAgLy8gQSB3YXRjaGVyIGlzIG9ubHkgY3JlYXRlZCB3aGVuIHRoZSB1c2VyIGFza2VkIGZvciBhdXRvbWF0aWMgaW5kZXhpbmcuXG4gIGNvbnN0IHdhdGNoZWQgPSB2c2NvZGUud29ya3NwYWNlLmNyZWF0ZUZpbGVTeXN0ZW1XYXRjaGVyKCcqKi8qLnBkZicpO1xuICBjb250ZXh0LnN1YnNjcmlwdGlvbnMucHVzaChcbiAgICB3YXRjaGVkLFxuICAgIHdhdGNoZWQub25EaWRDaGFuZ2UoKHVyaSkgPT4ge1xuICAgICAgcGVuZGluZ0NoYW5nZXMuYWRkKHVyaS5mc1BhdGgpO1xuICAgICAgc2NoZWR1bGVJbmRleCgnY2hhbmdlJyk7XG4gICAgfSksXG4gICAgd2F0Y2hlZC5vbkRpZENyZWF0ZSgoKSA9PiBzY2hlZHVsZUluZGV4KCdjaGFuZ2UnKSksXG4gICAgd2F0Y2hlZC5vbkRpZERlbGV0ZSgodXJpKSA9PiB7XG4gICAgICBzZXJ2aWNlLmludmFsaWRhdGUodXJpLmZzUGF0aCk7XG4gICAgICBzY2hlZHVsZUluZGV4KCdjaGFuZ2UnKTtcbiAgICB9KVxuICApO1xuXG4gIGNvbnN0IHNlcnZpY2VIb2xkZXIgPSBzZXJ2aWNlO1xuICBwcm92aWRlci5vblZpZXdPcGVuZWQoKCkgPT4ge1xuICAgIHNjaGVkdWxlSW5kZXgoJ3ZpZXdPcGVuJyk7XG4gICAgdm9pZCBzZXJ2aWNlSG9sZGVyLmxvYWRJbmRleCgpLnRoZW4oKCkgPT4gcHJvdmlkZXIucHVzaCgpKTtcbiAgfSk7XG5cbiAgcmVnaXN0ZXJDb21tYW5kcyhjb250ZXh0LCBzdG9yZSwgc2VydmljZSwgKCkgPT4gcHJvdmlkZXIuZm9jdXMoKSk7XG4gIHJlZ2lzdGVyU21hcnRHcm91cENvbW1hbmRzKGNvbnRleHQsIHN0b3JlLCB7XG4gICAgcmVmcmVzaDogYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgcHJvdmlkZXIucHVzaCgpO1xuICAgIH0sXG4gICAgcmVpbmRleDogYXN5bmMgKCkgPT4ge1xuICAgICAgc2NoZWR1bGVJbmRleCgnZXhwbGljaXQnKTtcbiAgICB9LFxuICB9KTtcblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gb3Blbi1maWxlIHRyYWNraW5nXG4gIGNvbnN0IHRyYWNrID0gKHVyaTogdnNjb2RlLlVyaSB8IHVuZGVmaW5lZCk6IHZvaWQgPT4ge1xuICAgIGlmICghdXJpIHx8IHVyaS5zY2hlbWUgIT09ICdmaWxlJykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCByZWYgPSB0b0ZpbGVSZWYodXJpLmZzUGF0aCk7XG4gICAgc3RvcmUucmVjb3JkT3BlbihyZWYucGF0aCwgcmVmLm5hbWUsICFyZWYuZXh0ZXJuYWwsIHJlZi5yZWxhdGl2ZVBhdGgpO1xuICAgIHZvaWQgcmVnaXN0cnkuZmlyZSgnb25GaWxlT3BlbmVkJywgcmVmKTtcbiAgfTtcblxuICBjb250ZXh0LnN1YnNjcmlwdGlvbnMucHVzaChcbiAgICB2c2NvZGUud2luZG93Lm9uRGlkQ2hhbmdlQWN0aXZlVGV4dEVkaXRvcigoZWRpdG9yKSA9PiB0cmFjayhlZGl0b3I/LmRvY3VtZW50LnVyaSkpLFxuICAgIHZzY29kZS53aW5kb3cudGFiR3JvdXBzLm9uRGlkQ2hhbmdlVGFicygoZXZlbnQpID0+IHtcbiAgICAgIGZvciAoY29uc3QgdGFiIG9mIGV2ZW50Lm9wZW5lZCkge1xuICAgICAgICBjb25zdCBpbnB1dCA9IHRhYi5pbnB1dCBhcyB7IHVyaT86IHZzY29kZS5VcmkgfSB8IHVuZGVmaW5lZDtcbiAgICAgICAgaWYgKGlucHV0Py51cmkgJiYgaW5wdXQudXJpLnNjaGVtZSA9PT0gJ2ZpbGUnKSB7XG4gICAgICAgICAgdHJhY2soaW5wdXQudXJpKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pLFxuICAgIHZzY29kZS53b3Jrc3BhY2Uub25EaWRDaGFuZ2VXb3Jrc3BhY2VGb2xkZXJzKCgpID0+IHtcbiAgICAgIHN0b3JlLnBydW5lTWlzc2luZygpO1xuICAgICAgdm9pZCByZWZyZXNoRmlsZUxpc3QoKS50aGVuKCgpID0+IHByb3ZpZGVyLnB1c2goKSk7XG4gICAgICB2b2lkIHNlcnZpY2UucHJ1bmVJbmRleCgpO1xuICAgIH0pLFxuICAgIHZzY29kZS53b3Jrc3BhY2Uub25EaWRDaGFuZ2VDb25maWd1cmF0aW9uKChldmVudCkgPT4ge1xuICAgICAgaWYgKGV2ZW50LmFmZmVjdHNDb25maWd1cmF0aW9uKCdwZGZIdWInKSkge1xuICAgICAgICB2b2lkIHByb3ZpZGVyLnB1c2goKTtcbiAgICAgIH1cbiAgICB9KVxuICApO1xuXG4gIC8vIENoZWFwIHN0YXJ0dXAgd29yayBvbmx5OiBsb2FkIHRoZSBwZXJzaXN0ZWQgaW5kZXggYW5kIGhvbm91ciB0aGUgdHJpZ2dlclxuICAvLyBwb2xpY3kuIEFuIHVuY2hhbmdlZCBjb3JwdXMgY29zdHMgYSBzaW5nbGUgZmlsZSByZWFkIHBsdXMgYSBzdGF0IHBhc3MuXG4gIHN0b3JlLnBydW5lTWlzc2luZygpO1xuICBhd2FpdCBzZXJ2aWNlLmxvYWRJbmRleCgpLmNhdGNoKCgpID0+IDApO1xuICBhd2FpdCByZWZyZXNoRmlsZUxpc3QoKS5jYXRjaCgoKSA9PiB1bmRlZmluZWQpO1xuICBhd2FpdCBwcm92aWRlci5wdXNoKCkuY2F0Y2goKCkgPT4gdW5kZWZpbmVkKTtcbiAgc2NoZWR1bGVJbmRleCgnc3RhcnR1cCcpO1xuICBzZXRUaW1lb3V0KCgpID0+IHZvaWQgc2VydmljZS5wcnVuZUluZGV4KCkuY2F0Y2goKCkgPT4gMCksIDE1XzAwMCk7XG5cbiAgY29uc3QgYXBpOiBQZGZIdWJBcGkgPSB7XG4gICAgcmVnaXN0ZXJTZWFyY2hQcm92aWRlcjogKHApID0+IHRvRGlzcG9zYWJsZShyZWdpc3RyeS5yZWdpc3RlclNlYXJjaFByb3ZpZGVyKHApKSxcbiAgICByZWdpc3RlclNlY3Rpb25Qcm92aWRlcjogKHApID0+IHRvRGlzcG9zYWJsZShyZWdpc3RyeS5yZWdpc3RlclNlY3Rpb25Qcm92aWRlcihwKSksXG4gICAgYWRkVG9GYXZvcml0ZXM6IChmc1BhdGgsIGdyb3VwSWQpID0+IHtcbiAgICAgIHN0b3JlLmFkZEZhdm9yaXRlKHRvRmlsZVJlZihmc1BhdGgpLCBncm91cElkKTtcbiAgICB9LFxuICAgIGdldEdyb3VwczogKCkgPT5cbiAgICAgIHN0b3JlLmdldEdyb3VwcygpLm1hcCgoZ3JvdXApID0+ICh7IGlkOiBncm91cC5pZCwgbmFtZTogZ3JvdXAubmFtZSwgY291bnQ6IGdyb3VwLmZpbGVzLmxlbmd0aCB9KSksXG4gICAgY3JlYXRlR3JvdXA6IChuYW1lKSA9PiBzdG9yZS5jcmVhdGVHcm91cChuYW1lKS5pZCxcbiAgICBsaXN0U21hcnRHcm91cHM6ICgpID0+XG4gICAgICBzdG9yZS5nZXRTbWFydEdyb3VwcygpLm1hcCgocnVsZSkgPT4gKHtcbiAgICAgICAgaWQ6IHJ1bGUuaWQsXG4gICAgICAgIG5hbWU6IHJ1bGUubmFtZSxcbiAgICAgICAgZW5hYmxlZDogcnVsZS5lbmFibGVkLFxuICAgICAgICBkZXNjcmlwdGlvbjogcnVsZS5kZXNjcmlwdGlvbiA/PyAnJyxcbiAgICAgIH0pKSxcbiAgICBjcmVhdGVTbWFydEdyb3VwOiAobmFtZSwgY29uZGl0aW9ucykgPT5cbiAgICAgIHN0b3JlLmNyZWF0ZVNtYXJ0R3JvdXAobmFtZSwgY29uZGl0aW9ucyBhcyBuZXZlcikuaWQsXG4gICAgcmVpbmRleDogYXN5bmMgKG9wdGlvbnMpID0+IHtcbiAgICAgIGlmIChvcHRpb25zPy5mb3JjZSkge1xuICAgICAgICBhd2FpdCBzZXJ2aWNlLnJlc2V0SW5kZXgoKTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHN1bW1hcnkgPSBhd2FpdCBzZXJ2aWNlLmVuc3VyZUluZGV4KCk7XG4gICAgICByZXR1cm4geyBwaGFzZTogc3VtbWFyeS5waGFzZSwgZXh0cmFjdGVkOiBzdW1tYXJ5LmV4dHJhY3RlZCwgY2FjaGVkOiBzdW1tYXJ5LmNhY2hlZCB9O1xuICAgIH0sXG4gICAgaG9vazogKG5hbWUsIGNhbGxiYWNrKSA9PiB0b0Rpc3Bvc2FibGUocmVnaXN0cnkuaG9vayhuYW1lLCBjYWxsYmFjaykpLFxuICAgIHZlcnNpb246IGNvbnRleHQuZXh0ZW5zaW9uLnBhY2thZ2VKU09OLnZlcnNpb24gYXMgc3RyaW5nLFxuICAgIF9fdGVzdDoge1xuICAgICAgZXh0cmFjdFBkZlRleHQ6IChkYXRhKSA9PiBwZGZUZXh0RXh0cmFjdG9yLmV4dHJhY3QoZGF0YSksXG4gICAgICBmaW5kUGRmRmlsZXM6ICgpID0+IHNlcnZpY2UuZmluZFBkZkZpbGVzKHRydWUpLFxuICAgIH0sXG4gIH07XG5cbiAgY29udGV4dC5zdWJzY3JpcHRpb25zLnB1c2goXG4gICAgbmV3IHZzY29kZS5EaXNwb3NhYmxlKCgpID0+IHtcbiAgICAgIGlmIChyZWluZGV4VGltZXIpIHtcbiAgICAgICAgY2xlYXJUaW1lb3V0KHJlaW5kZXhUaW1lcik7XG4gICAgICB9XG4gICAgICBzdG9yZS5kaXNwb3NlKCk7XG4gICAgICBzZXJ2aWNlLmRpc3Bvc2UoKTtcbiAgICAgIHJlZ2lzdHJ5LmRpc3Bvc2UoKTtcbiAgICB9KVxuICApO1xuXG4gIHJldHVybiBhcGk7XG59XG5cbmZ1bmN0aW9uIHRvRGlzcG9zYWJsZSh2YWx1ZTogeyBkaXNwb3NlKCk6IHZvaWQgfSk6IHZzY29kZS5EaXNwb3NhYmxlIHtcbiAgcmV0dXJuIG5ldyB2c2NvZGUuRGlzcG9zYWJsZSgoKSA9PiB2YWx1ZS5kaXNwb3NlKCkpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZGVhY3RpdmF0ZSgpOiB2b2lkIHtcbiAgLyogZGlzcG9zYWJsZXMgYXJlIGhhbmRsZWQgdGhyb3VnaCBjb250ZXh0LnN1YnNjcmlwdGlvbnMgKi9cbn1cbiIsICJpbXBvcnQgdHlwZSB7IFNlYXJjaFByb3ZpZGVyLCBTZWN0aW9uUHJvdmlkZXIgfSBmcm9tICcuL3R5cGVzLnRzJztcblxuLyoqXG4gKiBUaW55IHJlZ2lzdHJ5IHRoYXQgbWFrZXMgdGhlIGV4dGVuc2lvbiBleHRlbmRhYmxlIHdpdGhvdXQgZWRpdGluZyB0aGUgVUkuXG4gKlxuICogT3RoZXIgZXh0ZW5zaW9ucyBjYW4gcmVhY2ggaXQgdGhyb3VnaCB0aGUgZXhwb3J0ZWQgYWN0aXZhdGlvbiBBUEk6XG4gKlxuICogICBjb25zdCBleHQgPSB2c2NvZGUuZXh0ZW5zaW9ucy5nZXRFeHRlbnNpb24oJ2xvY2FsLWRldi5wZGYtaHViJyk7XG4gKiAgIGNvbnN0IGFwaSA9IGF3YWl0IGV4dC5hY3RpdmF0ZSgpO1xuICogICBhcGkucmVnaXN0ZXJTZWFyY2hQcm92aWRlcihteVByb3ZpZGVyKTtcbiAqXG4gKiBJbnNpZGUgdGhpcyBleHRlbnNpb24sIHRoZSBzYW1lIHJlZ2lzdHJ5IGlzIHVzZWQgYnkgdGhlIGJ1aWx0LWluIHByb3ZpZGVycy5cbiAqL1xuZXhwb3J0IGNsYXNzIFByb3ZpZGVyUmVnaXN0cnkge1xuICBwcml2YXRlIHJlYWRvbmx5IHNlYXJjaFByb3ZpZGVycyA9IG5ldyBNYXA8c3RyaW5nLCBTZWFyY2hQcm92aWRlcj4oKTtcbiAgcHJpdmF0ZSByZWFkb25seSBzZWN0aW9uUHJvdmlkZXJzID0gbmV3IE1hcDxzdHJpbmcsIFNlY3Rpb25Qcm92aWRlcj4oKTtcbiAgLyoqIEdlbmVyaWMgZmVhdHVyZSBob29rczogbmFtZSAtPiBjYWxsYmFja3MsIGZvciBmdXR1cmUgZnVuY3Rpb25hbGl0eS4gKi9cbiAgcHJpdmF0ZSByZWFkb25seSBob29rcyA9IG5ldyBNYXA8c3RyaW5nLCBTZXQ8KC4uLmFyZ3M6IHVua25vd25bXSkgPT4gdW5rbm93bj4+KCk7XG4gIC8qKiBDYWxsZWQgd2hlbmV2ZXIgdGhlIHJlZ2lzdHJ5IGNoYW5nZXMsIHNvIHRoZSBzaWRlYmFyIGNhbiByZS1xdWVyeS4gKi9cbiAgcHJpdmF0ZSByZWFkb25seSBsaXN0ZW5lcnMgPSBuZXcgU2V0PCgpID0+IHZvaWQ+KCk7XG5cbiAgb25EaWRDaGFuZ2UobGlzdGVuZXI6ICgpID0+IHZvaWQpOiB7IGRpc3Bvc2UoKTogdm9pZCB9IHtcbiAgICB0aGlzLmxpc3RlbmVycy5hZGQobGlzdGVuZXIpO1xuICAgIHJldHVybiB7IGRpc3Bvc2U6ICgpID0+IHRoaXMubGlzdGVuZXJzLmRlbGV0ZShsaXN0ZW5lcikgfTtcbiAgfVxuXG4gIHByaXZhdGUgbm90aWZ5KCk6IHZvaWQge1xuICAgIGZvciAoY29uc3QgbGlzdGVuZXIgb2YgWy4uLnRoaXMubGlzdGVuZXJzXSkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgbGlzdGVuZXIoKTtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvKiBhIGJyb2tlbiBsaXN0ZW5lciBtdXN0IG5vdCBicmVhayB0aGUgcmVnaXN0cnkgKi9cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZWdpc3RlclNlYXJjaFByb3ZpZGVyKHByb3ZpZGVyOiBTZWFyY2hQcm92aWRlcik6IHsgZGlzcG9zZSgpOiB2b2lkIH0ge1xuICAgIGlmICh0aGlzLnNlYXJjaFByb3ZpZGVycy5oYXMocHJvdmlkZXIuaWQpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFNlYXJjaCBwcm92aWRlciBcIiR7cHJvdmlkZXIuaWR9XCIgaXMgYWxyZWFkeSByZWdpc3RlcmVkLmApO1xuICAgIH1cbiAgICB0aGlzLnNlYXJjaFByb3ZpZGVycy5zZXQocHJvdmlkZXIuaWQsIHByb3ZpZGVyKTtcbiAgICB0aGlzLm5vdGlmeSgpO1xuICAgIHJldHVybiB7IGRpc3Bvc2U6ICgpID0+IHRoaXMudW5yZWdpc3RlclNlYXJjaFByb3ZpZGVyKHByb3ZpZGVyLmlkKSB9O1xuICB9XG5cbiAgdW5yZWdpc3RlclNlYXJjaFByb3ZpZGVyKGlkOiBzdHJpbmcpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5zZWFyY2hQcm92aWRlcnMuZGVsZXRlKGlkKSkge1xuICAgICAgdGhpcy5ub3RpZnkoKTtcbiAgICB9XG4gIH1cblxuICByZWdpc3RlclNlY3Rpb25Qcm92aWRlcihwcm92aWRlcjogU2VjdGlvblByb3ZpZGVyKTogeyBkaXNwb3NlKCk6IHZvaWQgfSB7XG4gICAgaWYgKHRoaXMuc2VjdGlvblByb3ZpZGVycy5oYXMocHJvdmlkZXIuaWQpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFNlY3Rpb24gcHJvdmlkZXIgXCIke3Byb3ZpZGVyLmlkfVwiIGlzIGFscmVhZHkgcmVnaXN0ZXJlZC5gKTtcbiAgICB9XG4gICAgdGhpcy5zZWN0aW9uUHJvdmlkZXJzLnNldChwcm92aWRlci5pZCwgcHJvdmlkZXIpO1xuICAgIHRoaXMubm90aWZ5KCk7XG4gICAgcmV0dXJuIHsgZGlzcG9zZTogKCkgPT4gdGhpcy51bnJlZ2lzdGVyU2VjdGlvblByb3ZpZGVyKHByb3ZpZGVyLmlkKSB9O1xuICB9XG5cbiAgdW5yZWdpc3RlclNlY3Rpb25Qcm92aWRlcihpZDogc3RyaW5nKTogdm9pZCB7XG4gICAgaWYgKHRoaXMuc2VjdGlvblByb3ZpZGVycy5kZWxldGUoaWQpKSB7XG4gICAgICB0aGlzLm5vdGlmeSgpO1xuICAgIH1cbiAgfVxuXG4gIGdldFNlYXJjaFByb3ZpZGVycygpOiBTZWFyY2hQcm92aWRlcltdIHtcbiAgICByZXR1cm4gWy4uLnRoaXMuc2VhcmNoUHJvdmlkZXJzLnZhbHVlcygpXS5zb3J0KChhLCBiKSA9PiAoYS5vcmRlciA/PyAxMDApIC0gKGIub3JkZXIgPz8gMTAwKSk7XG4gIH1cblxuICBnZXRTZWN0aW9uUHJvdmlkZXJzKCk6IFNlY3Rpb25Qcm92aWRlcltdIHtcbiAgICByZXR1cm4gWy4uLnRoaXMuc2VjdGlvblByb3ZpZGVycy52YWx1ZXMoKV0uc29ydCgoYSwgYikgPT4gKGEub3JkZXIgPz8gMTAwKSAtIChiLm9yZGVyID8/IDEwMCkpO1xuICB9XG5cbiAgLyoqIEV4dGVuc2lvbiBob29rOiBgYXBpLmhvb2soJ29uRmlsZU9wZW5lZCcsIGZuKWAgdG8gb2JzZXJ2ZSBvciBleHRlbmQgYmVoYXZpb3VyLiAqL1xuICBob29rKG5hbWU6IHN0cmluZywgY2FsbGJhY2s6ICguLi5hcmdzOiB1bmtub3duW10pID0+IHVua25vd24pOiB7IGRpc3Bvc2UoKTogdm9pZCB9IHtcbiAgICBsZXQgc2V0ID0gdGhpcy5ob29rcy5nZXQobmFtZSk7XG4gICAgaWYgKCFzZXQpIHtcbiAgICAgIHNldCA9IG5ldyBTZXQoKTtcbiAgICAgIHRoaXMuaG9va3Muc2V0KG5hbWUsIHNldCk7XG4gICAgfVxuICAgIHNldC5hZGQoY2FsbGJhY2spO1xuICAgIHJldHVybiB7IGRpc3Bvc2U6ICgpID0+IHNldD8uZGVsZXRlKGNhbGxiYWNrKSB9O1xuICB9XG5cbiAgYXN5bmMgZmlyZShuYW1lOiBzdHJpbmcsIC4uLmFyZ3M6IHVua25vd25bXSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHNldCA9IHRoaXMuaG9va3MuZ2V0KG5hbWUpO1xuICAgIGlmICghc2V0KSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGZvciAoY29uc3QgY2FsbGJhY2sgb2YgWy4uLnNldF0pIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IGNhbGxiYWNrKC4uLmFyZ3MpO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8qIGhvb2sgZmFpbHVyZXMgYXJlIGlzb2xhdGVkICovXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgZGlzcG9zZSgpOiB2b2lkIHtcbiAgICB0aGlzLnNlYXJjaFByb3ZpZGVycy5jbGVhcigpO1xuICAgIHRoaXMuc2VjdGlvblByb3ZpZGVycy5jbGVhcigpO1xuICAgIHRoaXMuaG9va3MuY2xlYXIoKTtcbiAgICB0aGlzLmxpc3RlbmVycy5jbGVhcigpO1xuICB9XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBGaWxlUmVmIH0gZnJvbSAnLi4vLi4vdHlwZXMudHMnO1xuaW1wb3J0IHR5cGUgeyBTZWFyY2hIaXQsIFNlYXJjaFByb3ZpZGVyLCBTZWFyY2hRdWVyeSwgU2VhcmNoUmVzdWx0IH0gZnJvbSAnLi4vdHlwZXMudHMnO1xuaW1wb3J0IHR5cGUgeyBQZGZTZWFyY2hTZXJ2aWNlIH0gZnJvbSAnLi4vLi4vc2VhcmNoL3BkZlNlYXJjaC50cyc7XG5cbi8qKlxuICogU2VhcmNoZXMgUERGcyB0d28gd2F5czpcbiAqICAtIFwibmFtZSBvbmx5XCIgbW9kZSBmaWx0ZXJzIGZpbGUgbmFtZXMvcGF0aHMsXG4gKiAgLSBvdGhlcndpc2UgaXQgc2VhcmNoZXMgZXh0cmFjdGVkIFBERiB0ZXh0ICh3aXRoIHRoZSBmaWxlLW5hbWUgaGl0cyBrZXB0IG9uXG4gKiAgICB0b3Agc28gYSBxdWVyeSBsaWtlIFwiaW52b2ljZVwiIHN0aWxsIGZpbmRzIGBpbnZvaWNlLTIwMjQucGRmYCkuXG4gKi9cbmV4cG9ydCBjbGFzcyBQZGZTZWFyY2hQcm92aWRlciBpbXBsZW1lbnRzIFNlYXJjaFByb3ZpZGVyIHtcbiAgcmVhZG9ubHkgaWQgPSAncGRmJztcbiAgcmVhZG9ubHkgbGFiZWwgPSAnUERGJztcbiAgcmVhZG9ubHkgb3JkZXIgPSAxMDtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBwcml2YXRlIHJlYWRvbmx5IHNlcnZpY2U6IFBkZlNlYXJjaFNlcnZpY2UsXG4gICAgcHJpdmF0ZSByZWFkb25seSBnZXRFeHRlcm5hbDogKCkgPT4gRmlsZVJlZltdXG4gICkge31cblxuICBhc3luYyBzZWFyY2gocXVlcnk6IFNlYXJjaFF1ZXJ5KTogUHJvbWlzZTxTZWFyY2hSZXN1bHQ+IHtcbiAgICBjb25zdCBmaWxlcyA9IGF3YWl0IHRoaXMuc2VydmljZS5zZWFyY2hhYmxlRmlsZXModGhpcy5nZXRFeHRlcm5hbCgpKTtcbiAgICBjb25zdCBuYW1lSGl0czogU2VhcmNoSGl0W10gPSB0aGlzLnNlcnZpY2Uuc2VhcmNoTmFtZXMocXVlcnkudGV4dCwgZmlsZXMpLm1hcCgoZmlsZSkgPT4gKHtcbiAgICAgIHBhdGg6IGZpbGUucGF0aCxcbiAgICAgIG5hbWU6IGZpbGUubmFtZSxcbiAgICAgIGxvY2F0aW9uOiBmaWxlLnJlbGF0aXZlUGF0aCA/PyAnZXh0ZXJuYWwnLFxuICAgICAgc291cmNlOiAnbmFtZScsXG4gICAgICBleGNlcnB0OlxuICAgICAgICBmaWxlLnJlbGF0aXZlUGF0aCAmJiBmaWxlLnJlbGF0aXZlUGF0aCAhPT0gZmlsZS5uYW1lXG4gICAgICAgICAgPyBmaWxlLnJlbGF0aXZlUGF0aFxuICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgIH0pKTtcblxuICAgIGlmIChxdWVyeS5uYW1lT25seSkge1xuICAgICAgcmV0dXJuIHsgcHJvdmlkZXJJZDogdGhpcy5pZCwgbGFiZWw6IHRoaXMubGFiZWwsIGhpdHM6IG5hbWVIaXRzIH07XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5zZXJ2aWNlLmVuc3VyZUluZGV4KCk7XG4gICAgY29uc3QgY29udGVudEhpdHMgPSBhd2FpdCB0aGlzLnNlcnZpY2Uuc2VhcmNoQ29udGVudChxdWVyeS50ZXh0LCBmaWxlcywgcXVlcnkudG9rZW4pO1xuICAgIGNvbnN0IGhpdHM6IFNlYXJjaEhpdFtdID0gWy4uLm5hbWVIaXRzXTtcblxuICAgIGZvciAoY29uc3QgaGl0IG9mIGNvbnRlbnRIaXRzKSB7XG4gICAgICBpZiAocXVlcnkudG9rZW4uaXNDYW5jZWxsYXRpb25SZXF1ZXN0ZWQpIHtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgICBmb3IgKGNvbnN0IG1hdGNoIG9mIGhpdC5tYXRjaGVzLnNsaWNlKDAsIDUpKSB7XG4gICAgICAgIGhpdHMucHVzaCh7XG4gICAgICAgICAgcGF0aDogaGl0LmZpbGUucGF0aCxcbiAgICAgICAgICBuYW1lOiBoaXQuZmlsZS5uYW1lLFxuICAgICAgICAgIGxvY2F0aW9uOiBgUGFnZSAke21hdGNoLnBhZ2V9YCxcbiAgICAgICAgICBleGNlcnB0OiBtYXRjaC5leGNlcnB0LFxuICAgICAgICAgIG1hdGNoTGVuZ3RoOiBtYXRjaC5sZW5ndGgsXG4gICAgICAgICAgc291cmNlOiAnY29udGVudCcsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgaWYgKGhpdC5tYXRjaGVzLmxlbmd0aCA+IDUpIHtcbiAgICAgICAgaGl0cy5wdXNoKHtcbiAgICAgICAgICBwYXRoOiBoaXQuZmlsZS5wYXRoLFxuICAgICAgICAgIG5hbWU6IGhpdC5maWxlLm5hbWUsXG4gICAgICAgICAgbG9jYXRpb246IGAke2hpdC5tYXRjaENvdW50IC0gNX0gbW9yZSBtYXRjaGVzYCxcbiAgICAgICAgICBleGNlcnB0OiBgT3BlbiB0byBzZWUgdGhlIHJlbWFpbmluZyBtYXRjaGVzIGluICR7aGl0LmZpbGUubmFtZX1gLFxuICAgICAgICAgIHNvdXJjZTogJ2NvbnRlbnQnLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBub3RlID0gdGhpcy5zZXJ2aWNlLmlzSW5kZXhlZCgpID8gdW5kZWZpbmVkIDogJ0NvbnRlbnQgaW5kZXggc3RpbGwgd2FybWluZyB1cCc7XG4gICAgcmV0dXJuIHsgcHJvdmlkZXJJZDogdGhpcy5pZCwgbGFiZWw6IHRoaXMubGFiZWwsIGhpdHMsIG5vdGUgfTtcbiAgfVxufVxuIiwgImltcG9ydCB0eXBlIHsgU2VjdGlvblByb3ZpZGVyLCBTZWN0aW9uU25hcHNob3QgfSBmcm9tICcuLi90eXBlcy50cyc7XG5pbXBvcnQgdHlwZSB7IFN0b3JlIH0gZnJvbSAnLi4vLi4vc3RvcmUudHMnO1xuaW1wb3J0IHR5cGUgeyBGaWxlUmVmIH0gZnJvbSAnLi4vLi4vdHlwZXMudHMnO1xuXG4vKipcbiAqIFwiVG9wIGZpbGVzXCIgc2VjdGlvbjogdGhlIGZpbGVzIHlvdSBvcGVuIHRoZSBtb3N0IGluIHRoaXMgcHJvamVjdC5cbiAqIFJhbmtpbmcgc3RyYXRlZ3kgY29tZXMgZnJvbSBgcGRmSHViLnJlY2VudC5yYW5raW5nYC5cbiAqL1xuZXhwb3J0IGNsYXNzIFJlY2VudEZpbGVzUHJvdmlkZXIgaW1wbGVtZW50cyBTZWN0aW9uUHJvdmlkZXIge1xuICByZWFkb25seSBpZCA9ICdyZWNlbnQnO1xuICByZWFkb25seSBsYWJlbCA9ICdUb3AgZmlsZXMnO1xuICByZWFkb25seSBvcmRlciA9IDEwO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgcmVhZG9ubHkgc3RvcmU6IFN0b3JlLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgd29ya3NwYWNlRmlsZXM6ICgpID0+IEZpbGVSZWZbXVxuICApIHt9XG5cbiAgYXN5bmMgZ2V0U2VjdGlvbnMoKTogUHJvbWlzZTxTZWN0aW9uU25hcHNob3RbXT4ge1xuICAgIGNvbnN0IHRvcCA9IHRoaXMuc3RvcmUuZ2V0VG9wRmlsZXModHJ1ZSk7XG4gICAgY29uc3QgbmFtZXMgPSBuZXcgTWFwKHRoaXMud29ya3NwYWNlRmlsZXMoKS5tYXAoKGYpID0+IFtmLnBhdGgucmVwbGFjZSgvXFxcXC9nLCAnLycpLnRvTG93ZXJDYXNlKCksIGZdKSk7XG4gICAgcmV0dXJuIFtcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdyZWNlbnQnLFxuICAgICAgICB0aXRsZTogJ01vc3Qgb3BlbmVkIGluIHRoaXMgcHJvamVjdCcsXG4gICAgICAgIGl0ZW1zOiB0b3AubWFwKChzdGF0KSA9PiB7XG4gICAgICAgICAgY29uc3Qga2V5ID0gc3RhdC5wYXRoLnJlcGxhY2UoL1xcXFwvZywgJy8nKS50b0xvd2VyQ2FzZSgpO1xuICAgICAgICAgIGNvbnN0IGtub3duID0gbmFtZXMuZ2V0KGtleSk7XG4gICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgIGtpbmQ6ICdmaWxlJyBhcyBjb25zdCxcbiAgICAgICAgICAgIGZpbGU6IGtub3duID8/IHtcbiAgICAgICAgICAgICAgcGF0aDogc3RhdC5wYXRoLFxuICAgICAgICAgICAgICBuYW1lOiBzdGF0Lm5hbWUsXG4gICAgICAgICAgICAgIHJlbGF0aXZlUGF0aDogc3RhdC5yZWxhdGl2ZVBhdGgsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgZGV0YWlsOiBgJHtzdGF0LmNvdW50fVx1MDBEN2AsXG4gICAgICAgICAgfTtcbiAgICAgICAgfSksXG4gICAgICAgIGhpbnQ6IHRvcC5sZW5ndGggPyB1bmRlZmluZWQgOiAnT3BlbiBzb21lIGZpbGVzIGFuZCB0aGV5IHdpbGwgc2hvdyB1cCBoZXJlLicsXG4gICAgICB9LFxuICAgIF07XG4gIH1cbn1cbiIsICJpbXBvcnQgdHlwZSB7IFNlY3Rpb25Qcm92aWRlciwgU2VjdGlvblNuYXBzaG90IH0gZnJvbSAnLi4vdHlwZXMudHMnO1xuaW1wb3J0IHR5cGUgeyBTdG9yZSB9IGZyb20gJy4uLy4uL3N0b3JlLnRzJztcblxuLyoqXG4gKiBGYXZvcml0ZXMsIGdyb3VwZWQgYnkgdXNlci1uYW1lZCBncm91cHMgKGUuZy4gXCJQeXRob25cIiwgXCJKYXZhXCIpLlxuICogR3JvdXBzIGFyZSBmbGF0IGJ5IGRlc2lnbjogYSBmaWxlIGJlbG9uZ3MgdG8gZXhhY3RseSBvbmUgZ3JvdXAuXG4gKi9cbmV4cG9ydCBjbGFzcyBGYXZvcml0ZXNQcm92aWRlciBpbXBsZW1lbnRzIFNlY3Rpb25Qcm92aWRlciB7XG4gIHJlYWRvbmx5IGlkID0gJ2Zhdm9yaXRlcyc7XG4gIHJlYWRvbmx5IGxhYmVsID0gJ0Zhdm9yaXRlcyc7XG4gIHJlYWRvbmx5IG9yZGVyID0gMjA7XG5cbiAgcHJpdmF0ZSByZWFkb25seSBzdG9yZTogU3RvcmU7XG5cbiAgY29uc3RydWN0b3Ioc3RvcmU6IFN0b3JlKSB7XG4gICAgdGhpcy5zdG9yZSA9IHN0b3JlO1xuICB9XG5cbiAgYXN5bmMgZ2V0U2VjdGlvbnMoKTogUHJvbWlzZTxTZWN0aW9uU25hcHNob3RbXT4ge1xuICAgIGNvbnN0IGdyb3VwcyA9IHRoaXMuc3RvcmUuZ2V0R3JvdXBzKCk7XG4gICAgcmV0dXJuIFtcbiAgICAgIHtcbiAgICAgICAgaWQ6ICdmYXZvcml0ZXMnLFxuICAgICAgICB0aXRsZTogJ0Zhdm9yaXRlIGZpbGVzJyxcbiAgICAgICAgZ3JvdXBzOiBncm91cHMubWFwKChncm91cCkgPT4gKHtcbiAgICAgICAgICBpZDogZ3JvdXAuaWQsXG4gICAgICAgICAgdGl0bGU6IGdyb3VwLm5hbWUsXG4gICAgICAgICAgaXRlbXM6IGdyb3VwLmZpbGVzLm1hcCgoZmlsZSkgPT4gKHsga2luZDogJ2ZpbGUnIGFzIGNvbnN0LCBmaWxlLCBncm91cElkOiBncm91cC5pZCB9KSksXG4gICAgICAgIH0pKSxcbiAgICAgICAgaGludDogZ3JvdXBzLmxlbmd0aFxuICAgICAgICAgID8gdW5kZWZpbmVkXG4gICAgICAgICAgOiAnUmlnaHQtY2xpY2sgYSBmaWxlIGluIHRoZSBFeHBsb3JlciBhbmQgY2hvb3NlIFwiQWRkIHRvIEZhdm9yaXRlc1wiLicsXG4gICAgICB9LFxuICAgIF07XG4gIH1cbn1cbiIsICJpbXBvcnQgdHlwZSB7IFNlY3Rpb25Qcm92aWRlciwgU2VjdGlvblNuYXBzaG90IH0gZnJvbSAnLi4vdHlwZXMudHMnO1xuaW1wb3J0IHR5cGUgeyBTdG9yZSB9IGZyb20gJy4uLy4uL3N0b3JlLnRzJztcblxuLyoqIEZhdm9yaXRlcyB0aGF0IGxpdmUgb3V0c2lkZSBldmVyeSB3b3Jrc3BhY2UgZm9sZGVyLiBIYXJkIGNhcHBlZCBhdCAxMC4gKi9cbmV4cG9ydCBjbGFzcyBFeHRlcm5hbEZpbGVzUHJvdmlkZXIgaW1wbGVtZW50cyBTZWN0aW9uUHJvdmlkZXIge1xuICByZWFkb25seSBpZCA9ICdleHRlcm5hbCc7XG4gIHJlYWRvbmx5IGxhYmVsID0gJ091dHNpZGUgdGhlIHByb2plY3QnO1xuICByZWFkb25seSBvcmRlciA9IDMwO1xuXG4gIHByaXZhdGUgcmVhZG9ubHkgc3RvcmU6IFN0b3JlO1xuXG4gIGNvbnN0cnVjdG9yKHN0b3JlOiBTdG9yZSkge1xuICAgIHRoaXMuc3RvcmUgPSBzdG9yZTtcbiAgfVxuXG4gIGFzeW5jIGdldFNlY3Rpb25zKCk6IFByb21pc2U8U2VjdGlvblNuYXBzaG90W10+IHtcbiAgICBjb25zdCBmaWxlcyA9IHRoaXMuc3RvcmUuZ2V0RXh0ZXJuYWwoKTtcbiAgICBjb25zdCBtYXggPSB0aGlzLnN0b3JlLmV4dGVybmFsTWF4O1xuICAgIGNvbnN0IHNob3RzOiBTZWN0aW9uU25hcHNob3RbXSA9IFtdO1xuICAgIC8vIE9ubHkgdGFrZSB1cCBzaWRlYmFyIHNwYWNlIG9uY2UgdGhlIHVzZXIgYWN0dWFsbHkgaGFzIGV4dGVybmFsIGZhdm9yaXRlcy5cbiAgICBpZiAoZmlsZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICByZXR1cm4gc2hvdHM7XG4gICAgfVxuICAgIHNob3RzLnB1c2goe1xuICAgICAgaWQ6ICdleHRlcm5hbCcsXG4gICAgICB0aXRsZTogJ0Zhdm9yaXRlcyBvdXRzaWRlIHRoZSBwcm9qZWN0JyxcbiAgICAgIGl0ZW1zOiBmaWxlcy5tYXAoKGZpbGUpID0+ICh7IGtpbmQ6ICdmaWxlJyBhcyBjb25zdCwgZmlsZSB9KSksXG4gICAgICBoaW50OiBgJHtmaWxlcy5sZW5ndGh9LyR7bWF4fSB1c2VkIFx1MjAxNCAke21heCAtIGZpbGVzLmxlbmd0aH0gc2xvdChzKSBsZWZ0YCxcbiAgICB9KTtcbiAgICByZXR1cm4gc2hvdHM7XG4gIH1cbn1cbiIsICJpbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzL3Byb21pc2VzJztcbmltcG9ydCB0eXBlIHsgU2VjdGlvbkl0ZW0sIFNlY3Rpb25Qcm92aWRlciwgU2VjdGlvblNuYXBzaG90IH0gZnJvbSAnLi4vdHlwZXMudHMnO1xuaW1wb3J0IHtcbiAgZGVzY3JpYmVSdWxlLFxuICBmaWx0ZXJCeVJ1bGUsXG4gIHZhbGlkYXRlUnVsZSxcbiAgdHlwZSBSdWxlQ2FuZGlkYXRlLFxuICB0eXBlIFNtYXJ0UnVsZSxcbn0gZnJvbSAnLi4vLi4vc2VhcmNoL3NtYXJ0UnVsZXMudHMnO1xuaW1wb3J0IHsgdHlwZSBGaWxlUmVmIH0gZnJvbSAnLi4vLi4vdHlwZXMudHMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIFNtYXJ0R3JvdXBNYXRjaCBleHRlbmRzIEZpbGVSZWYge1xuICBtYXRjaGVkQnk6IHN0cmluZztcbn1cblxuLyoqXG4gKiBUaGUgcHJvdmlkZXIgb25seSBuZWVkcyB0byByZWFkIHJ1bGVzLCBzbyBpdCBkZXBlbmRzIG9uIHRoaXMgbmFycm93IGludGVyZmFjZVxuICogcmF0aGVyIHRoYW4gdGhlIGZ1bGwgc3RvcmUuIEJvdGggYFN0b3JlQ29yZWAgYW5kIGl0cyBWUyBDb2RlIGFkYXB0ZXIgc2F0aXNmeVxuICogaXQsIHdoaWNoIGtlZXBzIHRoZSBwcm92aWRlciB1bml0IHRlc3RhYmxlLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFNtYXJ0UnVsZVNvdXJjZSB7XG4gIGdldFNtYXJ0R3JvdXBzKCk6IFNtYXJ0UnVsZVtdO1xuICBnZXRTbWFydEdyb3VwKGlkOiBzdHJpbmcpOiBTbWFydFJ1bGUgfCB1bmRlZmluZWQ7XG4gIHVwZGF0ZVNtYXJ0R3JvdXAoaWQ6IHN0cmluZywgcGF0Y2g6IFBhcnRpYWw8U21hcnRSdWxlPik6IFNtYXJ0UnVsZSB8IHVuZGVmaW5lZDtcbn1cblxuLyoqXG4gKiBTbWFydCBncm91cHM6IGxpdmUgY29sbGVjdGlvbnMgZHJpdmVuIGJ5IHJ1bGVzIGluc3RlYWQgb2YgYnkgaGFuZC5cbiAqXG4gKiBBIHJ1bGUgaXMgZXZhbHVhdGVkIGFnYWluc3QgdGhlIGZpbGVzIHRoZSBjYWxsZXIgc3VwcGxpZXMsIHNvIHRoZSBwcm92aWRlclxuICogc3RheXMgZnJlZSBvZiBWUyBDb2RlIEFQSXMgYW5kIHdvcmtzIGZvciBhbnkgZmlsZSB0eXBlIFx1MjAxNCBub3QganVzdCBQREZzLlxuICovXG5leHBvcnQgY2xhc3MgU21hcnRHcm91cHNQcm92aWRlciBpbXBsZW1lbnRzIFNlY3Rpb25Qcm92aWRlciB7XG4gIHJlYWRvbmx5IGlkID0gJ3NtYXJ0JztcbiAgcmVhZG9ubHkgbGFiZWwgPSAnU21hcnQgZ3JvdXBzJztcbiAgcmVhZG9ubHkgb3JkZXIgPSAxNTtcblxuICBwcml2YXRlIHJlYWRvbmx5IHN0b3JlOiBTbWFydFJ1bGVTb3VyY2U7XG4gIHByaXZhdGUgcmVhZG9ubHkgY2FuZGlkYXRlczogKCkgPT4gRmlsZVJlZltdO1xuICBwcml2YXRlIHJlYWRvbmx5IG9wdGlvbnM6IHtcbiAgICBub3c/OiAoKSA9PiBudW1iZXI7XG4gICAgc3RhdEZpbGU/OiAocGF0aDogc3RyaW5nKSA9PiBQcm9taXNlPHsgc2l6ZUJ5dGVzOiBudW1iZXI7IG1vZGlmaWVkTXM6IG51bWJlciB9IHwgdW5kZWZpbmVkPjtcbiAgfTtcblxuICBjb25zdHJ1Y3RvcihcbiAgICBzdG9yZTogU21hcnRSdWxlU291cmNlLFxuICAgIGNhbmRpZGF0ZXM6ICgpID0+IEZpbGVSZWZbXSxcbiAgICBvcHRpb25zOiB7XG4gICAgICBub3c/OiAoKSA9PiBudW1iZXI7XG4gICAgICBzdGF0RmlsZT86IChwYXRoOiBzdHJpbmcpID0+IFByb21pc2U8eyBzaXplQnl0ZXM6IG51bWJlcjsgbW9kaWZpZWRNczogbnVtYmVyIH0gfCB1bmRlZmluZWQ+O1xuICAgIH0gPSB7fVxuICApIHtcbiAgICB0aGlzLnN0b3JlID0gc3RvcmU7XG4gICAgdGhpcy5jYW5kaWRhdGVzID0gY2FuZGlkYXRlcztcbiAgICB0aGlzLm9wdGlvbnMgPSBvcHRpb25zO1xuICB9XG5cbiAgYXN5bmMgZ2V0U2VjdGlvbnMoKTogUHJvbWlzZTxTZWN0aW9uU25hcHNob3RbXT4ge1xuICAgIGNvbnN0IHJ1bGVzID0gdGhpcy5zdG9yZS5nZXRTbWFydEdyb3VwcygpO1xuICAgIGlmICghcnVsZXMubGVuZ3RoKSB7XG4gICAgICByZXR1cm4gW107XG4gICAgfVxuXG4gICAgY29uc3QgZmlsZXMgPSB0aGlzLmNhbmRpZGF0ZXMoKTtcbiAgICBjb25zdCBtZXRhZGF0YSA9IGF3YWl0IHRoaXMuY29sbGVjdE1ldGFkYXRhKGZpbGVzKTtcbiAgICBjb25zdCBub3cgPSB0aGlzLm9wdGlvbnMubm93Py4oKSA/PyBEYXRlLm5vdygpO1xuXG4gICAgY29uc3QgZ3JvdXBzID0gcnVsZXNcbiAgICAgIC5maWx0ZXIoKHJ1bGUpID0+IHJ1bGUuZW5hYmxlZClcbiAgICAgIC5tYXAoKHJ1bGUpID0+IHtcbiAgICAgICAgY29uc3QgY2FuZGlkYXRlczogUnVsZUNhbmRpZGF0ZVtdID0gZmlsZXMubWFwKChmaWxlKSA9PiAoe1xuICAgICAgICAgIHJlbGF0aXZlUGF0aDogZmlsZS5yZWxhdGl2ZVBhdGggPz8gZmlsZS5uYW1lLFxuICAgICAgICAgIG5hbWU6IGZpbGUubmFtZSxcbiAgICAgICAgICBzaXplQnl0ZXM6IG1ldGFkYXRhLmdldChmaWxlLnBhdGgpPy5zaXplQnl0ZXMsXG4gICAgICAgICAgbW9kaWZpZWRNczogbWV0YWRhdGEuZ2V0KGZpbGUucGF0aCk/Lm1vZGlmaWVkTXMsXG4gICAgICAgIH0pKTtcblxuICAgICAgICBjb25zdCBtYXRjaGVkRmlsZXMgPSBmaWxlcy5maWx0ZXIoKF8sIGluZGV4KSA9PlxuICAgICAgICAgIGZpbHRlckJ5UnVsZShydWxlLCBbY2FuZGlkYXRlc1tpbmRleF1dLCBub3cpLmxlbmd0aCA+IDBcbiAgICAgICAgKTtcblxuICAgICAgICBjb25zdCBpbnZhbGlkID0gdmFsaWRhdGVSdWxlKHJ1bGUpO1xuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGlkOiBydWxlLmlkLFxuICAgICAgICAgIHRpdGxlOiBydWxlLm5hbWUsXG4gICAgICAgICAgaXRlbXM6IG1hdGNoZWRGaWxlcy5tYXAoKGZpbGUpOiBTZWN0aW9uSXRlbSA9PiAoeyBraW5kOiAnZmlsZScgYXMgY29uc3QsIGZpbGUgfSkpLFxuICAgICAgICAgIGhpbnQ6XG4gICAgICAgICAgICBpbnZhbGlkLmxlbmd0aCA+IDBcbiAgICAgICAgICAgICAgPyBgUnVsZSBuZWVkcyBhdHRlbnRpb246ICR7aW52YWxpZFswXX1gXG4gICAgICAgICAgICAgIDogZGVzY3JpYmVSdWxlKHJ1bGUpLFxuICAgICAgICAgIHJ1bGVzOiBbcnVsZV0sXG4gICAgICAgIH07XG4gICAgICB9KTtcblxuICAgIHJldHVybiBbXG4gICAgICB7XG4gICAgICAgIGlkOiAnc21hcnQnLFxuICAgICAgICB0aXRsZTogJ1NtYXJ0IGdyb3VwcycsXG4gICAgICAgIGdyb3VwczogZ3JvdXBzLm1hcCgoZ3JvdXApID0+ICh7XG4gICAgICAgICAgaWQ6IGdyb3VwLmlkLFxuICAgICAgICAgIHRpdGxlOiBncm91cC50aXRsZSxcbiAgICAgICAgICBpdGVtczogZ3JvdXAuaXRlbXMsXG4gICAgICAgICAgaGludDogZ3JvdXAuaGludCxcbiAgICAgICAgfSkpLFxuICAgICAgICBoaW50OiBncm91cHMubGVuZ3RoID8gdW5kZWZpbmVkIDogJ0FkZCBhIHNtYXJ0IGdyb3VwIHRvIGF1dG8tY29sbGVjdCBmaWxlcyBieSBwYXR0ZXJuLicsXG4gICAgICB9LFxuICAgIF07XG4gIH1cblxuICAvKiogUmVhZHMgc2l6ZXMgYW5kIG1vZGlmaWNhdGlvbiB0aW1lcyBvbmNlIHBlciBkaXN0aW5jdCBmaWxlLiAqL1xuICBwcml2YXRlIGFzeW5jIGNvbGxlY3RNZXRhZGF0YShmaWxlczogRmlsZVJlZltdKTogUHJvbWlzZTxNYXA8c3RyaW5nLCB7IHNpemVCeXRlczogbnVtYmVyOyBtb2RpZmllZE1zOiBudW1iZXIgfT4+IHtcbiAgICBjb25zdCBtZXRhZGF0YSA9IG5ldyBNYXA8c3RyaW5nLCB7IHNpemVCeXRlczogbnVtYmVyOyBtb2RpZmllZE1zOiBudW1iZXIgfT4oKTtcbiAgICBjb25zdCBzdGF0RmlsZSA9XG4gICAgICB0aGlzLm9wdGlvbnMuc3RhdEZpbGUgPz9cbiAgICAgIChhc3luYyAocGF0aDogc3RyaW5nKSA9PiB7XG4gICAgICAgIGNvbnN0IHN0YXRzID0gYXdhaXQgZnMuc3RhdChwYXRoKS5jYXRjaCgoKSA9PiB1bmRlZmluZWQpO1xuICAgICAgICByZXR1cm4gc3RhdHMgPyB7IHNpemVCeXRlczogc3RhdHMuc2l6ZSwgbW9kaWZpZWRNczogc3RhdHMubXRpbWVNcyB9IDogdW5kZWZpbmVkO1xuICAgICAgfSk7XG5cbiAgICAvLyBCb3VuZGVkIHBhcmFsbGVsaXNtOiBhIHJ1bGUgd2l0aCBhIHNpemUgZmlsdGVyIG5lZWRzIG1ldGFkYXRhIGZvciBldmVyeVxuICAgIC8vIGNhbmRpZGF0ZSwgYnV0IHdlIHNob3VsZCBub3Qgb3BlbiB0aG91c2FuZHMgb2YgZGVzY3JpcHRvcnMgYXQgb25jZS5cbiAgICBjb25zdCBxdWV1ZSA9IFsuLi5maWxlc107XG4gICAgY29uc3Qgd29ya2VycyA9IEFycmF5LmZyb20oeyBsZW5ndGg6IE1hdGgubWluKDE2LCBxdWV1ZS5sZW5ndGgpIH0sIGFzeW5jICgpID0+IHtcbiAgICAgIGZvciAoOzspIHtcbiAgICAgICAgY29uc3QgZmlsZSA9IHF1ZXVlLnBvcCgpO1xuICAgICAgICBpZiAoIWZpbGUpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29uc3Qgc3RhdHMgPSBhd2FpdCBzdGF0RmlsZShmaWxlLnBhdGgpO1xuICAgICAgICBpZiAoc3RhdHMpIHtcbiAgICAgICAgICBtZXRhZGF0YS5zZXQoZmlsZS5wYXRoLCBzdGF0cyk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcbiAgICBhd2FpdCBQcm9taXNlLmFsbCh3b3JrZXJzKTtcbiAgICByZXR1cm4gbWV0YWRhdGE7XG4gIH1cbn1cbiIsICIvKipcbiAqIFB1cmUgZ2xvYiBtYXRjaGluZyBmb3Igc21hcnQtZ3JvdXAgcnVsZXMuXG4gKlxuICogU2VtYW50aWNzIChjaG9zZW4gdG8gbWF0Y2ggd2hhdCBwZW9wbGUgZXhwZWN0IGZyb20gYW4gZWRpdG9yIHNlYXJjaCBib3gpOlxuICogICAtIGAqYCAgbWF0Y2hlcyBhbnkgcnVuIG9mIGNoYXJhY3RlcnMsIGJ1dCBuZXZlciBgL2BcbiAqICAgLSBgKipgIG1hdGNoZXMgYWNyb3NzIHBhdGggc2VwYXJhdG9ycyB3aGVuIGl0IHN0YXJ0cyBhIHBhdGggc2VnbWVudFxuICogICAtIGAqKmAgYXMgaXRzIG93biBzZWdtZW50IGFsc28gbWF0Y2hlcyB6ZXJvIHNlZ21lbnRzLCBzbyBgKipgICsgYC9hLnBkZmBcbiAqICAgICBtYXRjaGVzIGEgdG9wLWxldmVsIGBhLnBkZmAgYW5kIGBkb2NzL2EucGRmYFxuICogICAtIGEgdHJhaWxpbmcgYCoqYCBtYXRjaGVzIHRoZSB3aG9sZSByZW1haW5pbmcgc3VidHJlZVxuICogICAtIGA/YCAgbWF0Y2hlcyBhIHNpbmdsZSBjaGFyYWN0ZXIgZXhjZXB0IGAvYFxuICogICAtIGBbYWJjXWAsIGBbYS16XWAsIGBbIWFiY11gIGFyZSBjaGFyYWN0ZXIgY2xhc3Nlc1xuICogICAtIGB7YSxifWAgZXhwYW5kcyB0byBhbHRlcm5hdGl2ZXNcbiAqXG4gKiBBIHBhdHRlcm4gd2l0aG91dCBgL2AgaXMgbWF0Y2hlZCBhZ2FpbnN0IHRoZSBmaWxlIG5hbWUgKmFuZCogZXZlcnkgcGF0aFxuICogc3VmZml4LCBzbyBgKi5wZGZgIG1lYW5zIFwic29tZXdoZXJlIGluIHRoZSBwcm9qZWN0XCIgcmF0aGVyIHRoYW4gb25seSBhdCB0aGVcbiAqIHdvcmtzcGFjZSByb290LlxuICpcbiAqIFBhdHRlcm5zIGFyZSBjb21waWxlZCB0byByZWd1bGFyIGV4cHJlc3Npb25zICh3aXRoIGFuIExSVSBjYWNoZSkgcmF0aGVyIHRoYW5cbiAqIG1hdGNoZWQgY2hhcmFjdGVyIGJ5IGNoYXJhY3RlcjogdXNlciBydWxlcyBhcmUgZXZhbHVhdGVkIGFnYWluc3QgZXZlcnkgZmlsZVxuICogaW4gdGhlIHByb2plY3QsIHNvIG1hdGNoaW5nIGhhcyB0byBzdGF5IGxpbmVhci5cbiAqXG4gKiBObyBgdnNjb2RlYCBpbXBvcnQ6IHRoaXMgaXMgdW5pdCB0ZXN0ZWQgZGlyZWN0bHkuXG4gKi9cblxuLyoqIE5vcm1hbGl6ZXMgYSBwYXRoIGZvciBtYXRjaGluZzogZm9yd2FyZCBzbGFzaGVzLCBubyBsZWFkaW5nIGAuL2AuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplUGF0aCh2YWx1ZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHZhbHVlXG4gICAgLnJlcGxhY2UoL1xcXFwvZywgJy8nKVxuICAgIC5yZXBsYWNlKC9eXFwuXFwvLywgJycpXG4gICAgLnJlcGxhY2UoL1xcL3syLH0vZywgJy8nKTtcbn1cblxuLyoqIEV4cGFuZHMgYHthLGJ9YCBncm91cHMgaW50byBzZXBhcmF0ZSBwYXR0ZXJucy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBleHBhbmRCcmFjZXMocGF0dGVybjogc3RyaW5nKTogc3RyaW5nW10ge1xuICBjb25zdCBvcGVuID0gcGF0dGVybi5pbmRleE9mKCd7Jyk7XG4gIGlmIChvcGVuID09PSAtMSkge1xuICAgIHJldHVybiBbcGF0dGVybl07XG4gIH1cbiAgbGV0IGRlcHRoID0gMDtcbiAgbGV0IGNsb3NlID0gLTE7XG4gIGZvciAobGV0IGkgPSBvcGVuOyBpIDwgcGF0dGVybi5sZW5ndGg7IGkgKz0gMSkge1xuICAgIGNvbnN0IGNoYXIgPSBwYXR0ZXJuW2ldO1xuICAgIGlmIChjaGFyID09PSAneycpIHtcbiAgICAgIGRlcHRoICs9IDE7XG4gICAgfSBlbHNlIGlmIChjaGFyID09PSAnfScpIHtcbiAgICAgIGRlcHRoIC09IDE7XG4gICAgICBpZiAoZGVwdGggPT09IDApIHtcbiAgICAgICAgY2xvc2UgPSBpO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgaWYgKGNsb3NlID09PSAtMSkge1xuICAgIHJldHVybiBbcGF0dGVybl07XG4gIH1cbiAgY29uc3QgcHJlZml4ID0gcGF0dGVybi5zbGljZSgwLCBvcGVuKTtcbiAgY29uc3QgYm9keSA9IHBhdHRlcm4uc2xpY2Uob3BlbiArIDEsIGNsb3NlKTtcbiAgY29uc3Qgc3VmZml4ID0gcGF0dGVybi5zbGljZShjbG9zZSArIDEpO1xuXG4gIGNvbnN0IG9wdGlvbnM6IHN0cmluZ1tdID0gW107XG4gIGxldCBjdXJyZW50ID0gJyc7XG4gIGxldCBuZXN0aW5nID0gMDtcbiAgZm9yIChjb25zdCBjaGFyIG9mIGJvZHkpIHtcbiAgICBpZiAoY2hhciA9PT0gJ3snKSB7XG4gICAgICBuZXN0aW5nICs9IDE7XG4gICAgfSBlbHNlIGlmIChjaGFyID09PSAnfScpIHtcbiAgICAgIG5lc3RpbmcgLT0gMTtcbiAgICB9XG4gICAgaWYgKGNoYXIgPT09ICcsJyAmJiBuZXN0aW5nID09PSAwKSB7XG4gICAgICBvcHRpb25zLnB1c2goY3VycmVudCk7XG4gICAgICBjdXJyZW50ID0gJyc7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY3VycmVudCArPSBjaGFyO1xuICB9XG4gIG9wdGlvbnMucHVzaChjdXJyZW50KTtcblxuICByZXR1cm4gb3B0aW9ucy5mbGF0TWFwKChvcHRpb24pID0+IGV4cGFuZEJyYWNlcyhgJHtwcmVmaXh9JHtvcHRpb259JHtzdWZmaXh9YCkpO1xufVxuXG4vKipcbiAqIENvbnZlcnRzIG9uZSBicmFjZS1mcmVlIGdsb2IgaW50byBhIHJlZ3VsYXIgZXhwcmVzc2lvbiBzb3VyY2Ugc3RyaW5nLlxuICpcbiAqIGAqKmAgaXMgb25seSBzcGVjaWFsIHdoZW4gaXQgYmVnaW5zIGEgcGF0aCBzZWdtZW50IChzdGFydCBvZiBwYXR0ZXJuIG9yIHJpZ2h0XG4gKiBhZnRlciBgL2ApOyBhbnl3aGVyZSBlbHNlIGl0IGJlaGF2ZXMgbGlrZSBgKmAsIHdoaWNoIGtlZXBzIHBhdHRlcm5zIHN1Y2ggYXNcbiAqIGBhL3gqKnlgIGZyb20gc2lsZW50bHkgbWF0Y2hpbmcgYWNyb3NzIGRpcmVjdG9yaWVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZ2xvYlRvUmVnRXhwU291cmNlKHBhdHRlcm46IHN0cmluZyk6IHN0cmluZyB7XG4gIGxldCBzb3VyY2UgPSAnJztcbiAgbGV0IGkgPSAwO1xuICB3aGlsZSAoaSA8IHBhdHRlcm4ubGVuZ3RoKSB7XG4gICAgY29uc3QgY2hhciA9IHBhdHRlcm5baV07XG5cbiAgICBpZiAoY2hhciA9PT0gJyonICYmIHBhdHRlcm5baSArIDFdID09PSAnKicgJiYgKGkgPT09IDAgfHwgcGF0dGVybltpIC0gMV0gPT09ICcvJykpIHtcbiAgICAgIGlmIChwYXR0ZXJuW2kgKyAyXSA9PT0gJy8nKSB7XG4gICAgICAgIC8vIE9uZSBvciBtb3JlIHdob2xlIHBhdGggc2VnbWVudHMuXG4gICAgICAgIHNvdXJjZSArPSAnKD86W14vXSsvKSonO1xuICAgICAgICBpICs9IDM7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgLy8gVHJhaWxpbmcgYCoqYCAob3IgYCoqYCBiZWZvcmUgbW9yZSB0ZXh0KSBzcGFucyBkaXJlY3Rvcmllcy5cbiAgICAgIHNvdXJjZSArPSAnLionO1xuICAgICAgaSArPSAyO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgaWYgKGNoYXIgPT09ICcqJykge1xuICAgICAgc291cmNlICs9ICdbXi9dKic7XG4gICAgICBpICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGNoYXIgPT09ICc/Jykge1xuICAgICAgc291cmNlICs9ICdbXi9dJztcbiAgICAgIGkgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoY2hhciA9PT0gJ1snKSB7XG4gICAgICBjb25zdCBjbG9zZSA9IHBhdHRlcm4uaW5kZXhPZignXScsIGkgKyAxKTtcbiAgICAgIGlmIChjbG9zZSA9PT0gLTEpIHtcbiAgICAgICAgc291cmNlICs9ICdcXFxcWyc7XG4gICAgICAgIGkgKz0gMTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBsZXQgYm9keSA9IHBhdHRlcm4uc2xpY2UoaSArIDEsIGNsb3NlKTtcbiAgICAgIGxldCBuZWdhdGVkID0gZmFsc2U7XG4gICAgICBpZiAoYm9keS5zdGFydHNXaXRoKCchJykgfHwgYm9keS5zdGFydHNXaXRoKCdeJykpIHtcbiAgICAgICAgbmVnYXRlZCA9IHRydWU7XG4gICAgICAgIGJvZHkgPSBib2R5LnNsaWNlKDEpO1xuICAgICAgfVxuICAgICAgY29uc3QgZXNjYXBlZCA9IGJvZHkucmVwbGFjZSgvXFxcXC9nLCAnXFxcXFxcXFwnKS5yZXBsYWNlKC9cXF0vZywgJ1xcXFxdJyk7XG4gICAgICBzb3VyY2UgKz0gYFske25lZ2F0ZWQgPyAnXicgOiAnJ30ke2VzY2FwZWR9XWA7XG4gICAgICBpID0gY2xvc2UgKyAxO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgc291cmNlICs9IGNoYXIucmVwbGFjZSgvWy4rXiR7fSgpfFxcXFxbXFxdXS9nLCAnXFxcXCQmJyk7XG4gICAgaSArPSAxO1xuICB9XG4gIHJldHVybiBzb3VyY2U7XG59XG5cbmZ1bmN0aW9uIGNvbXBpbGVPbmUocGF0dGVybjogc3RyaW5nLCBpZ25vcmVDYXNlOiBib29sZWFuKTogUmVnRXhwIHtcbiAgcmV0dXJuIG5ldyBSZWdFeHAoYF4ke2dsb2JUb1JlZ0V4cFNvdXJjZShwYXR0ZXJuKX0kYCwgaWdub3JlQ2FzZSA/ICdpJyA6ICcnKTtcbn1cblxuaW50ZXJmYWNlIENvbXBpbGVkUGF0dGVybiB7XG4gIC8qKiBNYXRjaGVycyBmb3IgdGhlIHdob2xlIHJlbGF0aXZlIHBhdGguICovXG4gIGZ1bGw6IFJlZ0V4cFtdO1xuICAvKiogTWF0Y2hlcnMgZm9yIHRoZSBmaWxlIG5hbWUgYW5kIHBhdGggc3VmZml4ZXMgKHBhdHRlcm5zIHdpdGhvdXQgYC9gKS4gKi9cbiAgc3VmZml4OiBSZWdFeHBbXTtcbn1cblxuLyoqIFNtYWxsIExSVSBzbyByZXBlYXRlZCBldmFsdWF0aW9ucyBvZiB0aGUgc2FtZSBydWxlIGRvIG5vdCByZWNvbXBpbGUuICovXG5jb25zdCBDQUNIRV9MSU1JVCA9IDUxMjtcbmNvbnN0IGNvbXBpbGVkQ2FjaGUgPSBuZXcgTWFwPHN0cmluZywgQ29tcGlsZWRQYXR0ZXJuPigpO1xuXG5mdW5jdGlvbiBjb21waWxlKHBhdHRlcm46IHN0cmluZywgaWdub3JlQ2FzZTogYm9vbGVhbik6IENvbXBpbGVkUGF0dGVybiB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVQYXRoKHBhdHRlcm4pO1xuICBjb25zdCBrZXkgPSBgJHtpZ25vcmVDYXNlID8gJ2knIDogJ3MnfVxcdTAwMDAke25vcm1hbGl6ZWR9YDtcbiAgY29uc3QgY2FjaGVkID0gY29tcGlsZWRDYWNoZS5nZXQoa2V5KTtcbiAgaWYgKGNhY2hlZCkge1xuICAgIGNvbXBpbGVkQ2FjaGUuZGVsZXRlKGtleSk7IC8vIHJlZnJlc2ggTFJVIHBvc2l0aW9uXG4gICAgY29tcGlsZWRDYWNoZS5zZXQoa2V5LCBjYWNoZWQpO1xuICAgIHJldHVybiBjYWNoZWQ7XG4gIH1cblxuICBjb25zdCBleHBhbmRlZCA9IGV4cGFuZEJyYWNlcyhub3JtYWxpemVkKTtcbiAgY29uc3QgdmFsdWU6IENvbXBpbGVkUGF0dGVybiA9IHtcbiAgICBmdWxsOiBleHBhbmRlZC5tYXAoKGVudHJ5KSA9PiBjb21waWxlT25lKGVudHJ5LCBpZ25vcmVDYXNlKSksXG4gICAgc3VmZml4OiBub3JtYWxpemVkLmluY2x1ZGVzKCcvJykgPyBbXSA6IGV4cGFuZGVkLm1hcCgoZW50cnkpID0+IGNvbXBpbGVPbmUoZW50cnksIGlnbm9yZUNhc2UpKSxcbiAgfTtcblxuICBjb21waWxlZENhY2hlLnNldChrZXksIHZhbHVlKTtcbiAgaWYgKGNvbXBpbGVkQ2FjaGUuc2l6ZSA+IENBQ0hFX0xJTUlUKSB7XG4gICAgY29uc3Qgb2xkZXN0ID0gY29tcGlsZWRDYWNoZS5rZXlzKCkubmV4dCgpLnZhbHVlO1xuICAgIGlmIChvbGRlc3QgIT09IHVuZGVmaW5lZCkge1xuICAgICAgY29tcGlsZWRDYWNoZS5kZWxldGUob2xkZXN0KTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHZhbHVlO1xufVxuXG4vKiogVGVzdCBob29rOiBkcm9wcyB0aGUgY29tcGlsZWQtcGF0dGVybiBjYWNoZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjbGVhckdsb2JDYWNoZSgpOiB2b2lkIHtcbiAgY29tcGlsZWRDYWNoZS5jbGVhcigpO1xufVxuXG4vKipcbiAqIE1hdGNoZXMgYHBhdHRlcm5gIGFnYWluc3QgYSByZWxhdGl2ZSBwYXRoLlxuICpcbiAqIFBhdHRlcm5zIGNvbnRhaW5pbmcgYC9gIGFyZSBhbmNob3JlZCB0byB0aGUgd2hvbGUgcGF0aC4gUGF0dGVybnMgd2l0aG91dCBgL2BcbiAqIGFyZSBtYXRjaGVkIGFnYWluc3QgdGhlIGZpbGUgbmFtZSBhbmQgZXZlcnkgcGF0aCBzdWZmaXgsIHNvIGAqLnBkZmAgZmluZHNcbiAqIFBERnMgaW4gYW55IGZvbGRlci5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG1hdGNoZXNHbG9iKHBhdHRlcm46IHN0cmluZywgcmVsYXRpdmVQYXRoOiBzdHJpbmcsIGlnbm9yZUNhc2UgPSB0cnVlKTogYm9vbGVhbiB7XG4gIGNvbnN0IHBhdGggPSBub3JtYWxpemVQYXRoKHJlbGF0aXZlUGF0aCk7XG4gIGNvbnN0IHsgZnVsbCwgc3VmZml4IH0gPSBjb21waWxlKHBhdHRlcm4sIGlnbm9yZUNhc2UpO1xuXG4gIGZvciAoY29uc3QgbWF0Y2hlciBvZiBmdWxsKSB7XG4gICAgaWYgKG1hdGNoZXIudGVzdChwYXRoKSkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICB9XG5cbiAgaWYgKHN1ZmZpeC5sZW5ndGgpIHtcbiAgICBjb25zdCBwYXJ0cyA9IHBhdGguc3BsaXQoJy8nKTtcbiAgICBjb25zdCBuYW1lID0gcGFydHNbcGFydHMubGVuZ3RoIC0gMV07XG4gICAgZm9yIChjb25zdCBtYXRjaGVyIG9mIHN1ZmZpeCkge1xuICAgICAgaWYgKG1hdGNoZXIudGVzdChuYW1lKSkge1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgZm9yIChsZXQgaSA9IDE7IGkgPCBwYXJ0cy5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgY29uc3QgY2FuZGlkYXRlID0gcGFydHMuc2xpY2UoaSkuam9pbignLycpO1xuICAgICAgZm9yIChjb25zdCBtYXRjaGVyIG9mIHN1ZmZpeCkge1xuICAgICAgICBpZiAobWF0Y2hlci50ZXN0KGNhbmRpZGF0ZSkpIHtcbiAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKiBUcnVlIHdoZW4gdGhlIHRleHQgbG9va3MgbGlrZSBhIHVzYWJsZSByZWd1bGFyIGV4cHJlc3Npb24uICovXG5leHBvcnQgZnVuY3Rpb24gaXNWYWxpZFJlZ2V4KHNvdXJjZTogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHRyeSB7XG4gICAgbmV3IFJlZ0V4cChzb3VyY2UpO1xuICAgIHJldHVybiB0cnVlO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG1hdGNoZXNSZWdleChzb3VyY2U6IHN0cmluZywgcmVsYXRpdmVQYXRoOiBzdHJpbmcsIGlnbm9yZUNhc2UgPSB0cnVlKTogYm9vbGVhbiB7XG4gIHRyeSB7XG4gICAgY29uc3QgZmxhZ3MgPSBpZ25vcmVDYXNlID8gJ2knIDogJyc7XG4gICAgcmV0dXJuIG5ldyBSZWdFeHAoc291cmNlLCBmbGFncykudGVzdChub3JtYWxpemVQYXRoKHJlbGF0aXZlUGF0aCkpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cbiIsICIvKipcbiAqIFNtYXJ0LWdyb3VwIHJ1bGVzOiBkZWNsYXJhdGl2ZSwgcHVyZSwgYW5kIGZ1bGx5IHVuaXQgdGVzdGVkLlxuICpcbiAqIEEgcnVsZSB0dXJucyBcImV2ZXJ5IGZpbGUgbWF0Y2hpbmcgdGhpcyBkZXNjcmlwdGlvblwiIGludG8gYSBsaXZlIGNvbGxlY3Rpb24uXG4gKiBLZWVwaW5nIHRoaXMgbW9kdWxlIGZyZWUgb2YgYHZzY29kZWAgaXMgd2hhdCBtYWtlcyB0aGUgYmVoYXZpb3VyIHByb3ZhYmxlIGluXG4gKiB0ZXN0cywgaW5jbHVkaW5nIHRoZSBodW1hbi1yZWFkYWJsZSBleHBsYW5hdGlvbnMgc2hvd24gaW4gdGhlIHNpZGViYXIuXG4gKi9cbmltcG9ydCB7IG1hdGNoZXNHbG9iLCBtYXRjaGVzUmVnZXgsIG5vcm1hbGl6ZVBhdGggfSBmcm9tICcuL2dsb2IudHMnO1xuXG5leHBvcnQgdHlwZSBSdWxlTWF0Y2hNb2RlID0gJ2FsbCcgfCAnYW55JztcblxuZXhwb3J0IGludGVyZmFjZSBSdWxlQ29uZGl0aW9ucyB7XG4gIC8qKiBHbG9iIHBhdHRlcm5zOyBhIGZpbGUgbWF0Y2hlcyBpZiBpdCBtYXRjaGVzIEFOWSBvZiB0aGVtLiAqL1xuICBpbmNsdWRlR2xvYnM/OiBzdHJpbmdbXTtcbiAgLyoqIEdsb2IgcGF0dGVybnMgdGhhdCB2ZXRvIGEgbWF0Y2guICovXG4gIGV4Y2x1ZGVHbG9icz86IHN0cmluZ1tdO1xuICAvKiogUmVndWxhciBleHByZXNzaW9uIHRlc3RlZCBhZ2FpbnN0IHRoZSByZWxhdGl2ZSBwYXRoLiAqL1xuICBpbmNsdWRlUmVnZXg/OiBzdHJpbmc7XG4gIC8qKiBBbHRlcm5hdGUgcGF0dGVybnM6IG1hdGNoIGVpdGhlciB0aGUgZ2xvYnMgb3IgdGhlIHJlZ2V4LiAqL1xuICBnbG9iT3JSZWdleD86IGJvb2xlYW47XG4gIC8qKiBFeHRlbnNpb25zIHdpdGhvdXQgdGhlIGRvdCwgZS5nLiBbXCJwZGZcIiwgXCJtZFwiXS4gKi9cbiAgZXh0ZW5zaW9ucz86IHN0cmluZ1tdO1xuICAvKiogU2l6ZSB3aW5kb3cgaW4ga2lsb2J5dGVzLiAqL1xuICBtaW5TaXplS2I/OiBudW1iZXI7XG4gIG1heFNpemVLYj86IG51bWJlcjtcbiAgLyoqIFJlY2VuY3kgd2luZG93IGluIGRheXMsIGJhc2VkIG9uIG1vZGlmaWNhdGlvbiB0aW1lLiAqL1xuICBtb2RpZmllZFdpdGhpbkRheXM/OiBudW1iZXI7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgU21hcnRSdWxlIHtcbiAgaWQ6IHN0cmluZztcbiAgbmFtZTogc3RyaW5nO1xuICBkZXNjcmlwdGlvbj86IHN0cmluZztcbiAgZW5hYmxlZDogYm9vbGVhbjtcbiAgbWF0Y2hNb2RlOiBSdWxlTWF0Y2hNb2RlO1xuICBpZ25vcmVDYXNlOiBib29sZWFuO1xuICBjb25kaXRpb25zOiBSdWxlQ29uZGl0aW9ucztcbiAgLyoqIEV2YWx1YXRpb24gcHJpb3JpdHk7IGxvd2VyIHJ1bnMgZmlyc3QuICovXG4gIG9yZGVyOiBudW1iZXI7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUnVsZUNhbmRpZGF0ZSB7XG4gIC8qKiBQYXRoIHJlbGF0aXZlIHRvIGl0cyB3b3Jrc3BhY2UgZm9sZGVyLCBzbGFzaC1zZXBhcmF0ZWQuICovXG4gIHJlbGF0aXZlUGF0aDogc3RyaW5nO1xuICAvKiogRmlsZSBuYW1lIGluY2x1ZGluZyBleHRlbnNpb24uICovXG4gIG5hbWU6IHN0cmluZztcbiAgc2l6ZUJ5dGVzPzogbnVtYmVyO1xuICAvKiogTW9kaWZpY2F0aW9uIHRpbWUgaW4gZXBvY2ggbWlsbGlzZWNvbmRzLiAqL1xuICBtb2RpZmllZE1zPzogbnVtYmVyO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFJ1bGVFdmFsdWF0aW9uIHtcbiAgbWF0Y2hlZDogYm9vbGVhbjtcbiAgLyoqIFdoaWNoIGNvbmRpdGlvbnMgbWF0Y2hlZCwgZm9yIHRoZSBzaWRlYmFyIHRvb2x0aXAgYW5kIHRlc3RzLiAqL1xuICByZWFzb25zOiBzdHJpbmdbXTtcbiAgLyoqIENvbmRpdGlvbnMgdGhhdCB3ZXJlIGNvbmZpZ3VyZWQgYnV0IGRpZCBub3QgbWF0Y2guICovXG4gIG1pc3Nlczogc3RyaW5nW107XG59XG5cbmZ1bmN0aW9uIHBhdHRlcm5zRnJvbSh2YWx1ZTogc3RyaW5nW10gfCB1bmRlZmluZWQpOiBzdHJpbmdbXSB7XG4gIHJldHVybiAodmFsdWUgPz8gW10pLm1hcCgoZW50cnkpID0+IGVudHJ5LnRyaW0oKSkuZmlsdGVyKEJvb2xlYW4pO1xufVxuXG5mdW5jdGlvbiBkYXlzVG9NcyhkYXlzOiBudW1iZXIpOiBudW1iZXIge1xuICByZXR1cm4gTWF0aC5tYXgoMCwgZGF5cykgKiAyNCAqIDYwICogNjAgKiAxMDAwO1xufVxuXG4vKipcbiAqIEV2YWx1YXRlcyBvbmUgcnVsZSBhZ2FpbnN0IG9uZSBmaWxlLlxuICpcbiAqIGBub3dgIGlzIGluamVjdGFibGUgc28gcmVjZW5jeSBydWxlcyBhcmUgZGV0ZXJtaW5pc3RpYyB1bmRlciB0ZXN0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gZXZhbHVhdGVSdWxlKFxuICBydWxlOiBTbWFydFJ1bGUsXG4gIGNhbmRpZGF0ZTogUnVsZUNhbmRpZGF0ZSxcbiAgbm93ID0gRGF0ZS5ub3coKVxuKTogUnVsZUV2YWx1YXRpb24ge1xuICBjb25zdCByZWFzb25zOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBtaXNzZXM6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IGlnbm9yZUNhc2UgPSBydWxlLmlnbm9yZUNhc2U7XG4gIGNvbnN0IHBhdGggPSBub3JtYWxpemVQYXRoKGNhbmRpZGF0ZS5yZWxhdGl2ZVBhdGgpO1xuXG4gIGNvbnN0IGluY2x1ZGVHbG9icyA9IHBhdHRlcm5zRnJvbShydWxlLmNvbmRpdGlvbnMuaW5jbHVkZUdsb2JzKTtcbiAgY29uc3QgZXhjbHVkZUdsb2JzID0gcGF0dGVybnNGcm9tKHJ1bGUuY29uZGl0aW9ucy5leGNsdWRlR2xvYnMpO1xuICBjb25zdCBleHRlbnNpb25zID0gcGF0dGVybnNGcm9tKHJ1bGUuY29uZGl0aW9ucy5leHRlbnNpb25zKS5tYXAoKGV4dCkgPT5cbiAgICBleHQucmVwbGFjZSgvXlxcLi8sICcnKS50b0xvd2VyQ2FzZSgpXG4gICk7XG5cbiAgLy8gLS0tIHBvc2l0aXZlIGNvbmRpdGlvbnMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICBjb25zdCBwb3NpdGl2ZXM6IHsgbGFiZWw6IHN0cmluZzsgaGl0OiBib29sZWFuIH1bXSA9IFtdO1xuXG4gIGlmIChpbmNsdWRlR2xvYnMubGVuZ3RoKSB7XG4gICAgY29uc3QgaGl0ID0gaW5jbHVkZUdsb2JzLnNvbWUoKHBhdHRlcm4pID0+IG1hdGNoZXNHbG9iKHBhdHRlcm4sIHBhdGgsIGlnbm9yZUNhc2UpKTtcbiAgICBjb25zdCBtYXRjaGVkUGF0dGVybiA9IGluY2x1ZGVHbG9icy5maW5kKChwYXR0ZXJuKSA9PiBtYXRjaGVzR2xvYihwYXR0ZXJuLCBwYXRoLCBpZ25vcmVDYXNlKSk7XG4gICAgcG9zaXRpdmVzLnB1c2goe1xuICAgICAgbGFiZWw6IGBtYXRjaGVzICR7bWF0Y2hlZFBhdHRlcm4gPz8gaW5jbHVkZUdsb2JzLmpvaW4oJyBvciAnKX1gLFxuICAgICAgaGl0LFxuICAgIH0pO1xuICB9XG5cbiAgaWYgKHJ1bGUuY29uZGl0aW9ucy5pbmNsdWRlUmVnZXgpIHtcbiAgICBjb25zdCBoaXQgPSBtYXRjaGVzUmVnZXgocnVsZS5jb25kaXRpb25zLmluY2x1ZGVSZWdleCwgcGF0aCwgaWdub3JlQ2FzZSk7XG4gICAgcG9zaXRpdmVzLnB1c2goeyBsYWJlbDogYG1hdGNoZXMgLyR7cnVsZS5jb25kaXRpb25zLmluY2x1ZGVSZWdleH0vYCwgaGl0IH0pO1xuICB9XG5cbiAgaWYgKHJ1bGUuY29uZGl0aW9ucy5nbG9iT3JSZWdleCAmJiBwb3NpdGl2ZXMubGVuZ3RoID4gMSkge1xuICAgIC8vIENvbGxhcHNlIGdsb2IgKyByZWdleCBpbnRvIGEgc2luZ2xlIGVpdGhlci9vciBjb25kaXRpb24uXG4gICAgY29uc3QgY29tYmluZWQ6IHsgbGFiZWw6IHN0cmluZzsgaGl0OiBib29sZWFuIH0gPSB7XG4gICAgICBsYWJlbDogcG9zaXRpdmVzLm1hcCgoZW50cnkpID0+IGVudHJ5LmxhYmVsKS5qb2luKCcgb3IgJyksXG4gICAgICBoaXQ6IHBvc2l0aXZlcy5zb21lKChlbnRyeSkgPT4gZW50cnkuaGl0KSxcbiAgICB9O1xuICAgIHBvc2l0aXZlcy5sZW5ndGggPSAwO1xuICAgIHBvc2l0aXZlcy5wdXNoKGNvbWJpbmVkKTtcbiAgfVxuXG4gIGlmIChleHRlbnNpb25zLmxlbmd0aCkge1xuICAgIGNvbnN0IGV4dCA9IChjYW5kaWRhdGUubmFtZS5zcGxpdCgnLicpLnBvcCgpID8/ICcnKS50b0xvd2VyQ2FzZSgpO1xuICAgIHBvc2l0aXZlcy5wdXNoKHsgbGFiZWw6IGBleHRlbnNpb24gLiR7ZXh0IHx8ICc/J31gLCBoaXQ6IGV4dGVuc2lvbnMuaW5jbHVkZXMoZXh0KSB9KTtcbiAgfVxuXG4gIGlmIChydWxlLmNvbmRpdGlvbnMubWluU2l6ZUtiICE9PSB1bmRlZmluZWQpIHtcbiAgICBjb25zdCBrYiA9IChjYW5kaWRhdGUuc2l6ZUJ5dGVzID8/IDApIC8gMTAyNDtcbiAgICBwb3NpdGl2ZXMucHVzaCh7IGxhYmVsOiBgYXQgbGVhc3QgJHtydWxlLmNvbmRpdGlvbnMubWluU2l6ZUtifSBLQmAsIGhpdDoga2IgPj0gcnVsZS5jb25kaXRpb25zLm1pblNpemVLYiB9KTtcbiAgfVxuICBpZiAocnVsZS5jb25kaXRpb25zLm1heFNpemVLYiAhPT0gdW5kZWZpbmVkKSB7XG4gICAgY29uc3Qga2IgPSAoY2FuZGlkYXRlLnNpemVCeXRlcyA/PyAwKSAvIDEwMjQ7XG4gICAgcG9zaXRpdmVzLnB1c2goeyBsYWJlbDogYGF0IG1vc3QgJHtydWxlLmNvbmRpdGlvbnMubWF4U2l6ZUtifSBLQmAsIGhpdDoga2IgPD0gcnVsZS5jb25kaXRpb25zLm1heFNpemVLYiB9KTtcbiAgfVxuICBpZiAocnVsZS5jb25kaXRpb25zLm1vZGlmaWVkV2l0aGluRGF5cyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgY29uc3QgYWdlID0gbm93IC0gKGNhbmRpZGF0ZS5tb2RpZmllZE1zID8/IDApO1xuICAgIHBvc2l0aXZlcy5wdXNoKHtcbiAgICAgIGxhYmVsOiBgY2hhbmdlZCBpbiB0aGUgbGFzdCAke3J1bGUuY29uZGl0aW9ucy5tb2RpZmllZFdpdGhpbkRheXN9IGRheShzKWAsXG4gICAgICBoaXQ6IGFnZSA+PSAwICYmIGFnZSA8PSBkYXlzVG9NcyhydWxlLmNvbmRpdGlvbnMubW9kaWZpZWRXaXRoaW5EYXlzKSxcbiAgICB9KTtcbiAgfVxuXG4gIGZvciAoY29uc3QgY29uZGl0aW9uIG9mIHBvc2l0aXZlcykge1xuICAgIChjb25kaXRpb24uaGl0ID8gcmVhc29ucyA6IG1pc3NlcykucHVzaChjb25kaXRpb24ubGFiZWwpO1xuICB9XG5cbiAgbGV0IG1hdGNoZWQ6IGJvb2xlYW47XG4gIGlmICghcG9zaXRpdmVzLmxlbmd0aCkge1xuICAgIC8vIE5vIHBvc2l0aXZlIGNvbmRpdGlvbnM6IGV2ZXJ5dGhpbmcgbWF0Y2hlcyB1bmxlc3MgYW4gZXhjbHVkZSB2ZXRvZXMgaXQuXG4gICAgbWF0Y2hlZCA9IHRydWU7XG4gIH0gZWxzZSBpZiAocnVsZS5tYXRjaE1vZGUgPT09ICdhbnknKSB7XG4gICAgbWF0Y2hlZCA9IHBvc2l0aXZlcy5zb21lKChjb25kaXRpb24pID0+IGNvbmRpdGlvbi5oaXQpO1xuICB9IGVsc2Uge1xuICAgIG1hdGNoZWQgPSBwb3NpdGl2ZXMuZXZlcnkoKGNvbmRpdGlvbikgPT4gY29uZGl0aW9uLmhpdCk7XG4gIH1cblxuICAvLyAtLS0gZXhjbHVzaW9ucyBhbHdheXMgdmV0byAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgZm9yIChjb25zdCBwYXR0ZXJuIG9mIGV4Y2x1ZGVHbG9icykge1xuICAgIGlmIChtYXRjaGVzR2xvYihwYXR0ZXJuLCBwYXRoLCBpZ25vcmVDYXNlKSkge1xuICAgICAgbWF0Y2hlZCA9IGZhbHNlO1xuICAgICAgbWlzc2VzLnB1c2goYGV4Y2x1ZGVkIGJ5ICR7cGF0dGVybn1gKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4geyBtYXRjaGVkLCByZWFzb25zLCBtaXNzZXMgfTtcbn1cblxuLyoqIEtlZXBzIG9ubHkgdGhlIGZpbGVzIHRoYXQgbWF0Y2ggdGhlIHJ1bGUuICovXG5leHBvcnQgZnVuY3Rpb24gZmlsdGVyQnlSdWxlPFQgZXh0ZW5kcyBSdWxlQ2FuZGlkYXRlPihcbiAgcnVsZTogU21hcnRSdWxlLFxuICBjYW5kaWRhdGVzOiBUW10sXG4gIG5vdyA9IERhdGUubm93KClcbik6IFRbXSB7XG4gIHJldHVybiBjYW5kaWRhdGVzLmZpbHRlcigoY2FuZGlkYXRlKSA9PiBldmFsdWF0ZVJ1bGUocnVsZSwgY2FuZGlkYXRlLCBub3cpLm1hdGNoZWQpO1xufVxuXG4vKiogT25lLWxpbmUgc3VtbWFyeSBmb3IgdGhlIHNpZGViYXIsIGUuZy4gXCIqLnBkZiwgKi5tZCBcdTAwQjcgd2l0aGluIDMwIGRheXNcIi4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZXNjcmliZVJ1bGUocnVsZTogU21hcnRSdWxlKTogc3RyaW5nIHtcbiAgY29uc3QgcGFydHM6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IHsgaW5jbHVkZUdsb2JzLCBleGNsdWRlR2xvYnMsIGluY2x1ZGVSZWdleCwgZXh0ZW5zaW9ucywgbWluU2l6ZUtiLCBtYXhTaXplS2IsIG1vZGlmaWVkV2l0aGluRGF5cyB9ID1cbiAgICBydWxlLmNvbmRpdGlvbnM7XG5cbiAgY29uc3QgZ2xvYnMgPSBwYXR0ZXJuc0Zyb20oaW5jbHVkZUdsb2JzKTtcbiAgaWYgKGdsb2JzLmxlbmd0aCkge1xuICAgIHBhcnRzLnB1c2goZ2xvYnMuam9pbignIG9yICcpKTtcbiAgfVxuICBpZiAoaW5jbHVkZVJlZ2V4KSB7XG4gICAgcGFydHMucHVzaChgLyR7aW5jbHVkZVJlZ2V4fS9gKTtcbiAgfVxuICBjb25zdCBleHRzID0gcGF0dGVybnNGcm9tKGV4dGVuc2lvbnMpO1xuICBpZiAoZXh0cy5sZW5ndGgpIHtcbiAgICBwYXJ0cy5wdXNoKGAqLnske2V4dHMubWFwKChlKSA9PiBlLnJlcGxhY2UoL15cXC4vLCAnJykpLmpvaW4oJywnKX19YCk7XG4gIH1cbiAgaWYgKG1pblNpemVLYiAhPT0gdW5kZWZpbmVkIHx8IG1heFNpemVLYiAhPT0gdW5kZWZpbmVkKSB7XG4gICAgcGFydHMucHVzaChgJHttaW5TaXplS2IgPz8gMH1cdTIwMTMke21heFNpemVLYiA/PyAnXHUyMjFFJ30gS0JgKTtcbiAgfVxuICBpZiAobW9kaWZpZWRXaXRoaW5EYXlzICE9PSB1bmRlZmluZWQpIHtcbiAgICBwYXJ0cy5wdXNoKGBjaGFuZ2VkIGluICR7bW9kaWZpZWRXaXRoaW5EYXlzfWRgKTtcbiAgfVxuICBjb25zdCBleGNsdWRlZCA9IHBhdHRlcm5zRnJvbShleGNsdWRlR2xvYnMpO1xuICBpZiAoIXBhcnRzLmxlbmd0aCAmJiAhZXhjbHVkZWQubGVuZ3RoKSB7XG4gICAgcmV0dXJuICdldmVyeXRoaW5nIChubyBjb25kaXRpb25zIHlldCknO1xuICB9XG5cbiAgcGFydHMucHVzaChydWxlLm1hdGNoTW9kZSA9PT0gJ2FueScgPyAnYW55IG9mIHRoZXNlJyA6ICdhbGwgb2YgdGhlc2UnKTtcbiAgY29uc3QgYmFzZSA9IHBhcnRzLmxlbmd0aCA+IDEgPyBwYXJ0cy5qb2luKCcgXHUwMEI3ICcpIDogJ2V2ZXJ5dGhpbmcnO1xuICByZXR1cm4gZXhjbHVkZWQubGVuZ3RoID8gYCR7YmFzZX0gXHUwMEI3IGV4Y2VwdCAke2V4Y2x1ZGVkLmpvaW4oJywgJyl9YCA6IGJhc2U7XG59XG5cbi8qKiBWYWxpZGF0ZXMgYSBydWxlIGJlZm9yZSBzYXZpbmcgaXQsIHJldHVybmluZyBodW1hbi1yZWFkYWJsZSBwcm9ibGVtcy4gKi9cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZVJ1bGUocnVsZTogU21hcnRSdWxlKTogc3RyaW5nW10ge1xuICBjb25zdCBwcm9ibGVtczogc3RyaW5nW10gPSBbXTtcbiAgaWYgKCFydWxlLm5hbWUudHJpbSgpKSB7XG4gICAgcHJvYmxlbXMucHVzaCgnQSBuYW1lIGlzIHJlcXVpcmVkLicpO1xuICB9XG4gIGNvbnN0IHsgaW5jbHVkZUdsb2JzLCBleGNsdWRlR2xvYnMsIGluY2x1ZGVSZWdleCwgZXh0ZW5zaW9ucywgbWluU2l6ZUtiLCBtYXhTaXplS2IsIG1vZGlmaWVkV2l0aGluRGF5cyB9ID1cbiAgICBydWxlLmNvbmRpdGlvbnM7XG5cbiAgY29uc3QgaGFzUG9zaXRpdmUgPVxuICAgIHBhdHRlcm5zRnJvbShpbmNsdWRlR2xvYnMpLmxlbmd0aCA+IDAgfHxcbiAgICBCb29sZWFuKGluY2x1ZGVSZWdleCkgfHxcbiAgICBwYXR0ZXJuc0Zyb20oZXh0ZW5zaW9ucykubGVuZ3RoID4gMCB8fFxuICAgIG1pblNpemVLYiAhPT0gdW5kZWZpbmVkIHx8XG4gICAgbWF4U2l6ZUtiICE9PSB1bmRlZmluZWQgfHxcbiAgICBtb2RpZmllZFdpdGhpbkRheXMgIT09IHVuZGVmaW5lZDtcblxuICBpZiAoIWhhc1Bvc2l0aXZlKSB7XG4gICAgcHJvYmxlbXMucHVzaCgnQWRkIGF0IGxlYXN0IG9uZSBjb25kaXRpb24gKGEgcGF0dGVybiwgZXh0ZW5zaW9uLCBzaXplIG9yIGRhdGUgZmlsdGVyKS4nKTtcbiAgfVxuICBpZiAoaW5jbHVkZVJlZ2V4ICYmICFpc1ZhbGlkUmVnZXhTYWZlKGluY2x1ZGVSZWdleCkpIHtcbiAgICBwcm9ibGVtcy5wdXNoKGBUaGUgcmVndWxhciBleHByZXNzaW9uIC8ke2luY2x1ZGVSZWdleH0vIGlzIG5vdCB2YWxpZC5gKTtcbiAgfVxuICBmb3IgKGNvbnN0IHBhdHRlcm4gb2YgWy4uLnBhdHRlcm5zRnJvbShpbmNsdWRlR2xvYnMpLCAuLi5wYXR0ZXJuc0Zyb20oZXhjbHVkZUdsb2JzKV0pIHtcbiAgICBpZiAocGF0dGVybi5pbmNsdWRlcygnWycpICYmICFwYXR0ZXJuLmluY2x1ZGVzKCddJykpIHtcbiAgICAgIHByb2JsZW1zLnB1c2goYFRoZSBwYXR0ZXJuIFwiJHtwYXR0ZXJufVwiIGhhcyBhbiB1bmNsb3NlZCBjaGFyYWN0ZXIgY2xhc3MuYCk7XG4gICAgfVxuICB9XG4gIGlmIChtaW5TaXplS2IgIT09IHVuZGVmaW5lZCAmJiBtYXhTaXplS2IgIT09IHVuZGVmaW5lZCAmJiBtaW5TaXplS2IgPiBtYXhTaXplS2IpIHtcbiAgICBwcm9ibGVtcy5wdXNoKCdUaGUgbWluaW11bSBzaXplIGlzIGxhcmdlciB0aGFuIHRoZSBtYXhpbXVtIHNpemUuJyk7XG4gIH1cbiAgaWYgKG1vZGlmaWVkV2l0aGluRGF5cyAhPT0gdW5kZWZpbmVkICYmIG1vZGlmaWVkV2l0aGluRGF5cyA8PSAwKSB7XG4gICAgcHJvYmxlbXMucHVzaCgnVGhlIHJlY2VuY3kgd2luZG93IG11c3QgYmUgYXQgbGVhc3Qgb25lIGRheS4nKTtcbiAgfVxuICByZXR1cm4gcHJvYmxlbXM7XG59XG5cbmZ1bmN0aW9uIGlzVmFsaWRSZWdleFNhZmUoc291cmNlOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgdHJ5IHtcbiAgICBuZXcgUmVnRXhwKHNvdXJjZSk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG4vKiogQ3JlYXRlcyBhIHJ1bGUgd2l0aCBzYW5lIGRlZmF1bHRzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVJ1bGUoXG4gIG5hbWU6IHN0cmluZyxcbiAgY29uZGl0aW9uczogUnVsZUNvbmRpdGlvbnMsXG4gIG92ZXJyaWRlczogUGFydGlhbDxTbWFydFJ1bGU+ID0ge31cbik6IFNtYXJ0UnVsZSB7XG4gIC8vIEtlZXAgdGhlIGNhbGxlcidzIHRleHQgKGV2ZW4gaWYgaXQgaXMgYmxhbmspIHNvIHZhbGlkYXRlUnVsZSBjYW4gcmVwb3J0IHRoZVxuICAvLyBwcm9ibGVtIGluc3RlYWQgb2YgdGhlIHJ1bGUgc2lsZW50bHkgYWNxdWlyaW5nIGEgZGVmYXVsdCBuYW1lLlxuICByZXR1cm4ge1xuICAgIGlkOiBvdmVycmlkZXMuaWQgPz8gYHJ1bGUtJHtEYXRlLm5vdygpLnRvU3RyaW5nKDM2KX0tJHtNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zbGljZSgyLCA3KX1gLFxuICAgIGRlc2NyaXB0aW9uOiBvdmVycmlkZXMuZGVzY3JpcHRpb24sXG4gICAgZW5hYmxlZDogb3ZlcnJpZGVzLmVuYWJsZWQgPz8gdHJ1ZSxcbiAgICBtYXRjaE1vZGU6IG92ZXJyaWRlcy5tYXRjaE1vZGUgPz8gJ2FsbCcsXG4gICAgaWdub3JlQ2FzZTogb3ZlcnJpZGVzLmlnbm9yZUNhc2UgPz8gdHJ1ZSxcbiAgICBvcmRlcjogb3ZlcnJpZGVzLm9yZGVyID8/IDEwMCxcbiAgICAuLi5vdmVycmlkZXMsXG4gICAgLy8gVGhlIGV4cGxpY2l0bHkgcGFzc2VkIG5hbWUgYW5kIGNvbmRpdGlvbnMgYWx3YXlzIHdpbiBvdmVyIHRoZSBvdmVycmlkZXMuXG4gICAgbmFtZSxcbiAgICBjb25kaXRpb25zLFxuICB9O1xufVxuIiwgImltcG9ydCAqIGFzIHZzY29kZSBmcm9tICd2c2NvZGUnO1xuaW1wb3J0IHsgZGVzY3JpYmVSdWxlLCB2YWxpZGF0ZVJ1bGUsIHR5cGUgUnVsZUNvbmRpdGlvbnMsIHR5cGUgU21hcnRSdWxlIH0gZnJvbSAnLi9zZWFyY2gvc21hcnRSdWxlcy50cyc7XG5pbXBvcnQgeyB0eXBlIEZpbGVSZWYgfSBmcm9tICcuL3R5cGVzLnRzJztcbmltcG9ydCB7IHRvRmlsZVJlZiB9IGZyb20gJy4vZmlsZVJlZi50cyc7XG5pbXBvcnQgdHlwZSB7IFN0b3JlIH0gZnJvbSAnLi9zdG9yZS50cyc7XG5pbXBvcnQgdHlwZSB7IFBkZlNlYXJjaFNlcnZpY2UgfSBmcm9tICcuL3NlYXJjaC9wZGZTZWFyY2gudHMnO1xuXG5jb25zdCBORVdfR1JPVVBfU0VOVElORUwgPSAnX19wZGZodWJfbmV3X2dyb3VwX18nO1xuY29uc3QgRVhURVJOQUxfU0VOVElORUwgPSAnX19wZGZodWJfZXh0ZXJuYWxfXyc7XG5cbi8qKiBSZXNvbHZlcyB0aGUgZmlsZXMgYSBjb250ZXh0LW1lbnUgY29tbWFuZCBzaG91bGQgYWN0IG9uLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVUYXJnZXRGaWxlcyh1cmk/OiB2c2NvZGUuVXJpKTogRmlsZVJlZltdIHtcbiAgaWYgKHVyaSAmJiB1cmkuc2NoZW1lID09PSAnZmlsZScpIHtcbiAgICByZXR1cm4gW3RvRmlsZVJlZih1cmkuZnNQYXRoKV07XG4gIH1cblxuICBjb25zdCBlZGl0b3IgPSB2c2NvZGUud2luZG93LmFjdGl2ZVRleHRFZGl0b3I7XG4gIGlmIChlZGl0b3IgJiYgZWRpdG9yLmRvY3VtZW50LnVyaS5zY2hlbWUgPT09ICdmaWxlJykge1xuICAgIGNvbnN0IHNlbGVjdGlvbiA9IGVkaXRvci5zZWxlY3Rpb247XG4gICAgaWYgKCFzZWxlY3Rpb24uaXNFbXB0eSkge1xuICAgICAgLy8gRmF2b3VyaXRlcyBzdG9yZSB3aG9sZSBmaWxlcywgc28gYSBzZWxlY3Rpb24gbWFwcyB0byBpdHMgZG9jdW1lbnQuXG4gICAgICByZXR1cm4gW3RvRmlsZVJlZihlZGl0b3IuZG9jdW1lbnQudXJpLmZzUGF0aCldO1xuICAgIH1cbiAgICByZXR1cm4gW3RvRmlsZVJlZihlZGl0b3IuZG9jdW1lbnQudXJpLmZzUGF0aCldO1xuICB9XG5cbiAgLy8gRmFsbCBiYWNrIHRvIHdoYXRldmVyIGlzIHNlbGVjdGVkIGluIHRoZSBFeHBsb3Jlci5cbiAgY29uc3QgYWN0aXZlID0gdnNjb2RlLndpbmRvdy50YWJHcm91cHMuYWN0aXZlVGFiR3JvdXAuYWN0aXZlVGFiO1xuICBjb25zdCBpbnB1dCA9IGFjdGl2ZT8uaW5wdXQgYXMgeyB1cmk/OiB2c2NvZGUuVXJpIH0gfCB1bmRlZmluZWQ7XG4gIGlmIChpbnB1dD8udXJpICYmIGlucHV0LnVyaS5zY2hlbWUgPT09ICdmaWxlJykge1xuICAgIHJldHVybiBbdG9GaWxlUmVmKGlucHV0LnVyaS5mc1BhdGgpXTtcbiAgfVxuICByZXR1cm4gW107XG59XG5cbi8qKlxuICogXCJBZGQgdG8gRmF2b3JpdGVzXCI6IHNob3dzIHRoZSBncm91cCBwaWNrZXIgKGNyZWF0aW5nIGdyb3VwcyBvbiB0aGUgZmx5KSBhbmRcbiAqIHJvdXRlcyBleHRlcm5hbCBmaWxlcyB0byB0aGUgY2FwcGVkIGV4dGVybmFsIGxpc3QgaW5zdGVhZC5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGFkZFRvRmF2b3JpdGVzKHN0b3JlOiBTdG9yZSwgdXJpcz86IHZzY29kZS5VcmlbXSk6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCB0YXJnZXRzOiBGaWxlUmVmW10gPSBbXTtcbiAgZm9yIChjb25zdCB1cmkgb2YgdXJpcyA/PyBbXSkge1xuICAgIGlmICh1cmkuc2NoZW1lID09PSAnZmlsZScpIHtcbiAgICAgIHRhcmdldHMucHVzaCh0b0ZpbGVSZWYodXJpLmZzUGF0aCkpO1xuICAgIH1cbiAgfVxuICBpZiAoIXRhcmdldHMubGVuZ3RoKSB7XG4gICAgdGFyZ2V0cy5wdXNoKC4uLnJlc29sdmVUYXJnZXRGaWxlcyh1bmRlZmluZWQpKTtcbiAgfVxuICBpZiAoIXRhcmdldHMubGVuZ3RoKSB7XG4gICAgdm9pZCB2c2NvZGUud2luZG93LnNob3dXYXJuaW5nTWVzc2FnZSgnUERGIEh1Yjogbm8gZmlsZSBzZWxlY3RlZC4nKTtcbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCBpblByb2plY3QgPSB0YXJnZXRzLmZpbHRlcigoZikgPT4gIWYuZXh0ZXJuYWwpO1xuICBjb25zdCBleHRlcm5hbCA9IHRhcmdldHMuZmlsdGVyKChmKSA9PiBmLmV4dGVybmFsKTtcblxuICBpZiAoaW5Qcm9qZWN0Lmxlbmd0aCkge1xuICAgIGNvbnN0IGdyb3VwSWQgPSBhd2FpdCBwaWNrR3JvdXAoc3RvcmUsIGluUHJvamVjdC5sZW5ndGggPiAxID8gYEFkZCAke2luUHJvamVjdC5sZW5ndGh9IGZpbGVzIHRvIGZhdm9yaXRlc2AgOiAnQWRkIHRvIGZhdm9yaXRlcycpO1xuICAgIGlmIChncm91cElkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGZvciAoY29uc3QgZmlsZSBvZiBpblByb2plY3QpIHtcbiAgICAgICAgc3RvcmUuYWRkRmF2b3JpdGUoZmlsZSwgZ3JvdXBJZCA9PT0gTkVXX0dST1VQX1NFTlRJTkVMID8gdW5kZWZpbmVkIDogZ3JvdXBJZCk7XG4gICAgICB9XG4gICAgICBzaG93QWRkZWRDb25maXJtYXRpb24oaW5Qcm9qZWN0Lmxlbmd0aCwgc3RvcmUuZ2V0R3JvdXAoZ3JvdXBJZCk/Lm5hbWUpO1xuICAgIH1cbiAgfVxuXG4gIGlmIChleHRlcm5hbC5sZW5ndGgpIHtcbiAgICBhd2FpdCBhZGRFeHRlcm5hbEZpbGVzKHN0b3JlLCBleHRlcm5hbCk7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gcGlja0dyb3VwKHN0b3JlOiBTdG9yZSwgdGl0bGU6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nIHwgdW5kZWZpbmVkPiB7XG4gIGNvbnN0IGdyb3VwcyA9IHN0b3JlLmdldEdyb3VwcygpLm1hcCgoZ3JvdXApID0+ICh7XG4gICAgbGFiZWw6IGdyb3VwLm5hbWUsXG4gICAgZGVzY3JpcHRpb246IGAke2dyb3VwLmZpbGVzLmxlbmd0aH0gZmlsZShzKWAsXG4gICAgaWQ6IGdyb3VwLmlkLFxuICB9KSk7XG5cbiAgaWYgKCFncm91cHMubGVuZ3RoKSB7XG4gICAgY29uc3QgbmFtZSA9IGF3YWl0IHZzY29kZS53aW5kb3cuc2hvd0lucHV0Qm94KHtcbiAgICAgIHRpdGxlOiAnTmV3IGZhdm9yaXRlcyBncm91cCcsXG4gICAgICBwcm9tcHQ6ICdOYW1lIHRoZSBncm91cCwgZm9yIGV4YW1wbGUgXCJQeXRob25cIiBvciBcIkphdmFcIicsXG4gICAgICB2YWx1ZTogdnNjb2RlLndvcmtzcGFjZS5nZXRDb25maWd1cmF0aW9uKCdwZGZIdWInKS5nZXQ8c3RyaW5nPignZmF2b3JpdGVzLmRlZmF1bHRHcm91cE5hbWUnLCAnRmF2b3JpdGVzJyksXG4gICAgICB2YWxpZGF0ZUlucHV0OiAodmFsdWUpID0+ICh2YWx1ZS50cmltKCkubGVuZ3RoID8gdW5kZWZpbmVkIDogJ0EgZ3JvdXAgbmFtZSBpcyByZXF1aXJlZCcpLFxuICAgIH0pO1xuICAgIGlmIChuYW1lID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIHJldHVybiBzdG9yZS5jcmVhdGVHcm91cChuYW1lKS5pZDtcbiAgfVxuXG4gIGNvbnN0IHBpY2tlZCA9IGF3YWl0IHZzY29kZS53aW5kb3cuc2hvd1F1aWNrUGljayhcbiAgICBbXG4gICAgICAuLi5ncm91cHMsXG4gICAgICB7IGxhYmVsOiAnJChhZGQpIE5ldyBncm91cC4uLicsIGRlc2NyaXB0aW9uOiAnQ3JlYXRlIGFub3RoZXIgbmFtZWQgZ3JvdXAnLCBpZDogTkVXX0dST1VQX1NFTlRJTkVMIH0sXG4gICAgXSxcbiAgICB7IHRpdGxlLCBwbGFjZUhvbGRlcjogJ1BpY2sgYSBncm91cCcgfVxuICApO1xuICBpZiAoIXBpY2tlZCkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbiAgaWYgKHBpY2tlZC5pZCAhPT0gTkVXX0dST1VQX1NFTlRJTkVMKSB7XG4gICAgcmV0dXJuIHBpY2tlZC5pZDtcbiAgfVxuICBjb25zdCBuYW1lID0gYXdhaXQgdnNjb2RlLndpbmRvdy5zaG93SW5wdXRCb3goe1xuICAgIHRpdGxlOiAnTmV3IGZhdm9yaXRlcyBncm91cCcsXG4gICAgcHJvbXB0OiAnTmFtZSB0aGUgZ3JvdXAsIGZvciBleGFtcGxlIFwiUHl0aG9uXCIgb3IgXCJKYXZhXCInLFxuICAgIHZhbGlkYXRlSW5wdXQ6ICh2YWx1ZSkgPT4gKHZhbHVlLnRyaW0oKS5sZW5ndGggPyB1bmRlZmluZWQgOiAnQSBncm91cCBuYW1lIGlzIHJlcXVpcmVkJyksXG4gIH0pO1xuICBpZiAobmFtZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgfVxuICByZXR1cm4gc3RvcmUuY3JlYXRlR3JvdXAobmFtZSkuaWQ7XG59XG5cbmZ1bmN0aW9uIHNob3dBZGRlZENvbmZpcm1hdGlvbihjb3VudDogbnVtYmVyLCBncm91cE5hbWU/OiBzdHJpbmcpOiB2b2lkIHtcbiAgY29uc3Qgd2hlcmUgPSBncm91cE5hbWUgPyBgIHRvIFwiJHtncm91cE5hbWV9XCJgIDogJyc7XG4gIHZvaWQgdnNjb2RlLndpbmRvdy5zZXRTdGF0dXNCYXJNZXNzYWdlKGBQREYgSHViOiBhZGRlZCAke2NvdW50fSBmaWxlKHMpJHt3aGVyZX1gLCA0MDAwKTtcbn1cblxuLyoqIEFkZHMgZXh0ZXJuYWwgZmlsZXMsIHJlc3BlY3RpbmcgdGhlIGhhcmQgY2FwLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGFkZEV4dGVybmFsRmlsZXMoc3RvcmU6IFN0b3JlLCBmaWxlczogRmlsZVJlZltdKTogUHJvbWlzZTx2b2lkPiB7XG4gIGxldCBhZGRlZCA9IDA7XG4gIGNvbnN0IHNraXBwZWQ6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3QgZmlsZSBvZiBmaWxlcykge1xuICAgIGNvbnN0IHJlc3VsdCA9IHN0b3JlLmFkZEV4dGVybmFsKHsgLi4uZmlsZSwgZXh0ZXJuYWw6IHRydWUgfSk7XG4gICAgaWYgKHJlc3VsdCA9PT0gJ2FkZGVkJykge1xuICAgICAgYWRkZWQgKz0gMTtcbiAgICB9IGVsc2Uge1xuICAgICAgc2tpcHBlZC5wdXNoKGAke2ZpbGUubmFtZX0gKCR7cmVzdWx0ID09PSAnZnVsbCcgPyAnbGlzdCBpcyBmdWxsJyA6ICdhbHJlYWR5IGFkZGVkJ30pYCk7XG4gICAgfVxuICB9XG4gIGlmIChhZGRlZCkge1xuICAgIHZvaWQgdnNjb2RlLndpbmRvdy5zZXRTdGF0dXNCYXJNZXNzYWdlKGBQREYgSHViOiBhZGRlZCAke2FkZGVkfSBleHRlcm5hbCBmYXZvcml0ZShzKWAsIDQwMDApO1xuICB9XG4gIGlmIChza2lwcGVkLmxlbmd0aCkge1xuICAgIGNvbnN0IG1heCA9IHN0b3JlLmV4dGVybmFsTWF4O1xuICAgIGNvbnN0IGNob2ljZSA9IGF3YWl0IHZzY29kZS53aW5kb3cuc2hvd1dhcm5pbmdNZXNzYWdlKFxuICAgICAgYFBERiBIdWI6ICR7c2tpcHBlZC5qb2luKCcsICcpfS4gVGhlIGV4dGVybmFsIGxpc3QgaG9sZHMgYXQgbW9zdCAke21heH0gZmlsZXMuYCxcbiAgICAgICdNYW5hZ2UgZXh0ZXJuYWwgZmlsZXMnXG4gICAgKTtcbiAgICBpZiAoY2hvaWNlKSB7XG4gICAgICBhd2FpdCB2c2NvZGUuY29tbWFuZHMuZXhlY3V0ZUNvbW1hbmQoJ3BkZkh1Yi5mb2N1cycpO1xuICAgIH1cbiAgfVxufVxuXG4vKiogTXVsdGktc2VsZWN0IHBpY2tlciBmb3IgZmlsZXMgdGhhdCBsaXZlIG91dHNpZGUgdGhlIHByb2plY3QuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcGlja0V4dGVybmFsRmlsZXMoc3RvcmU6IFN0b3JlKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IHJlbWFpbmluZyA9IHN0b3JlLmV4dGVybmFsTWF4IC0gc3RvcmUuZ2V0RXh0ZXJuYWwoKS5sZW5ndGg7XG4gIGlmIChyZW1haW5pbmcgPD0gMCkge1xuICAgIHZvaWQgdnNjb2RlLndpbmRvdy5zaG93V2FybmluZ01lc3NhZ2UoXG4gICAgICBgUERGIEh1YjogdGhlIGV4dGVybmFsIGZhdm9yaXRlcyBsaXN0IGlzIGZ1bGwgKCR7c3RvcmUuZXh0ZXJuYWxNYXh9LyR7c3RvcmUuZXh0ZXJuYWxNYXh9KS4gUmVtb3ZlIG9uZSBmaXJzdC5gXG4gICAgKTtcbiAgICByZXR1cm47XG4gIH1cblxuICBjb25zdCBwaWNrZWQgPSBhd2FpdCB2c2NvZGUud2luZG93LnNob3dPcGVuRGlhbG9nKHtcbiAgICBjYW5TZWxlY3RNYW55OiB0cnVlLFxuICAgIGNhblNlbGVjdEZpbGVzOiB0cnVlLFxuICAgIGNhblNlbGVjdEZvbGRlcnM6IGZhbHNlLFxuICAgIG9wZW5MYWJlbDogYEFkZCAobWF4ICR7cmVtYWluaW5nfSBtb3JlKWAsXG4gICAgdGl0bGU6IGBBZGQgZmlsZXMgb3V0c2lkZSB0aGUgcHJvamVjdCBcdTIwMTQgJHtyZW1haW5pbmd9IHNsb3QocykgbGVmdGAsXG4gIH0pO1xuICBpZiAoIXBpY2tlZD8ubGVuZ3RoKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgY29uc3QgaW5zaWRlID0gcGlja2VkLmZpbHRlcigodXJpKSA9PiB2c2NvZGUud29ya3NwYWNlLmdldFdvcmtzcGFjZUZvbGRlcih1cmkpKTtcbiAgY29uc3Qgb3V0c2lkZSA9IHBpY2tlZC5maWx0ZXIoKHVyaSkgPT4gIXZzY29kZS53b3Jrc3BhY2UuZ2V0V29ya3NwYWNlRm9sZGVyKHVyaSkpO1xuICBpZiAoaW5zaWRlLmxlbmd0aCkge1xuICAgIHZvaWQgdnNjb2RlLndpbmRvdy5zaG93V2FybmluZ01lc3NhZ2UoXG4gICAgICBgUERGIEh1YjogJHtpbnNpZGUubGVuZ3RofSBzZWxlY3RlZCBmaWxlKHMpIGFyZSBpbnNpZGUgdGhlIHByb2plY3QuIFVzZSBcIkFkZCB0byBGYXZvcml0ZXNcIiBmb3IgdGhvc2UuYFxuICAgICk7XG4gIH1cbiAgYXdhaXQgYWRkRXh0ZXJuYWxGaWxlcyhcbiAgICBzdG9yZSxcbiAgICBvdXRzaWRlLm1hcCgodXJpKSA9PiB0b0ZpbGVSZWYodXJpLmZzUGF0aCkpXG4gICk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjcmVhdGVHcm91cChzdG9yZTogU3RvcmUpOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3QgbmFtZSA9IGF3YWl0IHZzY29kZS53aW5kb3cuc2hvd0lucHV0Qm94KHtcbiAgICB0aXRsZTogJ05ldyBmYXZvcml0ZXMgZ3JvdXAnLFxuICAgIHByb21wdDogJ05hbWUgdGhlIGdyb3VwLCBmb3IgZXhhbXBsZSBcIlB5dGhvblwiIG9yIFwiSmF2YVwiJyxcbiAgICB2YWxpZGF0ZUlucHV0OiAodmFsdWUpID0+ICh2YWx1ZS50cmltKCkubGVuZ3RoID8gdW5kZWZpbmVkIDogJ0EgZ3JvdXAgbmFtZSBpcyByZXF1aXJlZCcpLFxuICB9KTtcbiAgaWYgKG5hbWUgIT09IHVuZGVmaW5lZCkge1xuICAgIHN0b3JlLmNyZWF0ZUdyb3VwKG5hbWUpO1xuICB9XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZW5hbWVHcm91cChzdG9yZTogU3RvcmUsIGdyb3VwSWQ/OiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3QgZ3JvdXAgPSBncm91cElkID8gc3RvcmUuZ2V0R3JvdXAoZ3JvdXBJZCkgOiBhd2FpdCBwaWNrR3JvdXBPbmx5KHN0b3JlKTtcbiAgaWYgKCFncm91cCkge1xuICAgIHJldHVybjtcbiAgfVxuICBjb25zdCBuYW1lID0gYXdhaXQgdnNjb2RlLndpbmRvdy5zaG93SW5wdXRCb3goe1xuICAgIHRpdGxlOiBgUmVuYW1lIFwiJHtncm91cC5uYW1lfVwiYCxcbiAgICB2YWx1ZTogZ3JvdXAubmFtZSxcbiAgICB2YWxpZGF0ZUlucHV0OiAodmFsdWUpID0+ICh2YWx1ZS50cmltKCkubGVuZ3RoID8gdW5kZWZpbmVkIDogJ0EgZ3JvdXAgbmFtZSBpcyByZXF1aXJlZCcpLFxuICB9KTtcbiAgaWYgKG5hbWUgIT09IHVuZGVmaW5lZCkge1xuICAgIHN0b3JlLnJlbmFtZUdyb3VwKGdyb3VwLmlkLCBuYW1lKTtcbiAgfVxufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZGVsZXRlR3JvdXAoc3RvcmU6IFN0b3JlLCBncm91cElkPzogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IGdyb3VwID0gZ3JvdXBJZCA/IHN0b3JlLmdldEdyb3VwKGdyb3VwSWQpIDogYXdhaXQgcGlja0dyb3VwT25seShzdG9yZSk7XG4gIGlmICghZ3JvdXApIHtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgY29uZmlybWVkID0gYXdhaXQgdnNjb2RlLndpbmRvdy5zaG93V2FybmluZ01lc3NhZ2UoXG4gICAgYERlbGV0ZSB0aGUgZ3JvdXAgXCIke2dyb3VwLm5hbWV9XCIgYW5kIGl0cyAke2dyb3VwLmZpbGVzLmxlbmd0aH0gZmF2b3JpdGUocyk/YCxcbiAgICB7IG1vZGFsOiB0cnVlIH0sXG4gICAgJ0RlbGV0ZSdcbiAgKTtcbiAgaWYgKGNvbmZpcm1lZCA9PT0gJ0RlbGV0ZScpIHtcbiAgICBzdG9yZS5kZWxldGVHcm91cChncm91cC5pZCk7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gcGlja0dyb3VwT25seShzdG9yZTogU3RvcmUpOiBQcm9taXNlPFJldHVyblR5cGU8U3RvcmVbJ2dldEdyb3VwJ10+PiB7XG4gIGNvbnN0IGdyb3VwcyA9IHN0b3JlLmdldEdyb3VwcygpO1xuICBpZiAoIWdyb3Vwcy5sZW5ndGgpIHtcbiAgICB2b2lkIHZzY29kZS53aW5kb3cuc2hvd0luZm9ybWF0aW9uTWVzc2FnZSgnUERGIEh1YjogdGhlcmUgYXJlIG5vIGZhdm9yaXRlcyBncm91cHMgeWV0LicpO1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbiAgY29uc3QgcGlja2VkID0gYXdhaXQgdnNjb2RlLndpbmRvdy5zaG93UXVpY2tQaWNrKFxuICAgIGdyb3Vwcy5tYXAoKGdyb3VwKSA9PiAoeyBsYWJlbDogZ3JvdXAubmFtZSwgZGVzY3JpcHRpb246IGAke2dyb3VwLmZpbGVzLmxlbmd0aH0gZmlsZShzKWAsIGlkOiBncm91cC5pZCB9KSksXG4gICAgeyB0aXRsZTogJ1BpY2sgYSBmYXZvcml0ZXMgZ3JvdXAnIH1cbiAgKTtcbiAgcmV0dXJuIHBpY2tlZCA/IHN0b3JlLmdldEdyb3VwKHBpY2tlZC5pZCkgOiB1bmRlZmluZWQ7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZW1vdmVGcm9tRmF2b3JpdGVzKHN0b3JlOiBTdG9yZSwgdXJpPzogdnNjb2RlLlVyaSk6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCB0YXJnZXRzID0gdXJpID8gW3RvRmlsZVJlZih1cmkuZnNQYXRoKV0gOiByZXNvbHZlVGFyZ2V0RmlsZXModW5kZWZpbmVkKTtcbiAgbGV0IHJlbW92ZWQgPSAwO1xuICBmb3IgKGNvbnN0IGZpbGUgb2YgdGFyZ2V0cykge1xuICAgIGlmIChzdG9yZS5yZW1vdmVGYXZvcml0ZShmaWxlLnBhdGgpKSB7XG4gICAgICByZW1vdmVkICs9IDE7XG4gICAgfVxuICAgIGlmIChzdG9yZS5yZW1vdmVFeHRlcm5hbChmaWxlLnBhdGgpKSB7XG4gICAgICByZW1vdmVkICs9IDE7XG4gICAgfVxuICB9XG4gIGlmIChyZW1vdmVkID09PSAwKSB7XG4gICAgdm9pZCB2c2NvZGUud2luZG93LnNob3dJbmZvcm1hdGlvbk1lc3NhZ2UoJ1BERiBIdWI6IHRoYXQgZmlsZSBpcyBub3QgYSBmYXZvcml0ZS4nKTtcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gcmVnaXN0ZXJDb21tYW5kcyhcbiAgY29udGV4dDogdnNjb2RlLkV4dGVuc2lvbkNvbnRleHQsXG4gIHN0b3JlOiBTdG9yZSxcbiAgc2VydmljZTogUGRmU2VhcmNoU2VydmljZSxcbiAgZm9jdXM6ICgpID0+IFByb21pc2U8dm9pZD5cbik6IHZvaWQge1xuICBjb25zdCByZWdpc3RlciA9IChpZDogc3RyaW5nLCBoYW5kbGVyOiAoLi4uYXJnczogbmV2ZXJbXSkgPT4gdW5rbm93bik6IHZvaWQgPT4ge1xuICAgIGNvbnRleHQuc3Vic2NyaXB0aW9ucy5wdXNoKHZzY29kZS5jb21tYW5kcy5yZWdpc3RlckNvbW1hbmQoaWQsIGhhbmRsZXIgYXMgKC4uLmFyZ3M6IHVua25vd25bXSkgPT4gdW5rbm93bikpO1xuICB9O1xuXG4gIHJlZ2lzdGVyKCdwZGZIdWIuZm9jdXMnLCAoKSA9PiBmb2N1cygpKTtcbiAgcmVnaXN0ZXIoJ3BkZkh1Yi5hZGRUb0Zhdm9yaXRlcycsICh1cmk/OiB2c2NvZGUuVXJpKSA9PiBhZGRUb0Zhdm9yaXRlcyhzdG9yZSwgdXJpID8gW3VyaV0gOiB1bmRlZmluZWQpKTtcbiAgcmVnaXN0ZXIoJ3BkZkh1Yi5hZGRTZWxlY3Rpb25Ub0Zhdm9yaXRlcycsICh1cmk/OiB2c2NvZGUuVXJpKSA9PiBhZGRUb0Zhdm9yaXRlcyhzdG9yZSwgdXJpID8gW3VyaV0gOiB1bmRlZmluZWQpKTtcbiAgcmVnaXN0ZXIoJ3BkZkh1Yi5yZW1vdmVGcm9tRmF2b3JpdGVzJywgKHVyaT86IHZzY29kZS5VcmkpID0+IHJlbW92ZUZyb21GYXZvcml0ZXMoc3RvcmUsIHVyaSkpO1xuICByZWdpc3RlcigncGRmSHViLmNyZWF0ZUdyb3VwJywgKCkgPT4gY3JlYXRlR3JvdXAoc3RvcmUpKTtcbiAgcmVnaXN0ZXIoJ3BkZkh1Yi5yZW5hbWVHcm91cCcsIChncm91cElkPzogc3RyaW5nKSA9PiByZW5hbWVHcm91cChzdG9yZSwgZ3JvdXBJZCkpO1xuICByZWdpc3RlcigncGRmSHViLmRlbGV0ZUdyb3VwJywgKGdyb3VwSWQ/OiBzdHJpbmcpID0+IGRlbGV0ZUdyb3VwKHN0b3JlLCBncm91cElkKSk7XG4gIHJlZ2lzdGVyKCdwZGZIdWIuYWRkRXh0ZXJuYWxGaWxlJywgKCkgPT4gcGlja0V4dGVybmFsRmlsZXMoc3RvcmUpKTtcbiAgcmVnaXN0ZXIoJ3BkZkh1Yi5jbGVhclJlY2VudHMnLCAoKSA9PiB7XG4gICAgc3RvcmUuY2xlYXJSZWNlbnRzKCk7XG4gICAgdm9pZCB2c2NvZGUud2luZG93LnNldFN0YXR1c0Jhck1lc3NhZ2UoJ1BERiBIdWI6IHJlY2VudCBmaWxlcyBjbGVhcmVkJywgMzAwMCk7XG4gIH0pO1xuICByZWdpc3RlcigncGRmSHViLnJlaW5kZXgnLCBhc3luYyAoKSA9PiB7XG4gICAgLy8gQSByZWJ1aWxkIGRyb3BzIHRoZSBwZXJzaXN0ZWQgY2FjaGUgYW5kIHJlLWV4dHJhY3RzIGV2ZXJ5dGhpbmcsIHdoaWNoIGlzXG4gICAgLy8gdGhlIGVzY2FwZSBoYXRjaCB3aGVuIGFuIGluZGV4IGxvb2tzIHN0YWxlLlxuICAgIGF3YWl0IHNlcnZpY2UucmVzZXRJbmRleCgpO1xuICAgIGF3YWl0IHZzY29kZS53aW5kb3cud2l0aFByb2dyZXNzKFxuICAgICAgeyBsb2NhdGlvbjogdnNjb2RlLlByb2dyZXNzTG9jYXRpb24uTm90aWZpY2F0aW9uLCB0aXRsZTogJ1BERiBIdWI6IHJlYnVpbGRpbmcgUERGIGluZGV4JyB9LFxuICAgICAgYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCBzZXJ2aWNlLmVuc3VyZUluZGV4KCk7XG4gICAgICB9XG4gICAgKTtcbiAgICB2b2lkIHZzY29kZS53aW5kb3cuc2hvd0luZm9ybWF0aW9uTWVzc2FnZSgnUERGIEh1YjogUERGIGluZGV4IHJlYnVpbHQuJyk7XG4gIH0pO1xufVxuXG5leHBvcnQgeyBFWFRFUk5BTF9TRU5USU5FTCB9O1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHNtYXJ0IGdyb3Vwc1xuXG5jb25zdCBTTUFSVF9QUkVTRVRTOiB7XG4gIGxhYmVsOiBzdHJpbmc7XG4gIGRldGFpbDogc3RyaW5nO1xuICBuYW1lOiBzdHJpbmc7XG4gIGNvbmRpdGlvbnM6IFJ1bGVDb25kaXRpb25zO1xufVtdID0gW1xuICB7XG4gICAgbGFiZWw6ICckKGZpbGUtcGRmKSBBbGwgUERGcycsXG4gICAgZGV0YWlsOiAnKiovKi5wZGYnLFxuICAgIG5hbWU6ICdBbGwgUERGcycsXG4gICAgY29uZGl0aW9uczogeyBleHRlbnNpb25zOiBbJ3BkZiddIH0sXG4gIH0sXG4gIHtcbiAgICBsYWJlbDogJyQoZmlsZS1tZWRpYSkgUmVjZW50IFBERnMnLFxuICAgIGRldGFpbDogJ2NoYW5nZWQgaW4gdGhlIGxhc3QgMzAgZGF5cycsXG4gICAgbmFtZTogJ1JlY2VudCBQREZzJyxcbiAgICBjb25kaXRpb25zOiB7IGV4dGVuc2lvbnM6IFsncGRmJ10sIG1vZGlmaWVkV2l0aGluRGF5czogMzAgfSxcbiAgfSxcbiAge1xuICAgIGxhYmVsOiAnJChtYXJrZG93bikgTWFya2Rvd24gbm90ZXMnLFxuICAgIGRldGFpbDogJyoqLyoubWQnLFxuICAgIG5hbWU6ICdNYXJrZG93biBub3RlcycsXG4gICAgY29uZGl0aW9uczogeyBleHRlbnNpb25zOiBbJ21kJ10gfSxcbiAgfSxcbiAge1xuICAgIGxhYmVsOiAnJChjYWxlbmRhcikgQ2hhbmdlZCB0aGlzIHdlZWsnLFxuICAgIGRldGFpbDogJ2FueSBmaWxlIG1vZGlmaWVkIGluIHRoZSBsYXN0IDcgZGF5cycsXG4gICAgbmFtZTogJ0NoYW5nZWQgdGhpcyB3ZWVrJyxcbiAgICBjb25kaXRpb25zOiB7IG1vZGlmaWVkV2l0aGluRGF5czogNyB9LFxuICB9LFxuICB7XG4gICAgbGFiZWw6ICckKGVkaXQpIEN1c3RvbSBwYXR0ZXJuLi4uJyxcbiAgICBkZXRhaWw6ICdFbnRlciB5b3VyIG93biBnbG9iLCBleHRlbnNpb24gb3IgZGF0ZSBydWxlJyxcbiAgICBuYW1lOiAnJyxcbiAgICBjb25kaXRpb25zOiB7fSxcbiAgfSxcbl07XG5cbi8qKiBHdWlkZWQgYnVpbGRlciBmb3IgYSBzbWFydCBncm91cCwgd2l0aCB2YWxpZGF0aW9uIGZlZWRiYWNrLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNyZWF0ZVNtYXJ0R3JvdXAoc3RvcmU6IFN0b3JlKTogUHJvbWlzZTxTbWFydFJ1bGUgfCB1bmRlZmluZWQ+IHtcbiAgY29uc3QgcHJlc2V0ID0gYXdhaXQgdnNjb2RlLndpbmRvdy5zaG93UXVpY2tQaWNrKFxuICAgIFNNQVJUX1BSRVNFVFMubWFwKChlbnRyeSkgPT4gKHsgbGFiZWw6IGVudHJ5LmxhYmVsLCBkZXRhaWw6IGVudHJ5LmRldGFpbCwgcHJlc2V0OiBlbnRyeSB9KSksXG4gICAgeyB0aXRsZTogJ05ldyBzbWFydCBncm91cCcsIHBsYWNlSG9sZGVyOiAnV2hhdCBzaG91bGQgaXQgY29sbGVjdD8nIH1cbiAgKTtcbiAgaWYgKCFwcmVzZXQpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG5cbiAgbGV0IG5hbWUgPSBwcmVzZXQucHJlc2V0Lm5hbWU7XG4gIGxldCBjb25kaXRpb25zOiBSdWxlQ29uZGl0aW9ucyA9IHsgLi4ucHJlc2V0LnByZXNldC5jb25kaXRpb25zIH07XG5cbiAgaWYgKCFuYW1lKSB7XG4gICAgY29uc3QgcGF0dGVybiA9IGF3YWl0IHZzY29kZS53aW5kb3cuc2hvd0lucHV0Qm94KHtcbiAgICAgIHRpdGxlOiAnTmV3IHNtYXJ0IGdyb3VwJyxcbiAgICAgIHByb21wdDogJ0dsb2IgcGF0dGVybiwgZm9yIGV4YW1wbGUgKi5wZGYsIGRvY3MvKiogb3IgaW52b2ljZS0qJyxcbiAgICAgIHBsYWNlSG9sZGVyOiAnKiovKi5wZGYnLFxuICAgICAgdmFsaWRhdGVJbnB1dDogKHZhbHVlKSA9PiAodmFsdWUudHJpbSgpID8gdW5kZWZpbmVkIDogJ0EgcGF0dGVybiBpcyByZXF1aXJlZCcpLFxuICAgIH0pO1xuICAgIGlmIChwYXR0ZXJuID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICAgIGNvbmRpdGlvbnMgPSB7IGluY2x1ZGVHbG9iczogW3BhdHRlcm4udHJpbSgpXSB9O1xuICAgIG5hbWUgPSBwYXR0ZXJuLnRyaW0oKTtcbiAgfVxuXG4gIGNvbnN0IGZpbmFsTmFtZSA9IGF3YWl0IHZzY29kZS53aW5kb3cuc2hvd0lucHV0Qm94KHtcbiAgICB0aXRsZTogJ05hbWUgdGhpcyBzbWFydCBncm91cCcsXG4gICAgdmFsdWU6IG5hbWUsXG4gICAgcHJvbXB0OiAnU2hvd24gYXMgYSBzZWN0aW9uIGluIHRoZSBzaWRlYmFyJyxcbiAgICB2YWxpZGF0ZUlucHV0OiAodmFsdWUpID0+ICh2YWx1ZS50cmltKCkgPyB1bmRlZmluZWQgOiAnQSBuYW1lIGlzIHJlcXVpcmVkJyksXG4gIH0pO1xuICBpZiAoZmluYWxOYW1lID09PSB1bmRlZmluZWQpIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkO1xuICB9XG5cbiAgY29uc3QgcnVsZSA9IHN0b3JlLmNyZWF0ZVNtYXJ0R3JvdXAoZmluYWxOYW1lLCBjb25kaXRpb25zKTtcbiAgY29uc3QgcHJvYmxlbXMgPSB2YWxpZGF0ZVJ1bGUocnVsZSk7XG4gIGlmIChwcm9ibGVtcy5sZW5ndGgpIHtcbiAgICB2b2lkIHZzY29kZS53aW5kb3cuc2hvd1dhcm5pbmdNZXNzYWdlKGBQREYgSHViOiAke3Byb2JsZW1zWzBdfWApO1xuICAgIHJldHVybiBydWxlO1xuICB9XG4gIHZvaWQgdnNjb2RlLndpbmRvdy5zZXRTdGF0dXNCYXJNZXNzYWdlKGBQREYgSHViOiBzbWFydCBncm91cCBcIiR7cnVsZS5uYW1lfVwiIGFkZGVkYCwgNDAwMCk7XG4gIHJldHVybiBydWxlO1xufVxuXG4vKiogRWRpdHMgYW4gZXhpc3Rpbmcgc21hcnQgZ3JvdXAncyBwYXR0ZXJuLCBvciB0b2dnbGVzIGl0IG9uL29mZi4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBlZGl0U21hcnRHcm91cChzdG9yZTogU3RvcmUsIGdyb3VwSWQ/OiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3QgcnVsZXMgPSBzdG9yZS5nZXRTbWFydEdyb3VwcygpO1xuICBpZiAoIXJ1bGVzLmxlbmd0aCkge1xuICAgIHZvaWQgdnNjb2RlLndpbmRvdy5zaG93SW5mb3JtYXRpb25NZXNzYWdlKCdQREYgSHViOiB0aGVyZSBhcmUgbm8gc21hcnQgZ3JvdXBzIHlldC4nKTtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgcnVsZSA9IGdyb3VwSWQgPyBzdG9yZS5nZXRTbWFydEdyb3VwKGdyb3VwSWQpIDogdW5kZWZpbmVkO1xuICBjb25zdCBjaG9zZW4gPVxuICAgIHJ1bGUgPz9cbiAgICAoYXdhaXQgdnNjb2RlLndpbmRvd1xuICAgICAgLnNob3dRdWlja1BpY2soXG4gICAgICAgIHJ1bGVzLm1hcCgoZW50cnkpID0+ICh7IGxhYmVsOiBlbnRyeS5uYW1lLCBkZXNjcmlwdGlvbjogZGVzY3JpYmVSdWxlKGVudHJ5KSwgaWQ6IGVudHJ5LmlkIH0pKSxcbiAgICAgICAgeyB0aXRsZTogJ0VkaXQgc21hcnQgZ3JvdXAnIH1cbiAgICAgIClcbiAgICAgIC50aGVuKChwaWNrZWQpID0+IChwaWNrZWQgPyBzdG9yZS5nZXRTbWFydEdyb3VwKHBpY2tlZC5pZCkgOiB1bmRlZmluZWQpKSk7XG4gIGlmICghY2hvc2VuKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgY29uc3QgYWN0aW9uID0gYXdhaXQgdnNjb2RlLndpbmRvdy5zaG93UXVpY2tQaWNrKFxuICAgIFtcbiAgICAgIHsgbGFiZWw6ICckKGVkaXQpIENoYW5nZSBwYXR0ZXJuJywgaWQ6ICdwYXR0ZXJuJyB9LFxuICAgICAgeyBsYWJlbDogJyQoY2hlY2spIFJlcXVpcmUgYWxsIGNvbmRpdGlvbnMnLCBpZDogJ21vZGUtYWxsJyB9LFxuICAgICAgeyBsYWJlbDogJyQobGlzdC1vcmRlcmVkKSBNYXRjaCBhbnkgY29uZGl0aW9uJywgaWQ6ICdtb2RlLWFueScgfSxcbiAgICAgIGNob3Nlbi5lbmFibGVkID8geyBsYWJlbDogJyQoY2lyY2xlLXNsYXNoKSBEaXNhYmxlJywgaWQ6ICdkaXNhYmxlJyB9IDogeyBsYWJlbDogJyQocGxheSkgRW5hYmxlJywgaWQ6ICdlbmFibGUnIH0sXG4gICAgICB7IGxhYmVsOiAnJCh0cmFzaCkgRGVsZXRlJywgaWQ6ICdkZWxldGUnIH0sXG4gICAgXSxcbiAgICB7IHRpdGxlOiBjaG9zZW4ubmFtZSB9XG4gICk7XG4gIGlmICghYWN0aW9uKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgc3dpdGNoIChhY3Rpb24uaWQpIHtcbiAgICBjYXNlICdwYXR0ZXJuJzoge1xuICAgICAgY29uc3QgdmFsdWUgPSBhd2FpdCB2c2NvZGUud2luZG93LnNob3dJbnB1dEJveCh7XG4gICAgICAgIHRpdGxlOiBgUGF0dGVybiBmb3IgXCIke2Nob3Nlbi5uYW1lfVwiYCxcbiAgICAgICAgdmFsdWU6IChjaG9zZW4uY29uZGl0aW9ucy5pbmNsdWRlR2xvYnMgPz8gW10pLmpvaW4oJywgJyksXG4gICAgICAgIHByb21wdDogJ0NvbW1hLXNlcGFyYXRlZCBnbG9icywgZm9yIGV4YW1wbGUgKi5wZGYsIGRvY3MvKionLFxuICAgICAgfSk7XG4gICAgICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBjb25zdCBnbG9icyA9IHZhbHVlXG4gICAgICAgIC5zcGxpdCgnLCcpXG4gICAgICAgIC5tYXAoKGVudHJ5KSA9PiBlbnRyeS50cmltKCkpXG4gICAgICAgIC5maWx0ZXIoQm9vbGVhbik7XG4gICAgICBzdG9yZS51cGRhdGVTbWFydEdyb3VwKGNob3Nlbi5pZCwgeyBjb25kaXRpb25zOiB7IC4uLmNob3Nlbi5jb25kaXRpb25zLCBpbmNsdWRlR2xvYnM6IGdsb2JzIH0gfSk7XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgY2FzZSAnbW9kZS1hbGwnOlxuICAgICAgc3RvcmUudXBkYXRlU21hcnRHcm91cChjaG9zZW4uaWQsIHsgbWF0Y2hNb2RlOiAnYWxsJyB9KTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ21vZGUtYW55JzpcbiAgICAgIHN0b3JlLnVwZGF0ZVNtYXJ0R3JvdXAoY2hvc2VuLmlkLCB7IG1hdGNoTW9kZTogJ2FueScgfSk7XG4gICAgICBicmVhaztcbiAgICBjYXNlICdkaXNhYmxlJzpcbiAgICAgIHN0b3JlLnVwZGF0ZVNtYXJ0R3JvdXAoY2hvc2VuLmlkLCB7IGVuYWJsZWQ6IGZhbHNlIH0pO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnZW5hYmxlJzpcbiAgICAgIHN0b3JlLnVwZGF0ZVNtYXJ0R3JvdXAoY2hvc2VuLmlkLCB7IGVuYWJsZWQ6IHRydWUgfSk7XG4gICAgICBicmVhaztcbiAgICBjYXNlICdkZWxldGUnOlxuICAgICAgYXdhaXQgZGVsZXRlU21hcnRHcm91cChzdG9yZSwgY2hvc2VuLmlkKTtcbiAgICAgIHJldHVybjtcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuO1xuICB9XG4gIHZvaWQgdnNjb2RlLndpbmRvdy5zZXRTdGF0dXNCYXJNZXNzYWdlKGBQREYgSHViOiB1cGRhdGVkIFwiJHtjaG9zZW4ubmFtZX1cImAsIDMwMDApO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZGVsZXRlU21hcnRHcm91cChzdG9yZTogU3RvcmUsIGdyb3VwSWQ/OiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3QgcnVsZSA9IGdyb3VwSWQgPyBzdG9yZS5nZXRTbWFydEdyb3VwKGdyb3VwSWQpIDogdW5kZWZpbmVkO1xuICBpZiAoIXJ1bGUpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgY29uc3QgY29uZmlybWVkID0gYXdhaXQgdnNjb2RlLndpbmRvdy5zaG93V2FybmluZ01lc3NhZ2UoXG4gICAgYERlbGV0ZSB0aGUgc21hcnQgZ3JvdXAgXCIke3J1bGUubmFtZX1cIj9gLFxuICAgIHsgbW9kYWw6IHRydWUgfSxcbiAgICAnRGVsZXRlJ1xuICApO1xuICBpZiAoY29uZmlybWVkID09PSAnRGVsZXRlJykge1xuICAgIHN0b3JlLnJlbW92ZVNtYXJ0R3JvdXAocnVsZS5pZCk7XG4gIH1cbn1cblxuZXhwb3J0IGludGVyZmFjZSBTbWFydEdyb3VwSG9va3Mge1xuICByZWZyZXNoOiAoKSA9PiBQcm9taXNlPHZvaWQ+O1xuICByZWluZGV4OiAoKSA9PiBQcm9taXNlPHZvaWQ+O1xufVxuXG4vKiogUmVnaXN0ZXJzIHRoZSBzbWFydC1ncm91cCBjb21tYW5kcy4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZWdpc3RlclNtYXJ0R3JvdXBDb21tYW5kcyhcbiAgY29udGV4dDogdnNjb2RlLkV4dGVuc2lvbkNvbnRleHQsXG4gIHN0b3JlOiBTdG9yZSxcbiAgaG9va3M6IFNtYXJ0R3JvdXBIb29rc1xuKTogdm9pZCB7XG4gIGNvbnN0IHJlZ2lzdGVyID0gKGlkOiBzdHJpbmcsIGhhbmRsZXI6ICguLi5hcmdzOiBuZXZlcltdKSA9PiB1bmtub3duKTogdm9pZCA9PiB7XG4gICAgY29udGV4dC5zdWJzY3JpcHRpb25zLnB1c2goXG4gICAgICB2c2NvZGUuY29tbWFuZHMucmVnaXN0ZXJDb21tYW5kKGlkLCBoYW5kbGVyIGFzICguLi5hcmdzOiB1bmtub3duW10pID0+IHVua25vd24pXG4gICAgKTtcbiAgfTtcblxuICByZWdpc3RlcigncGRmSHViLmNyZWF0ZVNtYXJ0R3JvdXAnLCBhc3luYyAoKSA9PiB7XG4gICAgYXdhaXQgY3JlYXRlU21hcnRHcm91cChzdG9yZSk7XG4gICAgYXdhaXQgaG9va3MucmVmcmVzaCgpO1xuICB9KTtcbiAgcmVnaXN0ZXIoJ3BkZkh1Yi5lZGl0U21hcnRHcm91cCcsIGFzeW5jIChncm91cElkPzogc3RyaW5nKSA9PiB7XG4gICAgYXdhaXQgZWRpdFNtYXJ0R3JvdXAoc3RvcmUsIGdyb3VwSWQpO1xuICAgIGF3YWl0IGhvb2tzLnJlZnJlc2goKTtcbiAgfSk7XG4gIHJlZ2lzdGVyKCdwZGZIdWIuZGVsZXRlU21hcnRHcm91cCcsIGFzeW5jIChncm91cElkPzogc3RyaW5nKSA9PiB7XG4gICAgYXdhaXQgZGVsZXRlU21hcnRHcm91cChzdG9yZSwgZ3JvdXBJZCk7XG4gICAgYXdhaXQgaG9va3MucmVmcmVzaCgpO1xuICB9KTtcbiAgcmVnaXN0ZXIoJ3BkZkh1Yi5yZWZyZXNoU21hcnRHcm91cHMnLCBhc3luYyAoKSA9PiB7XG4gICAgYXdhaXQgaG9va3MucmVmcmVzaCgpO1xuICB9KTtcbiAgcmVnaXN0ZXIoJ3BkZkh1Yi50b2dnbGVTbWFydEdyb3VwJywgYXN5bmMgKGdyb3VwSWQ6IHN0cmluZykgPT4ge1xuICAgIGNvbnN0IHJ1bGUgPSBzdG9yZS5nZXRTbWFydEdyb3VwKGdyb3VwSWQpO1xuICAgIGlmIChydWxlKSB7XG4gICAgICBzdG9yZS51cGRhdGVTbWFydEdyb3VwKGdyb3VwSWQsIHsgZW5hYmxlZDogIXJ1bGUuZW5hYmxlZCB9KTtcbiAgICAgIGF3YWl0IGhvb2tzLnJlZnJlc2goKTtcbiAgICB9XG4gIH0pO1xufVxuIiwgImltcG9ydCAqIGFzIHZzY29kZSBmcm9tICd2c2NvZGUnO1xuaW1wb3J0IHR5cGUgeyBGaWxlUmVmIH0gZnJvbSAnLi90eXBlcy50cyc7XG5cbi8qKlxuICogQnVpbGRzIGEgYEZpbGVSZWZgIGZvciBhIGZpbGVzeXN0ZW0gcGF0aCwgcmVzb2x2aW5nIGl0cyB3b3Jrc3BhY2UgZm9sZGVyLlxuICpcbiAqIExpdmVzIG91dHNpZGUgYHR5cGVzLnRzYCBzbyB0aGUgdHlwZSBtb2R1bGUgc3RheXMgZnJlZSBvZiB0aGUgYHZzY29kZWBcbiAqIGltcG9ydCBhbmQgY2FuIGJlIGxvYWRlZCBieSB0aGUgdW5pdCB0ZXN0cy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHRvRmlsZVJlZihmc1BhdGg6IHN0cmluZyk6IEZpbGVSZWYge1xuICBjb25zdCBub3JtYWxpemVkID0gdnNjb2RlLlVyaS5maWxlKGZzUGF0aCkuZnNQYXRoO1xuICBjb25zdCBuYW1lID0gbm9ybWFsaXplZC5yZXBsYWNlKC9cXFxcL2csICcvJykuc3BsaXQoJy8nKS5wb3AoKSA/PyBub3JtYWxpemVkO1xuICBjb25zdCBmb2xkZXIgPSB2c2NvZGUud29ya3NwYWNlLmdldFdvcmtzcGFjZUZvbGRlcih2c2NvZGUuVXJpLmZpbGUobm9ybWFsaXplZCkpO1xuICBpZiAoIWZvbGRlcikge1xuICAgIHJldHVybiB7IHBhdGg6IG5vcm1hbGl6ZWQsIG5hbWUsIGV4dGVybmFsOiB0cnVlIH07XG4gIH1cbiAgcmV0dXJuIHtcbiAgICBwYXRoOiBub3JtYWxpemVkLFxuICAgIG5hbWUsXG4gICAgcmVsYXRpdmVQYXRoOiB2c2NvZGUud29ya3NwYWNlLmFzUmVsYXRpdmVQYXRoKHZzY29kZS5VcmkuZmlsZShub3JtYWxpemVkKSwgZmFsc2UpLFxuICAgIGZvbGRlck5hbWU6IGZvbGRlci5uYW1lLFxuICAgIGV4dGVybmFsOiBmYWxzZSxcbiAgfTtcbn1cbiIsICIvKipcbiAqIFBlcnNpc3RlbnQsIGluY3JlbWVudGFsIFBERiB0ZXh0IGluZGV4LlxuICpcbiAqIERlc2lnbiBnb2FsczpcbiAqICAtIHN1cnZpdmUgd2luZG93IHJlbG9hZHMsIHNvIG9wZW5pbmcgVlMgQ29kZSBkb2VzIG5vdCByZS1leHRyYWN0IGFueXRoaW5nXG4gKiAgICB0aGF0IGhhcyBub3QgY2hhbmdlZCxcbiAqICAtIGJlIGNoZWFwIHRvIHVwZGF0ZTogb25lIGBzdGF0YCBwZXIgZmlsZSBkZWNpZGVzIHdoZXRoZXIgZXh0cmFjdGlvbiBydW5zLFxuICogIC0gc3RheSBib3VuZGVkOiBvdmVyc2l6ZWQgY29ycG9yYSBldmljdCBsZWFzdC1yZWNlbnRseS11c2VkIGVudHJpZXMsXG4gKiAgLSBiZSB0ZXN0YWJsZTogc3RvcmFnZSBhbmQgaGFzaGluZyBhcmUgaW5qZWN0ZWQsIHNvIHRlc3RzIHJ1biBvbiB0aGUgcmVhbFxuICogICAgaW1wbGVtZW50YXRpb24gd2l0aCBhIHRlbXBvcmFyeSBkaXJlY3RvcnkuXG4gKi9cblxuZXhwb3J0IGNvbnN0IElOREVYX0ZPUk1BVF9WRVJTSU9OID0gMjtcblxuZXhwb3J0IGludGVyZmFjZSBJbmRleEVudHJ5IHtcbiAgLyoqIEFic29sdXRlIGZpbGUgcGF0aCwgc2xhc2gtbm9ybWFsaXplZC4gKi9cbiAgcGF0aDogc3RyaW5nO1xuICAvKiogTW9kaWZpY2F0aW9uIHRpbWUgYW5kIHNpemUgdXNlZCBmb3IgY2FjaGUgdmFsaWRhdGlvbi4gKi9cbiAgbXRpbWVNczogbnVtYmVyO1xuICBzaXplOiBudW1iZXI7XG4gIHBhZ2VzOiBudW1iZXI7XG4gIC8qKiBFeHRyYWN0ZWQgdGV4dCwgb25lIHN0cmluZyBwZXIgcGFnZS4gKi9cbiAgdGV4dDogc3RyaW5nW107XG4gIC8qKiBMb3dlci1jYXNlZCB0d2luIG9mIGB0ZXh0YCwga2VwdCBmb3IgZmFzdCBjYXNlLWluc2Vuc2l0aXZlIG1hdGNoaW5nLiAqL1xuICBsb3dlcjogc3RyaW5nW107XG4gIHRydW5jYXRlZDogYm9vbGVhbjtcbiAgLyoqIEVwb2NoIG1zIG9mIHRoZSBsYXN0IHRpbWUgdGhpcyBlbnRyeSB3YXMgcmVhZCBvciB3cml0dGVuLiAqL1xuICBsYXN0QWNjZXNzOiBudW1iZXI7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgSW5kZXhTbmFwc2hvdCB7XG4gIHZlcnNpb246IG51bWJlcjtcbiAgc2F2ZWRBdDogbnVtYmVyO1xuICBlbnRyaWVzOiBJbmRleEVudHJ5W107XG4gIHN0YXRzOiB7XG4gICAgLyoqIEJ5dGVzIG9mIFBERiBkYXRhIGNvdmVyZWQgYnkgdGhlIGluZGV4LiAqL1xuICAgIGJ5dGVzOiBudW1iZXI7XG4gICAgLyoqIEV4dHJhY3Rpb25zIHBlcmZvcm1lZCBzaW5jZSB0aGUgaW5kZXggd2FzIGNyZWF0ZWQuICovXG4gICAgZXh0cmFjdGlvbnM6IG51bWJlcjtcbiAgICAvKiogRXh0cmFjdGlvbnMgYXZvaWRlZCBiZWNhdXNlIHRoZSBjYWNoZSB3YXMgc3RpbGwgdmFsaWQuICovXG4gICAgY2FjaGVIaXRzOiBudW1iZXI7XG4gIH07XG59XG5cbi8qKiBNaW5pbWFsIHN0b3JhZ2UgY29udHJhY3Q7IHRoZSBleHRlbnNpb24gc3VwcGxpZXMgYSB3b3Jrc3BhY2UtZnMgaW1wbGVtZW50YXRpb24uICovXG5leHBvcnQgaW50ZXJmYWNlIEluZGV4U3RvcmFnZSB7XG4gIHJlYWQoKTogUHJvbWlzZTxzdHJpbmcgfCB1bmRlZmluZWQ+O1xuICB3cml0ZShjb250ZW50czogc3RyaW5nKTogUHJvbWlzZTx2b2lkPjtcbiAgZHJvcCgpOiBQcm9taXNlPHZvaWQ+O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEluZGV4TGltaXRzIHtcbiAgLyoqIE1heGltdW0gc2l6ZSBvZiB0aGUgc2VyaWFsaXplZCBpbmRleCBpbiBieXRlcy4gKi9cbiAgbWF4Qnl0ZXM6IG51bWJlcjtcbiAgLyoqIE1heGltdW0gZW50cmllcyBrZXB0IHJlZ2FyZGxlc3Mgb2Ygc2l6ZS4gKi9cbiAgbWF4RW50cmllczogbnVtYmVyO1xufVxuXG5leHBvcnQgY29uc3QgREVGQVVMVF9MSU1JVFM6IEluZGV4TGltaXRzID0ge1xuICBtYXhCeXRlczogMjQgKiAxMDI0ICogMTAyNCxcbiAgbWF4RW50cmllczogNDAwMCxcbn07XG5cbnR5cGUgQ2xvY2sgPSAoKSA9PiBudW1iZXI7XG5cbi8qKiBOb3JtYWxpemVzIGEgcGF0aCBzbyBjYWNoZSBrZXlzIGFyZSBzdGFibGUgYWNyb3NzIHBsYXRmb3Jtcy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpbmRleEtleShwYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gcGF0aC5yZXBsYWNlKC9cXFxcL2csICcvJyk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBlbXB0eVNuYXBzaG90KG5vdyA9IERhdGUubm93KCkpOiBJbmRleFNuYXBzaG90IHtcbiAgcmV0dXJuIHtcbiAgICB2ZXJzaW9uOiBJTkRFWF9GT1JNQVRfVkVSU0lPTixcbiAgICBzYXZlZEF0OiBub3csXG4gICAgZW50cmllczogW10sXG4gICAgc3RhdHM6IHsgYnl0ZXM6IDAsIGV4dHJhY3Rpb25zOiAwLCBjYWNoZUhpdHM6IDAgfSxcbiAgfTtcbn1cblxuLyoqIFRydWUgd2hlbiB0aGUgY2FjaGVkIGVudHJ5IHN0aWxsIGRlc2NyaWJlcyB0aGUgZmlsZSBleGFjdGx5LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzRW50cnlWYWxpZChcbiAgZW50cnk6IEluZGV4RW50cnkgfCB1bmRlZmluZWQsXG4gIHN0YXRzOiB7IG10aW1lTXM6IG51bWJlcjsgc2l6ZTogbnVtYmVyIH1cbik6IGJvb2xlYW4ge1xuICByZXR1cm4gQm9vbGVhbihlbnRyeSAmJiBlbnRyeS5tdGltZU1zID09PSBzdGF0cy5tdGltZU1zICYmIGVudHJ5LnNpemUgPT09IHN0YXRzLnNpemUpO1xufVxuXG4vKipcbiAqIFBhcnNlcyBhIHN0b3JlZCBzbmFwc2hvdCwgZGlzY2FyZGluZyBhbnl0aGluZyBtYWxmb3JtZWQuXG4gKlxuICogQSBjb3JydXB0IG9yIG9sZGVyIGluZGV4IG11c3QgZGVncmFkZSB0byBcIm5vIGNhY2hlXCIgcmF0aGVyIHRoYW4gdGhyb3dpbmcsXG4gKiBiZWNhdXNlIGl0IGlzIHJlYnVpbHQgYXV0b21hdGljYWxseS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlU25hcHNob3QocmF3OiBzdHJpbmcgfCB1bmRlZmluZWQsIG5vdyA9IERhdGUubm93KCkpOiBJbmRleFNuYXBzaG90IHtcbiAgaWYgKCFyYXcpIHtcbiAgICByZXR1cm4gZW1wdHlTbmFwc2hvdChub3cpO1xuICB9XG4gIGxldCBwYXJzZWQ6IHVua25vd247XG4gIHRyeSB7XG4gICAgcGFyc2VkID0gSlNPTi5wYXJzZShyYXcpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gZW1wdHlTbmFwc2hvdChub3cpO1xuICB9XG4gIGlmICghcGFyc2VkIHx8IHR5cGVvZiBwYXJzZWQgIT09ICdvYmplY3QnKSB7XG4gICAgcmV0dXJuIGVtcHR5U25hcHNob3Qobm93KTtcbiAgfVxuICBjb25zdCBjYW5kaWRhdGUgPSBwYXJzZWQgYXMgUGFydGlhbDxJbmRleFNuYXBzaG90PjtcbiAgaWYgKGNhbmRpZGF0ZS52ZXJzaW9uICE9PSBJTkRFWF9GT1JNQVRfVkVSU0lPTiB8fCAhQXJyYXkuaXNBcnJheShjYW5kaWRhdGUuZW50cmllcykpIHtcbiAgICByZXR1cm4gZW1wdHlTbmFwc2hvdChub3cpO1xuICB9XG5cbiAgY29uc3QgZW50cmllczogSW5kZXhFbnRyeVtdID0gW107XG4gIGZvciAoY29uc3QgZW50cnkgb2YgY2FuZGlkYXRlLmVudHJpZXMpIHtcbiAgICBpZiAoXG4gICAgICBlbnRyeSAmJlxuICAgICAgdHlwZW9mIGVudHJ5LnBhdGggPT09ICdzdHJpbmcnICYmXG4gICAgICB0eXBlb2YgZW50cnkubXRpbWVNcyA9PT0gJ251bWJlcicgJiZcbiAgICAgIHR5cGVvZiBlbnRyeS5zaXplID09PSAnbnVtYmVyJyAmJlxuICAgICAgQXJyYXkuaXNBcnJheShlbnRyeS50ZXh0KSAmJlxuICAgICAgZW50cnkudGV4dC5ldmVyeSgocGFnZSkgPT4gdHlwZW9mIHBhZ2UgPT09ICdzdHJpbmcnKVxuICAgICkge1xuICAgICAgY29uc3QgdGV4dCA9IGVudHJ5LnRleHQgYXMgc3RyaW5nW107XG4gICAgICBlbnRyaWVzLnB1c2goe1xuICAgICAgICBwYXRoOiBlbnRyeS5wYXRoLFxuICAgICAgICBtdGltZU1zOiBlbnRyeS5tdGltZU1zLFxuICAgICAgICBzaXplOiBlbnRyeS5zaXplLFxuICAgICAgICBwYWdlczogdHlwZW9mIGVudHJ5LnBhZ2VzID09PSAnbnVtYmVyJyA/IGVudHJ5LnBhZ2VzIDogdGV4dC5sZW5ndGgsXG4gICAgICAgIHRleHQsXG4gICAgICAgIC8vIE9sZGVyIHNuYXBzaG90cyBtYXkgcHJlZGF0ZSB0aGUgbG93ZXJjYXNlIGNhY2hlOyByZWJ1aWxkIG9uIGxvYWQuXG4gICAgICAgIGxvd2VyOiBBcnJheS5pc0FycmF5KGVudHJ5Lmxvd2VyKSAmJiBlbnRyeS5sb3dlci5sZW5ndGggPT09IHRleHQubGVuZ3RoXG4gICAgICAgICAgPyAoZW50cnkubG93ZXIgYXMgc3RyaW5nW10pXG4gICAgICAgICAgOiB0ZXh0Lm1hcCgocGFnZSkgPT4gcGFnZS50b0xvd2VyQ2FzZSgpKSxcbiAgICAgICAgdHJ1bmNhdGVkOiBCb29sZWFuKGVudHJ5LnRydW5jYXRlZCksXG4gICAgICAgIGxhc3RBY2Nlc3M6IHR5cGVvZiBlbnRyeS5sYXN0QWNjZXNzID09PSAnbnVtYmVyJyA/IGVudHJ5Lmxhc3RBY2Nlc3MgOiBjYW5kaWRhdGUuc2F2ZWRBdCA/PyBub3csXG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHZlcnNpb246IElOREVYX0ZPUk1BVF9WRVJTSU9OLFxuICAgIHNhdmVkQXQ6IHR5cGVvZiBjYW5kaWRhdGUuc2F2ZWRBdCA9PT0gJ251bWJlcicgPyBjYW5kaWRhdGUuc2F2ZWRBdCA6IG5vdyxcbiAgICBlbnRyaWVzLFxuICAgIHN0YXRzOiB7XG4gICAgICBieXRlczogY2FuZGlkYXRlLnN0YXRzPy5ieXRlcyA/PyAwLFxuICAgICAgZXh0cmFjdGlvbnM6IGNhbmRpZGF0ZS5zdGF0cz8uZXh0cmFjdGlvbnMgPz8gMCxcbiAgICAgIGNhY2hlSGl0czogY2FuZGlkYXRlLnN0YXRzPy5jYWNoZUhpdHMgPz8gMCxcbiAgICB9LFxuICB9O1xufVxuXG4vKiogU2VyaWFsaXplcyBhIHNuYXBzaG90LCBvcHRpb25hbGx5IGRyb3BwaW5nIGVudHJpZXMgdG8gcmVzcGVjdCBhIGJ5dGUgYnVkZ2V0LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNlcmlhbGl6ZVNuYXBzaG90KFxuICBzbmFwc2hvdDogSW5kZXhTbmFwc2hvdCxcbiAgbGltaXRzOiBJbmRleExpbWl0cyA9IERFRkFVTFRfTElNSVRTXG4pOiB7IGpzb246IHN0cmluZzsgZHJvcHBlZDogbnVtYmVyIH0ge1xuICBjb25zdCBieVJlY2VuY3kgPSBbLi4uc25hcHNob3QuZW50cmllc10uc29ydCgoYSwgYikgPT4gYi5sYXN0QWNjZXNzIC0gYS5sYXN0QWNjZXNzKTtcbiAgY29uc3Qga2VwdDogSW5kZXhFbnRyeVtdID0gW107XG4gIGxldCBkcm9wcGVkID0gMDtcblxuICAvLyBSb3VnaCBwZXItZW50cnkgb3ZlcmhlYWQgZm9yIHRoZSBKU09OIHNjYWZmb2xkaW5nIGFyb3VuZCB0aGUgdGV4dC5cbiAgY29uc3QgcGVyRW50cnlPdmVyaGVhZCA9IDIyMDtcbiAgbGV0IGJ5dGVzID0gMDtcblxuICBmb3IgKGNvbnN0IGVudHJ5IG9mIGJ5UmVjZW5jeSkge1xuICAgIGNvbnN0IGVudHJ5Qnl0ZXMgPVxuICAgICAgcGVyRW50cnlPdmVyaGVhZCArIGVudHJ5LnRleHQucmVkdWNlKCh0b3RhbCwgcGFnZSkgPT4gdG90YWwgKyBwYWdlLmxlbmd0aCAqIDIsIDApO1xuICAgIGNvbnN0IHdvdWxkRXhjZWVkID1cbiAgICAgIGtlcHQubGVuZ3RoID49IGxpbWl0cy5tYXhFbnRyaWVzIHx8IGJ5dGVzICsgZW50cnlCeXRlcyA+IGxpbWl0cy5tYXhCeXRlcztcbiAgICBpZiAod291bGRFeGNlZWQpIHtcbiAgICAgIGRyb3BwZWQgKz0gMTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBieXRlcyArPSBlbnRyeUJ5dGVzO1xuICAgIGtlcHQucHVzaChlbnRyeSk7XG4gIH1cblxuICAvLyBLZWVwIGEgc3RhYmxlLCByZWFkYWJsZSBvcmRlciBpbiB0aGUgZmlsZSBpdHNlbGYuXG4gIGtlcHQuc29ydCgoYSwgYikgPT4gaW5kZXhLZXkoYS5wYXRoKS5sb2NhbGVDb21wYXJlKGluZGV4S2V5KGIucGF0aCkpKTtcblxuICBjb25zdCBqc29uID0gSlNPTi5zdHJpbmdpZnkoe1xuICAgIHZlcnNpb246IElOREVYX0ZPUk1BVF9WRVJTSU9OLFxuICAgIHNhdmVkQXQ6IHNuYXBzaG90LnNhdmVkQXQsXG4gICAgc3RhdHM6IHNuYXBzaG90LnN0YXRzLFxuICAgIGVudHJpZXM6IGtlcHQsXG4gIH0pO1xuICByZXR1cm4geyBqc29uLCBkcm9wcGVkIH07XG59XG5cbi8qKlxuICogSW4tbWVtb3J5IGluZGV4IHdpdGggd3JpdGUtdGhyb3VnaCBwZXJzaXN0ZW5jZS5cbiAqXG4gKiBgc2F2ZSgpYCBpcyBkZWJvdW5jZWQgYnkgdGhlIGNhbGxlcjsgdGhpcyBjbGFzcyBvd25zIHZhbGlkYXRpb24sIGxvb2t1cCxcbiAqIGV2aWN0aW9uIGFjY291bnRpbmcgYW5kIHRoZSBvbi1kaXNrIHJvdW5kIHRyaXAuXG4gKi9cbmV4cG9ydCBjbGFzcyBQZGZJbmRleFN0b3JlIHtcbiAgcHJpdmF0ZSBlbnRyaWVzID0gbmV3IE1hcDxzdHJpbmcsIEluZGV4RW50cnk+KCk7XG4gIHByaXZhdGUgc3RhdHMgPSB7IGJ5dGVzOiAwLCBleHRyYWN0aW9uczogMCwgY2FjaGVIaXRzOiAwIH07XG4gIHByaXZhdGUgZGlydHkgPSBmYWxzZTtcblxuICBwcml2YXRlIHJlYWRvbmx5IHN0b3JhZ2U6IEluZGV4U3RvcmFnZTtcbiAgcHJpdmF0ZSByZWFkb25seSBsaW1pdHM6IEluZGV4TGltaXRzO1xuICBwcml2YXRlIHJlYWRvbmx5IG5vdzogQ2xvY2s7XG5cbiAgY29uc3RydWN0b3Ioc3RvcmFnZTogSW5kZXhTdG9yYWdlLCBsaW1pdHM6IEluZGV4TGltaXRzID0gREVGQVVMVF9MSU1JVFMsIG5vdzogQ2xvY2sgPSBEYXRlLm5vdykge1xuICAgIHRoaXMuc3RvcmFnZSA9IHN0b3JhZ2U7XG4gICAgdGhpcy5saW1pdHMgPSBsaW1pdHM7XG4gICAgdGhpcy5ub3cgPSBub3c7XG4gIH1cblxuICBnZXQgc2l6ZSgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLmVudHJpZXMuc2l6ZTtcbiAgfVxuXG4gIGdldCBpc0RpcnR5KCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiB0aGlzLmRpcnR5O1xuICB9XG5cbiAgZ2V0U3RhdHMoKTogSW5kZXhTbmFwc2hvdFsnc3RhdHMnXSB7XG4gICAgcmV0dXJuIHsgLi4udGhpcy5zdGF0cyB9O1xuICB9XG5cbiAgLyoqIExvYWRzIHRoZSBwZXJzaXN0ZWQgaW5kZXgsIHJlYnVpbGRpbmcgdGhlIGxvd2VyY2FzZSBjYWNoZSBpZiBuZWVkZWQuICovXG4gIGFzeW5jIGxvYWQoKTogUHJvbWlzZTx7IGVudHJpZXM6IG51bWJlcjsgZHJvcHBlZDogYm9vbGVhbiB9PiB7XG4gICAgY29uc3QgcmF3ID0gYXdhaXQgdGhpcy5zdG9yYWdlLnJlYWQoKTtcbiAgICBjb25zdCBzbmFwc2hvdCA9IHBhcnNlU25hcHNob3QocmF3LCB0aGlzLm5vdygpKTtcbiAgICB0aGlzLmVudHJpZXMgPSBuZXcgTWFwKHNuYXBzaG90LmVudHJpZXMubWFwKChlbnRyeSkgPT4gW2luZGV4S2V5KGVudHJ5LnBhdGgpLCBlbnRyeV0pKTtcbiAgICB0aGlzLnN0YXRzID0gc25hcHNob3Quc3RhdHM7XG4gICAgdGhpcy5kaXJ0eSA9IGZhbHNlO1xuICAgIHJldHVybiB7IGVudHJpZXM6IHRoaXMuZW50cmllcy5zaXplLCBkcm9wcGVkOiBCb29sZWFuKHJhdykgJiYgc25hcHNob3QuZW50cmllcy5sZW5ndGggPT09IDAgfTtcbiAgfVxuXG4gIGdldChwYXRoOiBzdHJpbmcpOiBJbmRleEVudHJ5IHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBlbnRyeSA9IHRoaXMuZW50cmllcy5nZXQoaW5kZXhLZXkocGF0aCkpO1xuICAgIGlmIChlbnRyeSkge1xuICAgICAgZW50cnkubGFzdEFjY2VzcyA9IHRoaXMubm93KCk7XG4gICAgICB0aGlzLmRpcnR5ID0gdHJ1ZTtcbiAgICB9XG4gICAgcmV0dXJuIGVudHJ5O1xuICB9XG5cbiAgLyoqIExvb2tzIHVwIHdpdGhvdXQgdG91Y2hpbmcgdGhlIExSVSB0aW1lc3RhbXAuICovXG4gIHBlZWsocGF0aDogc3RyaW5nKTogSW5kZXhFbnRyeSB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIHRoaXMuZW50cmllcy5nZXQoaW5kZXhLZXkocGF0aCkpO1xuICB9XG5cbiAgLyoqIFJlY29yZHMgYSBjYWNoZSBoaXQgKGEgZmlsZSB0aGF0IGRpZCBub3QgbmVlZCByZS1leHRyYWN0aW9uKS4gKi9cbiAgbm90ZUNhY2hlSGl0KGJ5dGVzOiBudW1iZXIpOiB2b2lkIHtcbiAgICB0aGlzLnN0YXRzLmNhY2hlSGl0cyArPSAxO1xuICAgIHRoaXMuc3RhdHMuYnl0ZXMgKz0gYnl0ZXM7XG4gICAgdGhpcy5kaXJ0eSA9IHRydWU7XG4gIH1cblxuICBzZXQoZW50cnk6IE9taXQ8SW5kZXhFbnRyeSwgJ2xhc3RBY2Nlc3MnPik6IHZvaWQge1xuICAgIGNvbnN0IGtleSA9IGluZGV4S2V5KGVudHJ5LnBhdGgpO1xuICAgIHRoaXMuZW50cmllcy5zZXQoa2V5LCB7IC4uLmVudHJ5LCBwYXRoOiBrZXksIGxhc3RBY2Nlc3M6IHRoaXMubm93KCkgfSk7XG4gICAgdGhpcy5zdGF0cy5leHRyYWN0aW9ucyArPSAxO1xuICAgIHRoaXMuZGlydHkgPSB0cnVlO1xuICB9XG5cbiAgZGVsZXRlKHBhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIGNvbnN0IHJlbW92ZWQgPSB0aGlzLmVudHJpZXMuZGVsZXRlKGluZGV4S2V5KHBhdGgpKTtcbiAgICBpZiAocmVtb3ZlZCkge1xuICAgICAgdGhpcy5kaXJ0eSA9IHRydWU7XG4gICAgfVxuICAgIHJldHVybiByZW1vdmVkO1xuICB9XG5cbiAgY2xlYXIoKTogdm9pZCB7XG4gICAgdGhpcy5lbnRyaWVzLmNsZWFyKCk7XG4gICAgdGhpcy5zdGF0cyA9IHsgYnl0ZXM6IDAsIGV4dHJhY3Rpb25zOiAwLCBjYWNoZUhpdHM6IDAgfTtcbiAgICB0aGlzLmRpcnR5ID0gdHJ1ZTtcbiAgfVxuXG4gIC8qKiBEcm9wcyBlbnRyaWVzIGZvciBwYXRocyB0aGF0IGFyZSBubyBsb25nZXIgcGFydCBvZiB0aGUgd29ya3NwYWNlLiAqL1xuICByZXRhaW5Pbmx5KHBhdGhzOiBJdGVyYWJsZTxzdHJpbmc+KTogbnVtYmVyIHtcbiAgICBjb25zdCBrZWVwID0gbmV3IFNldChbLi4ucGF0aHNdLm1hcChpbmRleEtleSkpO1xuICAgIGxldCByZW1vdmVkID0gMDtcbiAgICBmb3IgKGNvbnN0IGtleSBvZiBbLi4udGhpcy5lbnRyaWVzLmtleXMoKV0pIHtcbiAgICAgIGlmICgha2VlcC5oYXMoa2V5KSkge1xuICAgICAgICB0aGlzLmVudHJpZXMuZGVsZXRlKGtleSk7XG4gICAgICAgIHJlbW92ZWQgKz0gMTtcbiAgICAgIH1cbiAgICB9XG4gICAgaWYgKHJlbW92ZWQpIHtcbiAgICAgIHRoaXMuZGlydHkgPSB0cnVlO1xuICAgIH1cbiAgICByZXR1cm4gcmVtb3ZlZDtcbiAgfVxuXG4gIHNuYXBzaG90KCk6IEluZGV4U25hcHNob3Qge1xuICAgIHJldHVybiB7XG4gICAgICB2ZXJzaW9uOiBJTkRFWF9GT1JNQVRfVkVSU0lPTixcbiAgICAgIHNhdmVkQXQ6IHRoaXMubm93KCksXG4gICAgICBlbnRyaWVzOiBbLi4udGhpcy5lbnRyaWVzLnZhbHVlcygpXSxcbiAgICAgIHN0YXRzOiB0aGlzLmdldFN0YXRzKCksXG4gICAgfTtcbiAgfVxuXG4gIC8qKiBQZXJzaXN0cyB0aGUgaW5kZXggaWYgaXQgY2hhbmdlZC4gUmV0dXJucyB3aGF0IGhhcHBlbmVkLCBmb3IgbG9nZ2luZy90ZXN0cy4gKi9cbiAgYXN5bmMgc2F2ZShmb3JjZSA9IGZhbHNlKTogUHJvbWlzZTx7IHNhdmVkOiBib29sZWFuOyBkcm9wcGVkOiBudW1iZXI7IGJ5dGVzOiBudW1iZXIgfT4ge1xuICAgIGlmICghdGhpcy5kaXJ0eSAmJiAhZm9yY2UpIHtcbiAgICAgIHJldHVybiB7IHNhdmVkOiBmYWxzZSwgZHJvcHBlZDogMCwgYnl0ZXM6IDAgfTtcbiAgICB9XG4gICAgY29uc3QgeyBqc29uLCBkcm9wcGVkIH0gPSBzZXJpYWxpemVTbmFwc2hvdCh0aGlzLnNuYXBzaG90KCksIHRoaXMubGltaXRzKTtcbiAgICBhd2FpdCB0aGlzLnN0b3JhZ2Uud3JpdGUoanNvbik7XG4gICAgdGhpcy5kaXJ0eSA9IGZhbHNlO1xuICAgIHJldHVybiB7IHNhdmVkOiB0cnVlLCBkcm9wcGVkLCBieXRlczoganNvbi5sZW5ndGggfTtcbiAgfVxuXG4gIGFzeW5jIGRyb3AoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5lbnRyaWVzLmNsZWFyKCk7XG4gICAgdGhpcy5zdGF0cyA9IHsgYnl0ZXM6IDAsIGV4dHJhY3Rpb25zOiAwLCBjYWNoZUhpdHM6IDAgfTtcbiAgICB0aGlzLmRpcnR5ID0gZmFsc2U7XG4gICAgYXdhaXQgdGhpcy5zdG9yYWdlLmRyb3AoKTtcbiAgfVxuXG4gIGRpc3Bvc2UoKTogdm9pZCB7XG4gICAgdGhpcy5lbnRyaWVzLmNsZWFyKCk7XG4gIH1cbn1cbiIsICJpbXBvcnQgKiBhcyB2c2NvZGUgZnJvbSAndnNjb2RlJztcbmltcG9ydCB0eXBlIHsgSW5kZXhDb25maWcsIEluZGV4RW52aXJvbm1lbnQsIEluZGV4UHJvZ3Jlc3MgfSBmcm9tICcuLi9pbmRleFNlcnZpY2UudHMnO1xuaW1wb3J0IHsgSW5kZXhTZXJ2aWNlIH0gZnJvbSAnLi4vaW5kZXhTZXJ2aWNlLnRzJztcbmltcG9ydCB0eXBlIHsgUGRmSW5kZXhTdG9yZSB9IGZyb20gJy4vaW5kZXhTdG9yZS50cyc7XG5pbXBvcnQgeyBtYXRjaFBhZ2VzLCByYW5rTmFtZU1hdGNoZXMsIHR5cGUgUGFnZU1hdGNoIH0gZnJvbSAnLi90ZXh0TWF0Y2gudHMnO1xuaW1wb3J0IHsgZmluZFBkZkZpbGVzSW5EaXJlY3RvcnkgfSBmcm9tICcuL3dvcmtzcGFjZUZpbGVzLnRzJztcbmltcG9ydCB7IHR5cGUgRmlsZVJlZiB9IGZyb20gJy4uL3R5cGVzLnRzJztcbmltcG9ydCB7IHRvRmlsZVJlZiB9IGZyb20gJy4uL2ZpbGVSZWYudHMnO1xuXG5leHBvcnQgdHlwZSBQZGZQYWdlTWF0Y2ggPSBQYWdlTWF0Y2g7XG5cbmV4cG9ydCBpbnRlcmZhY2UgUGRmQ29udGVudEhpdCB7XG4gIGZpbGU6IEZpbGVSZWY7XG4gIG1hdGNoQ291bnQ6IG51bWJlcjtcbiAgcGFnZXM6IG51bWJlcjtcbiAgbWF0Y2hlczogUGRmUGFnZU1hdGNoW107XG4gIC8qKiBTZXQgd2hlbiB0aGUgZmlsZSB3YXMgc2tpcHBlZCBvciBvbmx5IHBhcnRpYWxseSBpbmRleGVkLiAqL1xuICBub3RlPzogc3RyaW5nO1xufVxuXG4vKipcbiAqIFdoYXQgdGhlIHNpZGViYXIgbmVlZHMgdG8gcmVuZGVyIGluZGV4aW5nIHN0YXR1cy4gVGhlIHNlcnZpY2UgZm9sZHMgdGhlIHJhd1xuICogYEluZGV4UHJvZ3Jlc3NgICh3aGljaCBhbHNvIGNhcnJpZXMgZmFpbHVyZSBhbmQgc2tpcCBjb3VudHMpIGludG8gdGhpcy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBJbmRleFN1bW1hcnkge1xuICBwaGFzZTogSW5kZXhQcm9ncmVzc1sncGhhc2UnXTtcbiAgcHJvY2Vzc2VkOiBudW1iZXI7XG4gIHRvdGFsOiBudW1iZXI7XG4gIGN1cnJlbnRGaWxlPzogc3RyaW5nO1xuICBjYWNoZWQ6IG51bWJlcjtcbiAgZXh0cmFjdGVkOiBudW1iZXI7XG4gIHNraXBwZWQ6IG51bWJlcjtcbiAgZmFpbGVkOiBudW1iZXI7XG4gIGVsYXBzZWRNczogbnVtYmVyO1xuICBzdW1tYXJ5Pzogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFBkZlNlYXJjaERlcHMge1xuICAvKiogUGVyc2lzdGVudCwgaW5jcmVtZW50YWwgdGV4dCBpbmRleC4gKi9cbiAgc3RvcmU6IFBkZkluZGV4U3RvcmU7XG4gIC8qKiBGaWxlIHN5c3RlbSBhY2Nlc3MgZm9yIHRoZSBpbmRleGVyLiAqL1xuICBlbnZpcm9ubWVudDogSW5kZXhFbnZpcm9ubWVudDtcbiAgLyoqIEluZGV4aW5nIGxpbWl0cywgcmVhZCBmcm9tIHVzZXIgc2V0dGluZ3MuICovXG4gIGNvbmZpZzogKCkgPT4gSW5kZXhDb25maWc7XG59XG5cbmZ1bmN0aW9uIGNvbmZpZzxUPihrZXk6IHN0cmluZywgZmFsbGJhY2s6IFQpOiBUIHtcbiAgcmV0dXJuIHZzY29kZS53b3Jrc3BhY2UuZ2V0Q29uZmlndXJhdGlvbigncGRmSHViJykuZ2V0PFQ+KGtleSwgZmFsbGJhY2spO1xufVxuXG4vKiogYGZpbmRGaWxlc2AgdGFrZXMgYSBzaW5nbGUgR2xvYlBhdHRlcm4sIHNvIHNldmVyYWwgZXhjbHVkZXMgYmVjb21lIG9uZSBhbHRlcm5hdGlvbi4gKi9cbmZ1bmN0aW9uIHRvRXhjbHVkZUdsb2IocGF0dGVybnM6IHN0cmluZ1tdKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgY29uc3QgY2xlYW5lZCA9IHBhdHRlcm5zLm1hcCgocGF0dGVybikgPT4gcGF0dGVybi50cmltKCkpLmZpbHRlcihCb29sZWFuKTtcbiAgaWYgKCFjbGVhbmVkLmxlbmd0aCkge1xuICAgIHJldHVybiB1bmRlZmluZWQ7XG4gIH1cbiAgcmV0dXJuIGNsZWFuZWQubGVuZ3RoID09PSAxID8gY2xlYW5lZFswXSA6IGB7JHtjbGVhbmVkLmpvaW4oJywnKX19YDtcbn1cblxuLyoqXG4gKiBUdXJucyBleGNsdWRlIGdsb2JzIHN1Y2ggYXMgYCoqYCArIGAvbm9kZV9tb2R1bGVzLyoqYCBpbnRvIGRpcmVjdG9yeSBuYW1lcyBmb3JcbiAqIHRoZSBmaWxlc3lzdGVtIHdhbGsgZmFsbGJhY2ssIHdoaWNoIG9ubHkga25vd3MgaG93IHRvIHNraXAgd2hvbGUgZm9sZGVycy5cbiAqL1xuZnVuY3Rpb24gc2tpcE5hbWVzRnJvbUdsb2JzKHBhdHRlcm5zOiBzdHJpbmdbXSk6IFNldDxzdHJpbmc+IHtcbiAgY29uc3QgbmFtZXMgPSBuZXcgU2V0KFsnbm9kZV9tb2R1bGVzJywgJy5naXQnLCAnZGlzdCcsICdidWlsZCcsICdvdXQnLCAnLm5leHQnLCAnLnZlbnYnXSk7XG4gIGZvciAoY29uc3QgcGF0dGVybiBvZiBwYXR0ZXJucykge1xuICAgIGNvbnN0IG1hdGNoID0gL1xcKlxcKlxcLyhbXi8qXSspXFwvXFwqXFwqLy5leGVjKHBhdHRlcm4udHJpbSgpKTtcbiAgICBpZiAobWF0Y2gpIHtcbiAgICAgIG5hbWVzLmFkZChtYXRjaFsxXSk7XG4gICAgfVxuICB9XG4gIHJldHVybiBuYW1lcztcbn1cblxuLyoqXG4gKiBQREYgZGlzY292ZXJ5IHBsdXMgY29udGVudCBzZWFyY2guXG4gKlxuICogVGhlIHRleHQgaW5kZXggbGl2ZXMgaW4gYEluZGV4U2VydmljZWAgKHBlcnNpc3RlbnQgYW5kIGluY3JlbWVudGFsKTsgdGhpc1xuICogY2xhc3Mgb3ducyBkaXNjb3ZlcnkgYW5kIHF1ZXJ5aW5nLCBhbmQgdHJhbnNsYXRlcyBpbmRleGluZyBwcm9ncmVzcyBpbnRvIHRoZVxuICogc2hhcGUgdGhlIHNpZGViYXIgc2hvd3MuXG4gKi9cbmV4cG9ydCBjbGFzcyBQZGZTZWFyY2hTZXJ2aWNlIHtcbiAgcHJpdmF0ZSByZWFkb25seSBpbmRleDogSW5kZXhTZXJ2aWNlO1xuICBwcml2YXRlIHJlYWRvbmx5IGVtaXR0ZXIgPSBuZXcgdnNjb2RlLkV2ZW50RW1pdHRlcjxJbmRleFN1bW1hcnk+KCk7XG4gIHJlYWRvbmx5IG9uUHJvZ3Jlc3MgPSB0aGlzLmVtaXR0ZXIuZXZlbnQ7XG4gIHByaXZhdGUgbGFzdFN1bW1hcnk6IEluZGV4U3VtbWFyeSA9IHtcbiAgICBwaGFzZTogJ2lkbGUnLFxuICAgIHByb2Nlc3NlZDogMCxcbiAgICB0b3RhbDogMCxcbiAgICBjYWNoZWQ6IDAsXG4gICAgZXh0cmFjdGVkOiAwLFxuICAgIHNraXBwZWQ6IDAsXG4gICAgZmFpbGVkOiAwLFxuICAgIGVsYXBzZWRNczogMCxcbiAgfTtcbiAgcHJpdmF0ZSBmaWxlQ2FjaGU6IHsgZmlsZXM6IEZpbGVSZWZbXTsgYXQ6IG51bWJlciB9IHwgdW5kZWZpbmVkO1xuXG4gIGNvbnN0cnVjdG9yKGRlcHM6IFBkZlNlYXJjaERlcHMpIHtcbiAgICB0aGlzLmluZGV4ID0gbmV3IEluZGV4U2VydmljZSh7XG4gICAgICBzdG9yZTogZGVwcy5zdG9yZSxcbiAgICAgIGVudmlyb25tZW50OiBkZXBzLmVudmlyb25tZW50LFxuICAgICAgY29uZmlnOiBkZXBzLmNvbmZpZyxcbiAgICAgIG9uUHJvZ3Jlc3M6IChwcm9ncmVzcykgPT4gdGhpcy5wdWJsaXNoKHByb2dyZXNzKSxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgcHVibGlzaChwcm9ncmVzczogSW5kZXhQcm9ncmVzcyk6IHZvaWQge1xuICAgIHRoaXMubGFzdFN1bW1hcnkgPSB7XG4gICAgICBwaGFzZTogcHJvZ3Jlc3MucGhhc2UsXG4gICAgICBwcm9jZXNzZWQ6IHByb2dyZXNzLnByb2Nlc3NlZCxcbiAgICAgIHRvdGFsOiBwcm9ncmVzcy50b3RhbCxcbiAgICAgIGN1cnJlbnRGaWxlOiBwcm9ncmVzcy5jdXJyZW50RmlsZSxcbiAgICAgIGNhY2hlZDogcHJvZ3Jlc3MuY2FjaGVkLFxuICAgICAgZXh0cmFjdGVkOiBwcm9ncmVzcy5leHRyYWN0ZWQsXG4gICAgICBza2lwcGVkOiBwcm9ncmVzcy5za2lwcGVkLFxuICAgICAgZmFpbGVkOiBwcm9ncmVzcy5mYWlsZWQsXG4gICAgICBlbGFwc2VkTXM6IHByb2dyZXNzLmVsYXBzZWRNcyxcbiAgICAgIHN1bW1hcnk6IHByb2dyZXNzLnN1bW1hcnksXG4gICAgfTtcbiAgICB0aGlzLmVtaXR0ZXIuZmlyZSh7IC4uLnRoaXMubGFzdFN1bW1hcnkgfSk7XG4gIH1cblxuICBnZXQgcHJvZ3Jlc3MoKTogSW5kZXhTdW1tYXJ5IHtcbiAgICByZXR1cm4geyAuLi50aGlzLmxhc3RTdW1tYXJ5IH07XG4gIH1cblxuICBnZXQgaW5kZXhlZEZpbGVDb3VudCgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLmluZGV4LmluZGV4ZWRGaWxlcztcbiAgfVxuXG4gIC8qKiBMb2FkcyB0aGUgcGVyc2lzdGVkIGluZGV4LiBDaGVhcDogb25lIGZpbGUgcmVhZCwgbm8gZXh0cmFjdGlvbi4gKi9cbiAgYXN5bmMgbG9hZEluZGV4KCk6IFByb21pc2U8bnVtYmVyPiB7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5pbmRleC5sb2FkKCk7XG4gICAgcmV0dXJuIHJlc3VsdC5lbnRyaWVzO1xuICB9XG5cbiAgLyoqIEluZGV4ZXMgd2hhdGV2ZXIgY2hhbmdlZC4gQ29uY3VycmVudCBjYWxscyBzaGFyZSBvbmUgcGFzcy4gKi9cbiAgYXN5bmMgZW5zdXJlSW5kZXgoKTogUHJvbWlzZTxJbmRleFN1bW1hcnk+IHtcbiAgICBhd2FpdCB0aGlzLmluZGV4LmVuc3VyZUluZGV4ZWQoKTtcbiAgICByZXR1cm4gdGhpcy5wcm9ncmVzcztcbiAgfVxuXG4gIC8qKiBQcmVkaWN0cyB0aGUgY29zdCBvZiBhIHBhc3Mgd2l0aG91dCBleHRyYWN0aW5nIGFueXRoaW5nLiAqL1xuICBhc3luYyBwbGFuSW5kZXgoKSB7XG4gICAgcmV0dXJuIHRoaXMuaW5kZXgucGxhblBhc3MoKTtcbiAgfVxuXG4gIGNhbmNlbEluZGV4KCk6IHZvaWQge1xuICAgIHRoaXMuaW5kZXguY2FuY2VsKCk7XG4gIH1cblxuICAvKiogRm9yZ2V0IG9uZSBQREYgKGl0IGNoYW5nZWQpIG9yIGV2ZXJ5dGhpbmcuICovXG4gIGludmFsaWRhdGUoZnNQYXRoPzogc3RyaW5nKTogdm9pZCB7XG4gICAgdGhpcy5pbmRleC5pbnZhbGlkYXRlKGZzUGF0aCk7XG4gICAgdGhpcy5maWxlQ2FjaGUgPSB1bmRlZmluZWQ7XG4gIH1cblxuICAvKiogRHJvcHMgaW5kZXggZW50cmllcyBmb3IgUERGcyB0aGF0IGFyZSBubyBsb25nZXIgaW4gdGhlIHdvcmtzcGFjZS4gKi9cbiAgYXN5bmMgcHJ1bmVJbmRleCgpOiBQcm9taXNlPG51bWJlcj4ge1xuICAgIGNvbnN0IHJlbW92ZWQgPSBhd2FpdCB0aGlzLmluZGV4LnBydW5lVG9Lbm93bkZpbGVzKCk7XG4gICAgaWYgKHJlbW92ZWQpIHtcbiAgICAgIHRoaXMuZmlsZUNhY2hlID0gdW5kZWZpbmVkO1xuICAgIH1cbiAgICByZXR1cm4gcmVtb3ZlZDtcbiAgfVxuXG4gIC8qKiBSZWJ1aWxkcyB0aGUgaW5kZXggZnJvbSBzY3JhdGNoLiAqL1xuICBhc3luYyByZXNldEluZGV4KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuaW5kZXgucmVzZXQoKTtcbiAgICB0aGlzLmZpbGVDYWNoZSA9IHVuZGVmaW5lZDtcbiAgfVxuXG4gIGFzeW5jIHNhdmVJbmRleCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLmluZGV4LnNhdmUodHJ1ZSk7XG4gIH1cblxuICAvKiogUmVhZHMgb25lIGluZGV4ZWQgZW50cnksIGZvciBzZWFyY2ggYW5kIGZvciB0ZXN0cy4gKi9cbiAgcGVla0VudHJ5KGZpbGVQYXRoOiBzdHJpbmcpIHtcbiAgICByZXR1cm4gdGhpcy5pbmRleC5wZWVrRW50cnkoZmlsZVBhdGgpO1xuICB9XG5cbiAgLyoqXG4gICAqIEFsbCBQREZzIGluIHRoZSB3b3Jrc3BhY2UuIENhY2hlZCBicmllZmx5IHNvIGZyZXF1ZW50IHByb2dyZXNzIHB1c2hlcyBhbmRcbiAgICogc2VjdGlvbiByZWZyZXNoZXMgZG8gbm90IGVhY2ggdHJpZ2dlciBhIGZpbGVzeXN0ZW0gc2VhcmNoLlxuICAgKi9cbiAgYXN5bmMgZmluZFBkZkZpbGVzKGZvcmNlID0gZmFsc2UpOiBQcm9taXNlPEZpbGVSZWZbXT4ge1xuICAgIGNvbnN0IG5vdyA9IERhdGUubm93KCk7XG4gICAgaWYgKCFmb3JjZSAmJiB0aGlzLmZpbGVDYWNoZSAmJiBub3cgLSB0aGlzLmZpbGVDYWNoZS5hdCA8IDEwXzAwMCkge1xuICAgICAgcmV0dXJuIHRoaXMuZmlsZUNhY2hlLmZpbGVzO1xuICAgIH1cblxuICAgIGNvbnN0IGV4Y2x1ZGUgPSB0b0V4Y2x1ZGVHbG9iKGNvbmZpZzxzdHJpbmdbXT4oJ3NlYXJjaC5leGNsdWRlR2xvYnMnLCBbXSkpO1xuICAgIGNvbnN0IGZvbGRlcnMgPSB2c2NvZGUud29ya3NwYWNlLndvcmtzcGFjZUZvbGRlcnMgPz8gW107XG4gICAgY29uc3Qgc2VlbiA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgIGNvbnN0IGZpbGVzOiBGaWxlUmVmW10gPSBbXTtcblxuICAgIGNvbnN0IHB1c2ggPSAoZnNQYXRoOiBzdHJpbmcpOiB2b2lkID0+IHtcbiAgICAgIGNvbnN0IGtleSA9IGZzUGF0aC50b0xvd2VyQ2FzZSgpO1xuICAgICAgaWYgKHNlZW4uaGFzKGtleSkpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgc2Vlbi5hZGQoa2V5KTtcbiAgICAgIGZpbGVzLnB1c2godG9GaWxlUmVmKGZzUGF0aCkpO1xuICAgIH07XG5cbiAgICBpZiAoZm9sZGVycy5sZW5ndGggPT09IDApIHtcbiAgICAgIGNvbnN0IGZvdW5kID0gYXdhaXQgdnNjb2RlLndvcmtzcGFjZS5maW5kRmlsZXMoJyoqLyoucGRmJywgZXhjbHVkZSwgNTAwMCk7XG4gICAgICBmb3VuZC5mb3JFYWNoKCh1cmkpID0+IHB1c2godXJpLmZzUGF0aCkpO1xuICAgIH0gZWxzZSB7XG4gICAgICBmb3IgKGNvbnN0IGZvbGRlciBvZiBmb2xkZXJzKSB7XG4gICAgICAgIGNvbnN0IHBhdHRlcm4gPSBuZXcgdnNjb2RlLlJlbGF0aXZlUGF0dGVybihmb2xkZXIsICcqKi8qLnBkZicpO1xuICAgICAgICBsZXQgZm91bmQ6IHZzY29kZS5VcmlbXSA9IFtdO1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGZvdW5kID0gYXdhaXQgdnNjb2RlLndvcmtzcGFjZS5maW5kRmlsZXMocGF0dGVybiwgZXhjbHVkZSwgNTAwMCk7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgY29uc29sZS53YXJuKCdbcGRmLWh1Yl0gd29ya3NwYWNlIHNlYXJjaCBmYWlsZWQsIGZhbGxpbmcgYmFjayB0byBhIGZpbGVzeXN0ZW0gd2FsazonLCBlcnJvcik7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFmb3VuZC5sZW5ndGgpIHtcbiAgICAgICAgICBjb25zdCB3YWxrZWQgPSBhd2FpdCBmaW5kUGRmRmlsZXNJbkRpcmVjdG9yeShmb2xkZXIudXJpLmZzUGF0aCwge1xuICAgICAgICAgICAgc2tpcERpcmVjdG9yaWVzOiBza2lwTmFtZXNGcm9tR2xvYnMoY29uZmlnPHN0cmluZ1tdPignc2VhcmNoLmV4Y2x1ZGVHbG9icycsIFtdKSksXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgd2Fsa2VkLmZvckVhY2gocHVzaCk7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgZm91bmQuZm9yRWFjaCgodXJpKSA9PiBwdXNoKHVyaS5mc1BhdGgpKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmaWxlcy5zb3J0KChhLCBiKSA9PiAoYS5yZWxhdGl2ZVBhdGggPz8gYS5uYW1lKS5sb2NhbGVDb21wYXJlKGIucmVsYXRpdmVQYXRoID8/IGIubmFtZSkpO1xuICAgIHRoaXMuZmlsZUNhY2hlID0geyBmaWxlcywgYXQ6IG5vdyB9O1xuICAgIHJldHVybiBmaWxlcztcbiAgfVxuXG4gIC8qKiBGaWxlcyB0aGUgY29udGVudCBzZWFyY2ggc2hvdWxkIGNvbnNpZGVyLCBob25vdXJpbmcgdGhlIHNjb3BlIHNldHRpbmcuICovXG4gIGFzeW5jIHNlYXJjaGFibGVGaWxlcyhleHRlcm5hbDogRmlsZVJlZltdKTogUHJvbWlzZTxGaWxlUmVmW10+IHtcbiAgICBjb25zdCBwcm9qZWN0ID0gYXdhaXQgdGhpcy5maW5kUGRmRmlsZXMoKTtcbiAgICBjb25zdCBzY29wZSA9IGNvbmZpZzwncHJvamVjdCcgfCAncHJvamVjdEFuZEV4dGVybmFsJz4oJ3NlYXJjaC5zY29wZScsICdwcm9qZWN0Jyk7XG4gICAgaWYgKHNjb3BlICE9PSAncHJvamVjdEFuZEV4dGVybmFsJykge1xuICAgICAgcmV0dXJuIHByb2plY3Q7XG4gICAgfVxuICAgIGNvbnN0IGtleSA9IChwOiBzdHJpbmcpOiBzdHJpbmcgPT4gcC5yZXBsYWNlKC9cXFxcL2csICcvJykudG9Mb3dlckNhc2UoKTtcbiAgICBjb25zdCBrbm93biA9IG5ldyBTZXQocHJvamVjdC5tYXAoKGZpbGUpID0+IGtleShmaWxlLnBhdGgpKSk7XG4gICAgY29uc3QgZXh0cmEgPSBleHRlcm5hbC5maWx0ZXIoXG4gICAgICAoZmlsZSkgPT4gZmlsZS5wYXRoLnRvTG93ZXJDYXNlKCkuZW5kc1dpdGgoJy5wZGYnKSAmJiAha25vd24uaGFzKGtleShmaWxlLnBhdGgpKVxuICAgICk7XG4gICAgcmV0dXJuIFsuLi5wcm9qZWN0LCAuLi5leHRyYV07XG4gIH1cblxuICAvKiogU2VhcmNoZXMgaW5kZXhlZCBQREYgdGV4dC4gKi9cbiAgYXN5bmMgc2VhcmNoQ29udGVudChcbiAgICBxdWVyeTogc3RyaW5nLFxuICAgIGZpbGVzOiBGaWxlUmVmW10sXG4gICAgdG9rZW46IHZzY29kZS5DYW5jZWxsYXRpb25Ub2tlblxuICApOiBQcm9taXNlPFBkZkNvbnRlbnRIaXRbXT4ge1xuICAgIGNvbnN0IG5lZWRsZSA9IHF1ZXJ5LnRvTG93ZXJDYXNlKCk7XG4gICAgaWYgKCFuZWVkbGUpIHtcbiAgICAgIHJldHVybiBbXTtcbiAgICB9XG4gICAgYXdhaXQgdGhpcy5pbmRleC5sb2FkKCk7XG5cbiAgICBjb25zdCBoaXRzOiBQZGZDb250ZW50SGl0W10gPSBbXTtcbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgZmlsZXMpIHtcbiAgICAgIGlmICh0b2tlbi5pc0NhbmNlbGxhdGlvblJlcXVlc3RlZCkge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5pbmRleC5wZWVrRW50cnkoZmlsZS5wYXRoKTtcbiAgICAgIGlmICghZW50cnkpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCB7IG1hdGNoZXMsIG1hdGNoQ291bnQgfSA9IG1hdGNoUGFnZXMoZW50cnkudGV4dCwgZW50cnkubG93ZXIsIG5lZWRsZSk7XG4gICAgICBpZiAobWF0Y2hDb3VudCA+IDApIHtcbiAgICAgICAgaGl0cy5wdXNoKHtcbiAgICAgICAgICBmaWxlLFxuICAgICAgICAgIG1hdGNoQ291bnQsXG4gICAgICAgICAgcGFnZXM6IGVudHJ5LnBhZ2VzLFxuICAgICAgICAgIG1hdGNoZXMsXG4gICAgICAgICAgbm90ZTogZW50cnkudHJ1bmNhdGVkID8gJ0luZGV4ZWQgcGFydGlhbGx5IChzaXplIGxpbWl0KScgOiB1bmRlZmluZWQsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cbiAgICBoaXRzLnNvcnQoKGEsIGIpID0+IGIubWF0Y2hDb3VudCAtIGEubWF0Y2hDb3VudCB8fCBhLmZpbGUubmFtZS5sb2NhbGVDb21wYXJlKGIuZmlsZS5uYW1lKSk7XG4gICAgcmV0dXJuIGhpdHM7XG4gIH1cblxuICAvKiogRmlsZS1uYW1lIHNlYXJjaCwgaW5kZXBlbmRlbnQgb2YgdGhlIHRleHQgaW5kZXguICovXG4gIHNlYXJjaE5hbWVzKHF1ZXJ5OiBzdHJpbmcsIGZpbGVzOiBGaWxlUmVmW10pOiBGaWxlUmVmW10ge1xuICAgIHJldHVybiByYW5rTmFtZU1hdGNoZXMoZmlsZXMsIHF1ZXJ5KTtcbiAgfVxuXG4gIGlzSW5kZXhlZCgpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5pbmRleC5pbmRleGVkRmlsZXMgPiAwO1xuICB9XG5cbiAgZGlzcG9zZSgpOiB2b2lkIHtcbiAgICB0aGlzLmVtaXR0ZXIuZGlzcG9zZSgpO1xuICB9XG59XG4iLCAiLyoqXG4gKiBQdXJlIHJhbmtpbmcgYW5kIHBydW5pbmcgbG9naWMgZm9yIHRoZSBcIm1vc3Qgb3BlbmVkXCIgc2VjdGlvbiBhbmQgZm9yXG4gKiByZW1lbWJlcmluZyBmaWxlcyBiZXR3ZWVuIHNlc3Npb25zLiBObyBgdnNjb2RlYCBpbXBvcnQsIHNvIGl0IGlzIHVuaXQgdGVzdGVkLlxuICovXG5cbmV4cG9ydCBpbnRlcmZhY2UgT3BlblN0YXQge1xuICBwYXRoOiBzdHJpbmc7XG4gIG5hbWU6IHN0cmluZztcbiAgLyoqIEhvdyBtYW55IHRpbWVzIHRoZSBmaWxlIHdhcyBvcGVuZWQvYWN0aXZhdGVkLiAqL1xuICBjb3VudDogbnVtYmVyO1xuICAvKiogRXBvY2ggbXMgb2YgdGhlIG1vc3QgcmVjZW50IG9wZW4uICovXG4gIGxhc3RPcGVuZWQ6IG51bWJlcjtcbiAgLyoqIFdoZXRoZXIgdGhlIGZpbGUgc3RpbGwgcmVzb2x2ZXMgaW5zaWRlIHRoZSBjdXJyZW50IHByb2plY3QuICovXG4gIGluUHJvamVjdDogYm9vbGVhbjtcbiAgcmVsYXRpdmVQYXRoPzogc3RyaW5nO1xufVxuXG5leHBvcnQgdHlwZSBSYW5raW5nU3RyYXRlZ3kgPSAnZnJlcXVlbmN5JyB8ICdyZWNlbnQnIHwgJ2h5YnJpZCc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgUmFua2luZ09wdGlvbnMge1xuICBzdHJhdGVneTogUmFua2luZ1N0cmF0ZWd5O1xuICBsaW1pdDogbnVtYmVyO1xuICAvKiogT25seSBjb25zaWRlciBmaWxlcyBjdXJyZW50bHkgaW5zaWRlIHRoZSBwcm9qZWN0LiAqL1xuICBwcm9qZWN0T25seT86IGJvb2xlYW47XG4gIG5vdz86IG51bWJlcjtcbn1cblxuLyoqXG4gKiBSYW5rcyByZW1lbWJlcmVkIGZpbGVzLlxuICpcbiAqIGBoeWJyaWRgIGJsZW5kcyBvcGVuIGNvdW50IHdpdGggYSByZWNlbmN5IGRlY2F5ICh+MyB3ZWVrcyksIHNvIGEgZGFpbHkgZHJpdmVyXG4gKiBiZWF0cyBhIGZpbGUgb3BlbmVkIDIwMCB0aW1lcyB0d28geWVhcnMgYWdvLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmFua09wZW5TdGF0cyhzdGF0czogT3BlblN0YXRbXSwgb3B0aW9uczogUmFua2luZ09wdGlvbnMpOiBPcGVuU3RhdFtdIHtcbiAgY29uc3Qgbm93ID0gb3B0aW9ucy5ub3cgPz8gRGF0ZS5ub3coKTtcbiAgY29uc3Qgcm93cyA9IHN0YXRzLmZpbHRlcigocm93KSA9PiAob3B0aW9ucy5wcm9qZWN0T25seSA/IHJvdy5pblByb2plY3QgOiB0cnVlKSk7XG5cbiAgY29uc3Qgc2NvcmVkID0gcm93cy5tYXAoKHJvdykgPT4ge1xuICAgIGNvbnN0IGFnZUhvdXJzID0gTWF0aC5tYXgoMCwgKG5vdyAtIHJvdy5sYXN0T3BlbmVkKSAvIDNfNjAwXzAwMCk7XG4gICAgY29uc3QgcmVjZW5jeSA9IDEgLyAoMSArIGFnZUhvdXJzIC8gNDgpO1xuICAgIGNvbnN0IHNjb3JlID1cbiAgICAgIG9wdGlvbnMuc3RyYXRlZ3kgPT09ICdmcmVxdWVuY3knXG4gICAgICAgID8gcm93LmNvdW50XG4gICAgICAgIDogb3B0aW9ucy5zdHJhdGVneSA9PT0gJ3JlY2VudCdcbiAgICAgICAgICA/IHJvdy5sYXN0T3BlbmVkXG4gICAgICAgICAgOiByb3cuY291bnQgKiAxLjUgKyByZWNlbmN5ICogMTA7XG4gICAgcmV0dXJuIHsgcm93LCBzY29yZSB9O1xuICB9KTtcblxuICBzY29yZWQuc29ydCgoYSwgYikgPT4gYi5zY29yZSAtIGEuc2NvcmUgfHwgYS5yb3cubmFtZS5sb2NhbGVDb21wYXJlKGIucm93Lm5hbWUpKTtcbiAgcmV0dXJuIHNjb3JlZC5zbGljZSgwLCBNYXRoLm1heCgxLCBvcHRpb25zLmxpbWl0KSkubWFwKChlbnRyeSkgPT4gKHsgLi4uZW50cnkucm93IH0pKTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBQcnVuYWJsZUNvbGxlY3Rpb25zIHtcbiAgcmVjZW50czogT3BlblN0YXRbXTtcbiAgZXh0ZXJuYWw6IHsgcGF0aDogc3RyaW5nIH1bXTtcbiAgZ3JvdXBzOiB7IGZpbGVzOiB7IHBhdGg6IHN0cmluZyB9W10gfVtdO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFBydW5lUmVzdWx0PFQgZXh0ZW5kcyBQcnVuYWJsZUNvbGxlY3Rpb25zPiB7XG4gIHZhbHVlOiBUO1xuICByZW1vdmVkOiBudW1iZXI7XG59XG5cbi8qKiBEcm9wcyByZW1lbWJlcmVkIGZpbGVzIHRoYXQgbm8gbG9uZ2VyIGV4aXN0IG9uIGRpc2suICovXG5leHBvcnQgZnVuY3Rpb24gcHJ1bmVNaXNzaW5nPFQgZXh0ZW5kcyBQcnVuYWJsZUNvbGxlY3Rpb25zPihcbiAgdmFsdWU6IFQsXG4gIGV4aXN0czogKHBhdGg6IHN0cmluZykgPT4gYm9vbGVhblxuKTogUHJ1bmVSZXN1bHQ8VD4ge1xuICBjb25zdCBiZWZvcmUgPVxuICAgIHZhbHVlLnJlY2VudHMubGVuZ3RoICtcbiAgICB2YWx1ZS5leHRlcm5hbC5sZW5ndGggK1xuICAgIHZhbHVlLmdyb3Vwcy5yZWR1Y2UoKHRvdGFsLCBncm91cCkgPT4gdG90YWwgKyBncm91cC5maWxlcy5sZW5ndGgsIDApO1xuXG4gIGNvbnN0IHJlY2VudHMgPSB2YWx1ZS5yZWNlbnRzLmZpbHRlcigocm93KSA9PiBleGlzdHMocm93LnBhdGgpKTtcbiAgY29uc3QgZXh0ZXJuYWwgPSB2YWx1ZS5leHRlcm5hbC5maWx0ZXIoKGZpbGUpID0+IGV4aXN0cyhmaWxlLnBhdGgpKTtcbiAgY29uc3QgZ3JvdXBzID0gdmFsdWUuZ3JvdXBzLm1hcCgoZ3JvdXApID0+ICh7XG4gICAgLi4uZ3JvdXAsXG4gICAgZmlsZXM6IGdyb3VwLmZpbGVzLmZpbHRlcigoZmlsZSkgPT4gZXhpc3RzKGZpbGUucGF0aCkpLFxuICB9KSk7XG5cbiAgY29uc3QgYWZ0ZXIgPVxuICAgIHJlY2VudHMubGVuZ3RoICsgZXh0ZXJuYWwubGVuZ3RoICsgZ3JvdXBzLnJlZHVjZSgodG90YWwsIGdyb3VwKSA9PiB0b3RhbCArIGdyb3VwLmZpbGVzLmxlbmd0aCwgMCk7XG5cbiAgcmV0dXJuIHtcbiAgICB2YWx1ZTogeyAuLi52YWx1ZSwgcmVjZW50cywgZXh0ZXJuYWwsIGdyb3VwcyB9IGFzIFQsXG4gICAgcmVtb3ZlZDogYmVmb3JlIC0gYWZ0ZXIsXG4gIH07XG59XG5cbi8qKlxuICogUmVjb3JkcyBhbiBvcGVuLCB1cGRhdGluZyBjb3VudCBhbmQgdGltZXN0YW1wLCBhbmQgdHJpbXMgdGhlIGhpc3RvcnkuXG4gKiBSZXR1cm5zIGEgbmV3IGFycmF5OyB0aGUgaW5wdXQgaXMgbm90IG11dGF0ZWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZWNvcmRPcGVuU3RhdChcbiAgc3RhdHM6IE9wZW5TdGF0W10sXG4gIGVudHJ5OiB7IHBhdGg6IHN0cmluZzsgbmFtZTogc3RyaW5nOyBpblByb2plY3Q6IGJvb2xlYW47IHJlbGF0aXZlUGF0aD86IHN0cmluZyB9LFxuICBvcHRpb25zOiB7IG5vdz86IG51bWJlcjsgY2FwPzogbnVtYmVyIH0gPSB7fVxuKTogT3BlblN0YXRbXSB7XG4gIGNvbnN0IG5vdyA9IG9wdGlvbnMubm93ID8/IERhdGUubm93KCk7XG4gIGNvbnN0IGNhcCA9IE1hdGgubWF4KDEsIG9wdGlvbnMuY2FwID8/IDIwMCk7XG4gIGNvbnN0IGtleSA9IGVudHJ5LnBhdGgucmVwbGFjZSgvXFxcXC9nLCAnLycpLnRvTG93ZXJDYXNlKCk7XG5cbiAgY29uc3QgZXhpc3RpbmcgPSBzdGF0cy5maW5kKChyb3cpID0+IHJvdy5wYXRoLnJlcGxhY2UoL1xcXFwvZywgJy8nKS50b0xvd2VyQ2FzZSgpID09PSBrZXkpO1xuICBjb25zdCBuZXh0OiBPcGVuU3RhdFtdID0gZXhpc3RpbmdcbiAgICA/IHN0YXRzLm1hcCgocm93KSA9PlxuICAgICAgICByb3cgPT09IGV4aXN0aW5nXG4gICAgICAgICAgPyB7XG4gICAgICAgICAgICAgIC4uLnJvdyxcbiAgICAgICAgICAgICAgY291bnQ6IHJvdy5jb3VudCArIDEsXG4gICAgICAgICAgICAgIGxhc3RPcGVuZWQ6IG5vdyxcbiAgICAgICAgICAgICAgbmFtZTogZW50cnkubmFtZSxcbiAgICAgICAgICAgICAgaW5Qcm9qZWN0OiBlbnRyeS5pblByb2plY3QsXG4gICAgICAgICAgICAgIHJlbGF0aXZlUGF0aDogZW50cnkucmVsYXRpdmVQYXRoLFxuICAgICAgICAgICAgfVxuICAgICAgICAgIDogcm93XG4gICAgICApXG4gICAgOiBbXG4gICAgICAgIC4uLnN0YXRzLFxuICAgICAgICB7XG4gICAgICAgICAgcGF0aDogZW50cnkucGF0aCxcbiAgICAgICAgICBuYW1lOiBlbnRyeS5uYW1lLFxuICAgICAgICAgIGNvdW50OiAxLFxuICAgICAgICAgIGxhc3RPcGVuZWQ6IG5vdyxcbiAgICAgICAgICBpblByb2plY3Q6IGVudHJ5LmluUHJvamVjdCxcbiAgICAgICAgICByZWxhdGl2ZVBhdGg6IGVudHJ5LnJlbGF0aXZlUGF0aCxcbiAgICAgICAgfSxcbiAgICAgIF07XG5cbiAgbmV4dC5zb3J0KChhLCBiKSA9PiBiLmxhc3RPcGVuZWQgLSBhLmxhc3RPcGVuZWQpO1xuICByZXR1cm4gbmV4dC5zbGljZSgwLCBjYXApO1xufVxuXG4vKipcbiAqIERlY2lkZXMgd2hlbiB0aGUgYmFja2dyb3VuZCBpbmRleCBzaG91bGQgKHJlKXJ1bi5cbiAqXG4gKiBUaGUgcG9pbnQgaXMgdG8gYXZvaWQgcmVjb21wdXRpbmcgYW4gdW5jaGFuZ2VkIGNvcnB1czogb3BlbmluZyBhIHdpbmRvdyxcbiAqIHN3aXRjaGluZyB0YWJzIG9yIHNhdmluZyBhbiB1bnJlbGF0ZWQgZmlsZSBtdXN0IG5vdCB0cmlnZ2VyIFBERiB0ZXh0XG4gKiBleHRyYWN0aW9uLiBPbmx5IGFuIGV4cGxpY2l0IHJlcXVlc3QsIGFuIG9wdGVkLWluIHN0YXJ0dXAgcG9saWN5LCBvciBhIHJlYWxcbiAqIFBERiBjaGFuZ2Ugc2NoZWR1bGVzIHdvcmssIGFuZCByZXBlYXRlZCBjaGFuZ2UgZXZlbnRzIGFyZSBjb2FsZXNjZWQuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUmVpbmRleFBvbGljeSB7XG4gIC8qKlxuICAgKiAtIGBvbkRlbWFuZGA6IG9ubHkgd2hlbiBzZWFyY2ggb3IgYSBjb21tYW5kIG5lZWRzIHRoZSBpbmRleFxuICAgKiAtIGBvblZpZXdPcGVuYDogd2hlbiB0aGUgc2lkZWJhciBpcyBvcGVuZWQgKGRlZmF1bHQpXG4gICAqIC0gYG9uU3RhcnR1cGA6IHNob3J0bHkgYWZ0ZXIgYWN0aXZhdGlvbiwgaW4gdGhlIGJhY2tncm91bmRcbiAgICovXG4gIHRyaWdnZXI6ICdvbkRlbWFuZCcgfCAnb25WaWV3T3BlbicgfCAnb25TdGFydHVwJztcbiAgLyoqIERlbGF5IGJlZm9yZSBhIGNoYW5nZS10cmlnZ2VyZWQgcGFzcyBydW5zLiAqL1xuICBkZWJvdW5jZU1zOiBudW1iZXI7XG4gIC8qKiBVcHBlciBib3VuZCBvbiBob3cgbG9uZyBhIHBhc3MgbWF5IGJlIHBvc3Rwb25lZCBieSBhIHN0ZWFkeSBzdHJlYW0gb2YgY2hhbmdlcy4gKi9cbiAgbWF4RGVsYXlNczogbnVtYmVyO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFJlaW5kZXhTY2hlZHVsZSB7XG4gIHJ1bk5vdzogYm9vbGVhbjtcbiAgZGVsYXlNczogbnVtYmVyO1xufVxuXG4vKipcbiAqIENvYWxlc2NlcyByZWluZGV4IHJlcXVlc3RzLlxuICpcbiAqIGBwZW5kaW5nU2luY2VgIGlzIHRoZSB0aW1lc3RhbXAgb2YgdGhlIGZpcnN0IHBlbmRpbmcgcmVxdWVzdCAoMCB3aGVuIG5vbmUpLlxuICogVGhlIHJldHVybmVkIHNjaGVkdWxlIGVpdGhlciBydW5zIGltbWVkaWF0ZWx5IChleHBsaWNpdCByZXF1ZXN0KSwgd2FpdHMgb3V0XG4gKiB0aGUgZGVib3VuY2UsIG9yIGZpcmVzIG9uY2UgYG1heERlbGF5TXNgIGhhcyBlbGFwc2VkIHNvIGNvbnRpbnVvdXMgZWRpdHNcbiAqIGNhbm5vdCBwb3N0cG9uZSBpbmRleGluZyBmb3JldmVyLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGxhblJlaW5kZXgoXG4gIHBvbGljeTogUmVpbmRleFBvbGljeSxcbiAgcmVhc29uOiAnZXhwbGljaXQnIHwgJ2NoYW5nZScgfCAndmlld09wZW4nIHwgJ3N0YXJ0dXAnLFxuICBub3c6IG51bWJlcixcbiAgcGVuZGluZ1NpbmNlOiBudW1iZXJcbik6IFJlaW5kZXhTY2hlZHVsZSB7XG4gIGlmIChyZWFzb24gPT09ICdleHBsaWNpdCcpIHtcbiAgICByZXR1cm4geyBydW5Ob3c6IHRydWUsIGRlbGF5TXM6IDAgfTtcbiAgfVxuICBpZiAocmVhc29uID09PSAnY2hhbmdlJykge1xuICAgIGNvbnN0IHdhaXRlZCA9IHBlbmRpbmdTaW5jZSA+IDAgPyBub3cgLSBwZW5kaW5nU2luY2UgOiAwO1xuICAgIGlmIChwZW5kaW5nU2luY2UgPiAwICYmIHdhaXRlZCA+PSBwb2xpY3kubWF4RGVsYXlNcykge1xuICAgICAgcmV0dXJuIHsgcnVuTm93OiB0cnVlLCBkZWxheU1zOiAwIH07XG4gICAgfVxuICAgIGNvbnN0IHJlbWFpbmluZyA9IE1hdGgubWF4KDAsIHBvbGljeS5kZWJvdW5jZU1zIC0gd2FpdGVkKTtcbiAgICAvLyBUaGUgZGVib3VuY2UgaGFzIGFscmVhZHkgZWxhcHNlZDogaW5kZXggbm93IGluc3RlYWQgb2Ygd2FpdGluZyBvbiBhIHRpbWVyLlxuICAgIHJldHVybiByZW1haW5pbmcgPT09IDAgPyB7IHJ1bk5vdzogdHJ1ZSwgZGVsYXlNczogMCB9IDogeyBydW5Ob3c6IGZhbHNlLCBkZWxheU1zOiByZW1haW5pbmcgfTtcbiAgfVxuICBpZiAocmVhc29uID09PSAndmlld09wZW4nKSB7XG4gICAgcmV0dXJuIHBvbGljeS50cmlnZ2VyID09PSAnb25EZW1hbmQnXG4gICAgICA/IHsgcnVuTm93OiBmYWxzZSwgZGVsYXlNczogMCB9XG4gICAgICA6IHsgcnVuTm93OiB0cnVlLCBkZWxheU1zOiAwIH07XG4gIH1cbiAgLy8gc3RhcnR1cFxuICByZXR1cm4gcG9saWN5LnRyaWdnZXIgPT09ICdvblN0YXJ0dXAnID8geyBydW5Ob3c6IHRydWUsIGRlbGF5TXM6IDAgfSA6IHsgcnVuTm93OiBmYWxzZSwgZGVsYXlNczogMCB9O1xufVxuXG4vKiogQ2hlYXAgc3VtbWFyeSBvZiB3aGF0IGEgcGFzcyB3aWxsIGNvc3QsIHNob3duIGJlZm9yZSBpbmRleGluZyBzdGFydHMuICovXG5leHBvcnQgZnVuY3Rpb24gZGVzY3JpYmVTY2FuKHVuY2hhbmdlZDogbnVtYmVyLCBjaGFuZ2VkOiBudW1iZXIsIGJ5dGVzOiBudW1iZXIpOiBzdHJpbmcge1xuICBjb25zdCBtYiA9IGJ5dGVzIC8gKDEwMjQgKiAxMDI0KTtcbiAgY29uc3Qgc2l6ZSA9IG1iID49IDEgPyBgJHttYi50b0ZpeGVkKDEpfSBNQmAgOiBgJHtNYXRoLnJvdW5kKGJ5dGVzIC8gMTAyNCl9IEtCYDtcbiAgaWYgKGNoYW5nZWQgPT09IDApIHtcbiAgICByZXR1cm4gYE5vdGhpbmcgdG8gaW5kZXggXHUyMDE0ICR7dW5jaGFuZ2VkfSBQREYocykgYWxyZWFkeSBjYWNoZWRgO1xuICB9XG4gIHJldHVybiBgJHtjaGFuZ2VkfSBQREYocykgbmVlZCBpbmRleGluZyAoJHtzaXplfSkke3VuY2hhbmdlZCA/IGAsICR7dW5jaGFuZ2VkfSB1bmNoYW5nZWRgIDogJyd9YDtcbn1cbiIsICIvKipcbiAqIEluY3JlbWVudGFsIGluZGV4aW5nIHNlcnZpY2UuXG4gKlxuICogQ29zdCBtb2RlbCwgaW4gb3JkZXIgb2YgaG93IG9mdGVuIGVhY2ggc3RlcCBydW5zOlxuICogIDEuIGBzdGF0YCBldmVyeSBrbm93biBQREYgKGEgZmV3IGh1bmRyZWQgbWljcm9zZWNvbmRzIGVhY2gpIHRvIGRlY2lkZSB3aGV0aGVyXG4gKiAgICAgYW55dGhpbmcgY2hhbmdlZC4gVGhpcyBpcyB0aGUgb25seSBjb3N0IG9mIG9wZW5pbmcgYSB3aW5kb3cuXG4gKiAgMi4gZXh0cmFjdCB0ZXh0ICoqb25seSoqIGZvciBmaWxlcyB3aG9zZSBtdGltZSBvciBzaXplIGNoYW5nZWQsIHR3byBhdCBhIHRpbWUuXG4gKiAgMy4gcGVyc2lzdCB0aGUgaW5kZXggd2hlbiB3b3JrIGhhcHBlbmVkLCBkZWJvdW5jZWQuXG4gKlxuICogVGhhdCBtZWFucyBhbiB1bmNoYW5nZWQgcHJvamVjdCBjb3N0cyBvbmUgYHN0YXRgIHBhc3MgYW5kIHplcm8gcGFyc2luZywgd2hpY2hcbiAqIGlzIHdoYXQga2VlcHMgYSBtb3N0bHktc3RhdGljIFBERiBjb2xsZWN0aW9uIGNoZWFwIHRvIGtlZXAgaW5kZXhlZC5cbiAqXG4gKiBUaGUgZmlsZSBzeXN0ZW0gaXMgaW5qZWN0ZWQgKGBJbmRleEVudmlyb25tZW50YCkgc28gdGhlIHdob2xlIHNjaGVkdWxpbmcsXG4gKiBjYWNoaW5nIGFuZCBjYW5jZWxsYXRpb24gYmVoYXZpb3VyIGlzIHVuaXQgdGVzdGVkLlxuICovXG5pbXBvcnQgdHlwZSB7IEZpbGVSZWYgfSBmcm9tICcuL3R5cGVzLnRzJztcbmltcG9ydCB7IGRlc2NyaWJlU2NhbiB9IGZyb20gJy4vc2VhcmNoL3JlY2VudHMudHMnO1xuaW1wb3J0IHsgaXNFbnRyeVZhbGlkLCB0eXBlIFBkZkluZGV4U3RvcmUgfSBmcm9tICcuL3NlYXJjaC9pbmRleFN0b3JlLnRzJztcblxuZXhwb3J0IGludGVyZmFjZSBJbmRleEVudmlyb25tZW50IHtcbiAgLyoqIExpc3RzIGNhbmRpZGF0ZSBQREZzIHdpdGggdGhlaXIgb24tZGlzayBtZXRhZGF0YS4gKi9cbiAgbGlzdEZpbGVzKCk6IFByb21pc2U8RmlsZVJlZltdPjtcbiAgc3RhdChwYXRoOiBzdHJpbmcpOiBQcm9taXNlPHsgbXRpbWVNczogbnVtYmVyOyBzaXplOiBudW1iZXIgfSB8IHVuZGVmaW5lZD47XG4gIHJlYWQocGF0aDogc3RyaW5nKTogUHJvbWlzZTxVaW50OEFycmF5PjtcbiAgZXh0cmFjdChcbiAgICBkYXRhOiBVaW50OEFycmF5XG4gICk6IFByb21pc2U8eyBwYWdlczogc3RyaW5nW107IHRydW5jYXRlZDogYm9vbGVhbjsgdG90YWxQYWdlczogbnVtYmVyIH0+O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEluZGV4Q29uZmlnIHtcbiAgbWF4RmlsZVNpemVCeXRlczogbnVtYmVyO1xuICBtYXhUZXh0Q2hhcnNQZXJGaWxlOiBudW1iZXI7XG4gIGNvbmN1cnJlbmN5OiBudW1iZXI7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgSW5kZXhQcm9ncmVzcyB7XG4gIHBoYXNlOiAnaWRsZScgfCAnc2Nhbm5pbmcnIHwgJ2luZGV4aW5nJyB8ICdyZWFkeScgfCAnY2FuY2VsbGVkJyB8ICdlcnJvcic7XG4gIHByb2Nlc3NlZDogbnVtYmVyO1xuICB0b3RhbDogbnVtYmVyO1xuICBjdXJyZW50RmlsZT86IHN0cmluZztcbiAgLyoqIEZpbGVzIHdob3NlIGNhY2hlZCB0ZXh0IHdhcyBzdGlsbCB2YWxpZCBhbmQgd2VyZSB0aGVyZWZvcmUgc2tpcHBlZC4gKi9cbiAgY2FjaGVkOiBudW1iZXI7XG4gIC8qKiBGaWxlcyBhY3R1YWxseSByZS1leHRyYWN0ZWQgaW4gdGhpcyBwYXNzLiAqL1xuICBleHRyYWN0ZWQ6IG51bWJlcjtcbiAgZnJvbUNhY2hlOiBudW1iZXI7XG4gIHNraXBwZWQ6IG51bWJlcjtcbiAgZmFpbGVkOiBudW1iZXI7XG4gIGJ5dGVzOiBudW1iZXI7XG4gIGVsYXBzZWRNczogbnVtYmVyO1xuICAvKiogU2V0IHdoZW4gdGhlIHBhc3MgZmluaXNoZWQ7IGEgc2hvcnQgaHVtYW4gc3VtbWFyeS4gKi9cbiAgc3VtbWFyeT86IHN0cmluZztcbiAgZXJyb3I/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgSW5kZXhSdW5PcHRpb25zIHtcbiAgLyoqIFJlcG9ydCBldmVyeSBmaWxlLCBvciBvbmx5IHBoYXNlcyAodXNlZnVsIGZvciBiYWNrZ3JvdW5kIHBhc3NlcykuICovXG4gIHNpbGVudD86IGJvb2xlYW47XG4gIC8qKiBDYWxsZWQgd2hlbiB0aGUgcGFzcyBmaW5pc2hlcyBzdWNjZXNzZnVsbHkuICovXG4gIG9uQ29tcGxldGU/OiAocHJvZ3Jlc3M6IEluZGV4UHJvZ3Jlc3MpID0+IHZvaWQ7XG59XG5cbmNvbnN0IElETEU6IEluZGV4UHJvZ3Jlc3MgPSB7XG4gIHBoYXNlOiAnaWRsZScsXG4gIHByb2Nlc3NlZDogMCxcbiAgdG90YWw6IDAsXG4gIGNhY2hlZDogMCxcbiAgZXh0cmFjdGVkOiAwLFxuICBmcm9tQ2FjaGU6IDAsXG4gIHNraXBwZWQ6IDAsXG4gIGZhaWxlZDogMCxcbiAgYnl0ZXM6IDAsXG4gIGVsYXBzZWRNczogMCxcbn07XG5cbmV4cG9ydCBjbGFzcyBJbmRleFNlcnZpY2Uge1xuICBwcml2YXRlIHJlYWRvbmx5IHN0b3JlOiBQZGZJbmRleFN0b3JlO1xuICBwcml2YXRlIHJlYWRvbmx5IGVudmlyb25tZW50OiBJbmRleEVudmlyb25tZW50O1xuICBwcml2YXRlIHJlYWRvbmx5IGNvbmZpZzogKCkgPT4gSW5kZXhDb25maWc7XG4gIHByaXZhdGUgcmVhZG9ubHkgb25Qcm9ncmVzc0NhbGxiYWNrOiAocHJvZ3Jlc3M6IEluZGV4UHJvZ3Jlc3MpID0+IHZvaWQ7XG4gIHByaXZhdGUgcmVhZG9ubHkgbm93OiAoKSA9PiBudW1iZXI7XG5cbiAgcHJpdmF0ZSBjdXJyZW50OiBJbmRleFByb2dyZXNzID0geyAuLi5JRExFIH07XG4gIHByaXZhdGUgcnVubmluZzogUHJvbWlzZTxJbmRleFByb2dyZXNzPiB8IHVuZGVmaW5lZDtcbiAgcHJpdmF0ZSBjYW5jZWxSZXF1ZXN0ZWQgPSBmYWxzZTtcbiAgcHJpdmF0ZSBsb2FkZWQgPSBmYWxzZTtcbiAgcHJpdmF0ZSBsYXN0U2F2ZUF0ID0gMDtcblxuICBjb25zdHJ1Y3RvcihvcHRpb25zOiB7XG4gICAgc3RvcmU6IFBkZkluZGV4U3RvcmU7XG4gICAgZW52aXJvbm1lbnQ6IEluZGV4RW52aXJvbm1lbnQ7XG4gICAgY29uZmlnOiAoKSA9PiBJbmRleENvbmZpZztcbiAgICBvblByb2dyZXNzPzogKHByb2dyZXNzOiBJbmRleFByb2dyZXNzKSA9PiB2b2lkO1xuICAgIG5vdz86ICgpID0+IG51bWJlcjtcbiAgfSkge1xuICAgIHRoaXMuc3RvcmUgPSBvcHRpb25zLnN0b3JlO1xuICAgIHRoaXMuZW52aXJvbm1lbnQgPSBvcHRpb25zLmVudmlyb25tZW50O1xuICAgIHRoaXMuY29uZmlnID0gb3B0aW9ucy5jb25maWc7XG4gICAgdGhpcy5vblByb2dyZXNzQ2FsbGJhY2sgPSBvcHRpb25zLm9uUHJvZ3Jlc3MgPz8gKCgpID0+IHVuZGVmaW5lZCk7XG4gICAgdGhpcy5ub3cgPSBvcHRpb25zLm5vdyA/PyAoKCkgPT4gRGF0ZS5ub3coKSk7XG4gIH1cblxuICBnZXQgcHJvZ3Jlc3MoKTogSW5kZXhQcm9ncmVzcyB7XG4gICAgcmV0dXJuIHsgLi4udGhpcy5jdXJyZW50IH07XG4gIH1cblxuICBnZXQgaXNSdW5uaW5nKCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBCb29sZWFuKHRoaXMucnVubmluZyk7XG4gIH1cblxuICAvKiogTG9hZHMgdGhlIHBlcnNpc3RlZCBpbmRleCBvbmNlLiBDaGVhcDogb25lIGZpbGUgcmVhZC4gKi9cbiAgYXN5bmMgbG9hZCgpOiBQcm9taXNlPHsgZW50cmllczogbnVtYmVyIH0+IHtcbiAgICBpZiAodGhpcy5sb2FkZWQpIHtcbiAgICAgIHJldHVybiB7IGVudHJpZXM6IHRoaXMuc3RvcmUuc2l6ZSB9O1xuICAgIH1cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnN0b3JlLmxvYWQoKTtcbiAgICB0aGlzLmxvYWRlZCA9IHRydWU7XG4gICAgcmV0dXJuIHsgZW50cmllczogcmVzdWx0LmVudHJpZXMgfTtcbiAgfVxuXG4gIC8qKiBSZXF1ZXN0cyBjYW5jZWxsYXRpb24gb2YgdGhlIHBhc3MgY3VycmVudGx5IHJ1bm5pbmcuICovXG4gIGNhbmNlbCgpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5ydW5uaW5nKSB7XG4gICAgICB0aGlzLmNhbmNlbFJlcXVlc3RlZCA9IHRydWU7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEluZGV4ZXMgd2hhdCBuZWVkcyBpbmRleGluZy4gQ29uY3VycmVudCBjYWxscyBzaGFyZSBvbmUgcGFzcywgc28gYSBidXJzdCBvZlxuICAgKiB0cmlnZ2VycyAodmlldyBvcGVuLCB0eXBpbmcsIGZpbGUgY2hhbmdlKSBjYW5ub3Qgc3RhcnQgb3ZlcmxhcHBpbmcgd29yay5cbiAgICovXG4gIGFzeW5jIGVuc3VyZUluZGV4ZWQob3B0aW9uczogSW5kZXhSdW5PcHRpb25zID0ge30pOiBQcm9taXNlPEluZGV4UHJvZ3Jlc3M+IHtcbiAgICBpZiAodGhpcy5ydW5uaW5nKSB7XG4gICAgICByZXR1cm4gdGhpcy5ydW5uaW5nO1xuICAgIH1cbiAgICB0aGlzLnJ1bm5pbmcgPSB0aGlzLnJ1bihvcHRpb25zKS5maW5hbGx5KCgpID0+IHtcbiAgICAgIHRoaXMucnVubmluZyA9IHVuZGVmaW5lZDtcbiAgICAgIHRoaXMuY2FuY2VsUmVxdWVzdGVkID0gZmFsc2U7XG4gICAgfSk7XG4gICAgcmV0dXJuIHRoaXMucnVubmluZztcbiAgfVxuXG4gIC8qKlxuICAgKiBEZWNpZGVzIHdoYXQgYSBwYXNzIHdvdWxkIGNvc3Qgd2l0aG91dCBleHRyYWN0aW5nIGFueXRoaW5nLlxuICAgKiBVc2VkIHRvIHNob3cgXCIxMiB1bmNoYW5nZWQsIDIgY2hhbmdlZFwiIGJlZm9yZSBzdGFydGluZy5cbiAgICovXG4gIGFzeW5jIHBsYW5QYXNzKCk6IFByb21pc2U8e1xuICAgIHRvdGFsOiBudW1iZXI7XG4gICAgY2hhbmdlZDogbnVtYmVyO1xuICAgIHVuY2hhbmdlZDogbnVtYmVyO1xuICAgIGJ5dGVzOiBudW1iZXI7XG4gICAgb3ZlcnNpemVkOiBudW1iZXI7XG4gICAgZGVzY3JpcHRpb246IHN0cmluZztcbiAgfT4ge1xuICAgIGF3YWl0IHRoaXMubG9hZCgpO1xuICAgIGNvbnN0IGNvbmZpZyA9IHRoaXMuY29uZmlnKCk7XG4gICAgY29uc3QgZmlsZXMgPSBhd2FpdCB0aGlzLmVudmlyb25tZW50Lmxpc3RGaWxlcygpO1xuICAgIGxldCBjaGFuZ2VkID0gMDtcbiAgICBsZXQgdW5jaGFuZ2VkID0gMDtcbiAgICBsZXQgYnl0ZXMgPSAwO1xuICAgIGxldCBvdmVyc2l6ZWQgPSAwO1xuXG4gICAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XG4gICAgICBjb25zdCBzdGF0cyA9IGF3YWl0IHRoaXMuZW52aXJvbm1lbnQuc3RhdChmaWxlLnBhdGgpO1xuICAgICAgaWYgKCFzdGF0cykge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChzdGF0cy5zaXplID4gY29uZmlnLm1heEZpbGVTaXplQnl0ZXMpIHtcbiAgICAgICAgb3ZlcnNpemVkICs9IDE7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKGlzRW50cnlWYWxpZCh0aGlzLnN0b3JlLnBlZWsoZmlsZS5wYXRoKSwgc3RhdHMpKSB7XG4gICAgICAgIHVuY2hhbmdlZCArPSAxO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY2hhbmdlZCArPSAxO1xuICAgICAgICBieXRlcyArPSBzdGF0cy5zaXplO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICB0b3RhbDogZmlsZXMubGVuZ3RoLFxuICAgICAgY2hhbmdlZCxcbiAgICAgIHVuY2hhbmdlZCxcbiAgICAgIGJ5dGVzLFxuICAgICAgb3ZlcnNpemVkLFxuICAgICAgZGVzY3JpcHRpb246IGRlc2NyaWJlU2Nhbih1bmNoYW5nZWQsIGNoYW5nZWQsIGJ5dGVzKSxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBlbWl0KHByb2dyZXNzOiBJbmRleFByb2dyZXNzKTogdm9pZCB7XG4gICAgdGhpcy5jdXJyZW50ID0gcHJvZ3Jlc3M7XG4gICAgdGhpcy5vblByb2dyZXNzQ2FsbGJhY2soeyAuLi5wcm9ncmVzcyB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuKG9wdGlvbnM6IEluZGV4UnVuT3B0aW9ucyk6IFByb21pc2U8SW5kZXhQcm9ncmVzcz4ge1xuICAgIGNvbnN0IHN0YXJ0ZWQgPSB0aGlzLm5vdygpO1xuICAgIGNvbnN0IHNpbGVudCA9IG9wdGlvbnMuc2lsZW50ID8/IGZhbHNlO1xuICAgIGNvbnN0IGNvbmZpZyA9IHRoaXMuY29uZmlnKCk7XG4gICAgdGhpcy5jYW5jZWxSZXF1ZXN0ZWQgPSBmYWxzZTtcblxuICAgIGNvbnN0IGJhc2U6IEluZGV4UHJvZ3Jlc3MgPSB7XG4gICAgICAuLi5JRExFLFxuICAgICAgcGhhc2U6ICdzY2FubmluZycsXG4gICAgICBlbGFwc2VkTXM6IDAsXG4gICAgfTtcbiAgICBpZiAoIXNpbGVudCkge1xuICAgICAgdGhpcy5lbWl0KGJhc2UpO1xuICAgIH1cblxuICAgIGF3YWl0IHRoaXMubG9hZCgpO1xuICAgIGNvbnN0IGZpbGVzID0gYXdhaXQgdGhpcy5lbnZpcm9ubWVudC5saXN0RmlsZXMoKS5jYXRjaCgoKSA9PiBbXSBhcyBGaWxlUmVmW10pO1xuXG4gICAgY29uc3QgcXVldWU6IHsgZmlsZTogRmlsZVJlZjsgc3RhdHM6IHsgbXRpbWVNczogbnVtYmVyOyBzaXplOiBudW1iZXIgfSB9W10gPSBbXTtcbiAgICBsZXQgY2FjaGVkID0gMDtcbiAgICBsZXQgc2tpcHBlZCA9IDA7XG5cbiAgICAvLyBQaGFzZSAxOiBtZXRhZGF0YSBvbmx5LlxuICAgIGZvciAoY29uc3QgZmlsZSBvZiBmaWxlcykge1xuICAgICAgaWYgKHRoaXMuY2FuY2VsUmVxdWVzdGVkKSB7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgY29uc3Qgc3RhdHMgPSBhd2FpdCB0aGlzLmVudmlyb25tZW50LnN0YXQoZmlsZS5wYXRoKTtcbiAgICAgIGlmICghc3RhdHMpIHtcbiAgICAgICAgc2tpcHBlZCArPSAxO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChzdGF0cy5zaXplID4gY29uZmlnLm1heEZpbGVTaXplQnl0ZXMpIHtcbiAgICAgICAgc2tpcHBlZCArPSAxO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChpc0VudHJ5VmFsaWQodGhpcy5zdG9yZS5wZWVrKGZpbGUucGF0aCksIHN0YXRzKSkge1xuICAgICAgICBjYWNoZWQgKz0gMTtcbiAgICAgICAgdGhpcy5zdG9yZS5ub3RlQ2FjaGVIaXQoc3RhdHMuc2l6ZSk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgcXVldWUucHVzaCh7IGZpbGUsIHN0YXRzIH0pO1xuICAgIH1cblxuICAgIGNvbnN0IHRvdGFsID0gZmlsZXMubGVuZ3RoO1xuICAgIGxldCBwcm9ncmVzczogSW5kZXhQcm9ncmVzcyA9IHtcbiAgICAgIC4uLmJhc2UsXG4gICAgICBwaGFzZTogcXVldWUubGVuZ3RoID8gJ2luZGV4aW5nJyA6ICdyZWFkeScsXG4gICAgICBwcm9jZXNzZWQ6IGNhY2hlZCArIHNraXBwZWQsXG4gICAgICB0b3RhbCxcbiAgICAgIGNhY2hlZCxcbiAgICAgIGZyb21DYWNoZTogY2FjaGVkLFxuICAgICAgc2tpcHBlZCxcbiAgICAgIGV4dHJhY3RlZDogMCxcbiAgICAgIGZhaWxlZDogMCxcbiAgICAgIGJ5dGVzOiBxdWV1ZS5yZWR1Y2UoKHN1bSwgaXRlbSkgPT4gc3VtICsgaXRlbS5zdGF0cy5zaXplLCAwKSxcbiAgICAgIGVsYXBzZWRNczogdGhpcy5ub3coKSAtIHN0YXJ0ZWQsXG4gICAgfTtcbiAgICBpZiAoIXNpbGVudCkge1xuICAgICAgdGhpcy5lbWl0KHByb2dyZXNzKTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5jYW5jZWxSZXF1ZXN0ZWQpIHtcbiAgICAgIGNvbnN0IGZpbmlzaGVkOiBJbmRleFByb2dyZXNzID0ge1xuICAgICAgICAuLi5wcm9ncmVzcyxcbiAgICAgICAgcGhhc2U6ICdjYW5jZWxsZWQnLFxuICAgICAgICBzdW1tYXJ5OiBgQ2FuY2VsbGVkIGFmdGVyICR7Y2FjaGVkfSBjYWNoZWQsICR7cXVldWUubGVuZ3RofSBwZW5kaW5nYCxcbiAgICAgICAgZWxhcHNlZE1zOiB0aGlzLm5vdygpIC0gc3RhcnRlZCxcbiAgICAgIH07XG4gICAgICBpZiAoIXNpbGVudCkge1xuICAgICAgICB0aGlzLmVtaXQoZmluaXNoZWQpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGZpbmlzaGVkO1xuICAgIH1cblxuICAgIGlmICghcXVldWUubGVuZ3RoKSB7XG4gICAgICBjb25zdCBmaW5pc2hlZDogSW5kZXhQcm9ncmVzcyA9IHtcbiAgICAgICAgLi4ucHJvZ3Jlc3MsXG4gICAgICAgIHBoYXNlOiAncmVhZHknLFxuICAgICAgICBzdW1tYXJ5OiBkZXNjcmliZVNjYW4oY2FjaGVkLCAwLCAwKSxcbiAgICAgICAgZWxhcHNlZE1zOiB0aGlzLm5vdygpIC0gc3RhcnRlZCxcbiAgICAgIH07XG4gICAgICBpZiAoIXNpbGVudCkge1xuICAgICAgICB0aGlzLmVtaXQoZmluaXNoZWQpO1xuICAgICAgfVxuICAgICAgb3B0aW9ucy5vbkNvbXBsZXRlPy4oZmluaXNoZWQpO1xuICAgICAgcmV0dXJuIGZpbmlzaGVkO1xuICAgIH1cblxuICAgIC8vIFBoYXNlIDI6IGV4dHJhY3Rpb24sIGJvdW5kZWQgY29uY3VycmVuY3kuXG4gICAgbGV0IGN1cnNvciA9IDA7XG4gICAgbGV0IGV4dHJhY3RlZCA9IDA7XG4gICAgbGV0IGZhaWxlZCA9IDA7XG4gICAgY29uc3QgY29uY3VycmVuY3kgPSBNYXRoLm1heCgxLCBNYXRoLm1pbig0LCBjb25maWcuY29uY3VycmVuY3kpKTtcblxuICAgIGNvbnN0IHdvcmtlciA9IGFzeW5jICgpOiBQcm9taXNlPHZvaWQ+ID0+IHtcbiAgICAgIHdoaWxlIChjdXJzb3IgPCBxdWV1ZS5sZW5ndGggJiYgIXRoaXMuY2FuY2VsUmVxdWVzdGVkKSB7XG4gICAgICAgIGNvbnN0IGl0ZW0gPSBxdWV1ZVtjdXJzb3JdO1xuICAgICAgICBjdXJzb3IgKz0gMTtcbiAgICAgICAgcHJvZ3Jlc3MgPSB7IC4uLnByb2dyZXNzLCBjdXJyZW50RmlsZTogaXRlbS5maWxlLm5hbWUgfTtcbiAgICAgICAgaWYgKCFzaWxlbnQpIHtcbiAgICAgICAgICB0aGlzLmVtaXQocHJvZ3Jlc3MpO1xuICAgICAgICB9XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgY29uc3QgYnl0ZXMgPSBhd2FpdCB0aGlzLmVudmlyb25tZW50LnJlYWQoaXRlbS5maWxlLnBhdGgpO1xuICAgICAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMuZW52aXJvbm1lbnQuZXh0cmFjdChieXRlcyk7XG4gICAgICAgICAgY29uc3QgbWF4Q2hhcnMgPSBjb25maWcubWF4VGV4dENoYXJzUGVyRmlsZTtcbiAgICAgICAgICBsZXQgdXNlZCA9IDA7XG4gICAgICAgICAgbGV0IHRydW5jYXRlZCA9IHJlc3VsdC50cnVuY2F0ZWQ7XG4gICAgICAgICAgY29uc3Qga2VwdDogc3RyaW5nW10gPSBbXTtcbiAgICAgICAgICBmb3IgKGNvbnN0IHBhZ2Ugb2YgcmVzdWx0LnBhZ2VzKSB7XG4gICAgICAgICAgICBpZiAodXNlZCA+PSBtYXhDaGFycykge1xuICAgICAgICAgICAgICB0cnVuY2F0ZWQgPSB0cnVlO1xuICAgICAgICAgICAgICBicmVhaztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IHNsaWNlID0gcGFnZS5sZW5ndGggPiBtYXhDaGFycyAtIHVzZWQgPyBwYWdlLnNsaWNlKDAsIG1heENoYXJzIC0gdXNlZCkgOiBwYWdlO1xuICAgICAgICAgICAgdXNlZCArPSBzbGljZS5sZW5ndGg7XG4gICAgICAgICAgICBrZXB0LnB1c2goc2xpY2UpO1xuICAgICAgICAgIH1cbiAgICAgICAgICB0aGlzLnN0b3JlLnNldCh7XG4gICAgICAgICAgICBwYXRoOiBpdGVtLmZpbGUucGF0aCxcbiAgICAgICAgICAgIG10aW1lTXM6IGl0ZW0uc3RhdHMubXRpbWVNcyxcbiAgICAgICAgICAgIHNpemU6IGl0ZW0uc3RhdHMuc2l6ZSxcbiAgICAgICAgICAgIHBhZ2VzOiByZXN1bHQudG90YWxQYWdlcyxcbiAgICAgICAgICAgIHRleHQ6IGtlcHQsXG4gICAgICAgICAgICBsb3dlcjoga2VwdC5tYXAoKHBhZ2UpID0+IHBhZ2UudG9Mb3dlckNhc2UoKSksXG4gICAgICAgICAgICB0cnVuY2F0ZWQsXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgZXh0cmFjdGVkICs9IDE7XG4gICAgICAgICAgYXdhaXQgdGhpcy5tYXliZVNhdmUoKTtcbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgZmFpbGVkICs9IDE7XG4gICAgICAgIH1cbiAgICAgICAgcHJvZ3Jlc3MgPSB7XG4gICAgICAgICAgLi4ucHJvZ3Jlc3MsXG4gICAgICAgICAgcHJvY2Vzc2VkOiBjYWNoZWQgKyBza2lwcGVkICsgZXh0cmFjdGVkICsgZmFpbGVkLFxuICAgICAgICAgIGV4dHJhY3RlZCxcbiAgICAgICAgICBmYWlsZWQsXG4gICAgICAgICAgZWxhcHNlZE1zOiB0aGlzLm5vdygpIC0gc3RhcnRlZCxcbiAgICAgICAgfTtcbiAgICAgICAgaWYgKCFzaWxlbnQpIHtcbiAgICAgICAgICB0aGlzLmVtaXQocHJvZ3Jlc3MpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfTtcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBQcm9taXNlLmFsbChcbiAgICAgICAgQXJyYXkuZnJvbSh7IGxlbmd0aDogTWF0aC5taW4oY29uY3VycmVuY3ksIHF1ZXVlLmxlbmd0aCkgfSwgKCkgPT4gd29ya2VyKCkpXG4gICAgICApO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBmYWlsZWRSdW46IEluZGV4UHJvZ3Jlc3MgPSB7XG4gICAgICAgIC4uLnByb2dyZXNzLFxuICAgICAgICBwaGFzZTogJ2Vycm9yJyxcbiAgICAgICAgZXJyb3I6IFN0cmluZyhlcnJvciksXG4gICAgICAgIGVsYXBzZWRNczogdGhpcy5ub3coKSAtIHN0YXJ0ZWQsXG4gICAgICB9O1xuICAgICAgdGhpcy5lbWl0KGZhaWxlZFJ1bik7XG4gICAgICByZXR1cm4gZmFpbGVkUnVuO1xuICAgIH1cblxuICAgIGF3YWl0IHRoaXMuc2F2ZSh0cnVlKTtcblxuICAgIGNvbnN0IGZpbmlzaGVkOiBJbmRleFByb2dyZXNzID0gdGhpcy5jYW5jZWxSZXF1ZXN0ZWRcbiAgICAgID8ge1xuICAgICAgICAgIC4uLnByb2dyZXNzLFxuICAgICAgICAgIHBoYXNlOiAnY2FuY2VsbGVkJyxcbiAgICAgICAgICBzdW1tYXJ5OiBgQ2FuY2VsbGVkIGFmdGVyICR7ZXh0cmFjdGVkfSBmaWxlKHMpYCxcbiAgICAgICAgICBlbGFwc2VkTXM6IHRoaXMubm93KCkgLSBzdGFydGVkLFxuICAgICAgICB9XG4gICAgICA6IHtcbiAgICAgICAgICAuLi5wcm9ncmVzcyxcbiAgICAgICAgICBwaGFzZTogJ3JlYWR5JyxcbiAgICAgICAgICBjdXJyZW50RmlsZTogdW5kZWZpbmVkLFxuICAgICAgICAgIHN1bW1hcnk6XG4gICAgICAgICAgICBleHRyYWN0ZWQgPT09IDBcbiAgICAgICAgICAgICAgPyBkZXNjcmliZVNjYW4oY2FjaGVkLCAwLCAwKVxuICAgICAgICAgICAgICA6IGBJbmRleGVkICR7ZXh0cmFjdGVkfSBmaWxlKHMpJHtjYWNoZWQgPyBgLCAke2NhY2hlZH0gYWxyZWFkeSBjYWNoZWRgIDogJyd9JHtcbiAgICAgICAgICAgICAgICAgIGZhaWxlZCA/IGAsICR7ZmFpbGVkfSBmYWlsZWRgIDogJydcbiAgICAgICAgICAgICAgICB9IGluICR7TWF0aC5tYXgoMSwgTWF0aC5yb3VuZCgodGhpcy5ub3coKSAtIHN0YXJ0ZWQpIC8gMTAwKSAvIDEwKX1zYCxcbiAgICAgICAgICBlbGFwc2VkTXM6IHRoaXMubm93KCkgLSBzdGFydGVkLFxuICAgICAgICB9O1xuXG4gICAgaWYgKCFzaWxlbnQpIHtcbiAgICAgIHRoaXMuZW1pdChmaW5pc2hlZCk7XG4gICAgfVxuICAgIGlmIChmaW5pc2hlZC5waGFzZSA9PT0gJ3JlYWR5Jykge1xuICAgICAgb3B0aW9ucy5vbkNvbXBsZXRlPy4oZmluaXNoZWQpO1xuICAgIH1cbiAgICByZXR1cm4gZmluaXNoZWQ7XG4gIH1cblxuICAvKiogUGVyc2lzdHMgYXQgbW9zdCBldmVyeSBmZXcgc2Vjb25kcyBkdXJpbmcgYSBsb25nIHBhc3MuICovXG4gIHByaXZhdGUgYXN5bmMgbWF5YmVTYXZlKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG5vdyA9IHRoaXMubm93KCk7XG4gICAgaWYgKG5vdyAtIHRoaXMubGFzdFNhdmVBdCA8IDUwMDApIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5sYXN0U2F2ZUF0ID0gbm93O1xuICAgIGF3YWl0IHRoaXMuc2F2ZShmYWxzZSk7XG4gIH1cblxuICAvKiogUmVhZHMgb25lIGluZGV4ZWQgZW50cnkgd2l0aG91dCB0b3VjaGluZyBpdHMgTFJVIHRpbWVzdGFtcC4gKi9cbiAgcGVla0VudHJ5KHBhdGg6IHN0cmluZykge1xuICAgIHJldHVybiB0aGlzLnN0b3JlLnBlZWsocGF0aCk7XG4gIH1cblxuICAvKiogRHJvcHMgb25lIGZpbGUgZnJvbSB0aGUgaW5kZXggKHVzZWQgd2hlbiBhIFBERiBjaGFuZ2VzIG9yIGRpc2FwcGVhcnMpLiAqL1xuICBpbnZhbGlkYXRlKHBhdGg/OiBzdHJpbmcpOiB2b2lkIHtcbiAgICBpZiAocGF0aCkge1xuICAgICAgdGhpcy5zdG9yZS5kZWxldGUocGF0aCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuc3RvcmUuY2xlYXIoKTtcbiAgICB9XG4gIH1cblxuICAvKiogUmVtb3ZlcyBjYWNoZWQgZW50cmllcyBmb3IgUERGcyB0aGF0IGFyZSBubyBsb25nZXIgaW4gdGhlIHdvcmtzcGFjZS4gKi9cbiAgYXN5bmMgcHJ1bmVUb0tub3duRmlsZXMoKTogUHJvbWlzZTxudW1iZXI+IHtcbiAgICBjb25zdCBmaWxlcyA9IGF3YWl0IHRoaXMuZW52aXJvbm1lbnQubGlzdEZpbGVzKCkuY2F0Y2goKCkgPT4gW10gYXMgRmlsZVJlZltdKTtcbiAgICBjb25zdCByZW1vdmVkID0gdGhpcy5zdG9yZS5yZXRhaW5Pbmx5KGZpbGVzLm1hcCgoZmlsZSkgPT4gZmlsZS5wYXRoKSk7XG4gICAgaWYgKHJlbW92ZWQgPiAwKSB7XG4gICAgICBhd2FpdCB0aGlzLnNhdmUodHJ1ZSk7XG4gICAgfVxuICAgIHJldHVybiByZW1vdmVkO1xuICB9XG5cbiAgYXN5bmMgc2F2ZShmb3JjZSA9IGZhbHNlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuc3RvcmUuc2F2ZShmb3JjZSk7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBBIGZhaWxlZCB3cml0ZSBtdXN0IG5ldmVyIGJyZWFrIGluZGV4aW5nOyB0aGUgaW5kZXggaXMgcmVidWlsdCBvbiBkZW1hbmQuXG4gICAgfVxuICB9XG5cbiAgYXN5bmMgcmVzZXQoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5zdG9yZS5jbGVhcigpO1xuICAgIGF3YWl0IHRoaXMuc3RvcmUuZHJvcCgpO1xuICAgIHRoaXMuZW1pdCh7IC4uLklETEUgfSk7XG4gIH1cblxuICBnZXQgaW5kZXhlZEZpbGVzKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMuc3RvcmUuc2l6ZTtcbiAgfVxufVxuIiwgIi8qKlxuICogUHVyZSB0ZXh0LW1hdGNoaW5nIGhlbHBlcnMuXG4gKlxuICogRGVsaWJlcmF0ZWx5IGZyZWUgb2YgYW55IGB2c2NvZGVgIGltcG9ydCBzbyB0aGUgbWF0Y2hpbmcgYmVoYXZpb3VyIChyYW5raW5nLFxuICogaGlnaGxpZ2h0cywgcGFnZSBhdHRyaWJ1dGlvbikgY2FuIGJlIHVuaXQgdGVzdGVkIHdpdGggcGxhaW4gTm9kZS5cbiAqL1xuXG5leHBvcnQgaW50ZXJmYWNlIFBhZ2VNYXRjaCB7XG4gIC8qKiBPbmUtYmFzZWQgcGFnZSBudW1iZXIuICovXG4gIHBhZ2U6IG51bWJlcjtcbiAgLyoqIDEtYmFzZWQgaW5kZXggb2YgdGhlIG9jY3VycmVuY2Ugb24gdGhhdCBwYWdlLiAqL1xuICBvcmRpbmFsOiBudW1iZXI7XG4gIC8qKiBUZXh0IGFyb3VuZCB0aGUgbWF0Y2guICovXG4gIGV4Y2VycHQ6IHN0cmluZztcbiAgLyoqIE1hdGNoIG9mZnNldCBpbnNpZGUgdGhlIGV4Y2VycHQsIGZvciBoaWdobGlnaHRpbmcuICovXG4gIG9mZnNldDogbnVtYmVyO1xuICAvKiogTGVuZ3RoIG9mIHRoZSBtYXRjaGVkIHRleHQuICovXG4gIGxlbmd0aDogbnVtYmVyO1xufVxuXG5leHBvcnQgY29uc3QgRVhDRVJQVF9QQUQgPSA2MDtcbmV4cG9ydCBjb25zdCBNQVhfTUFUQ0hFU19QRVJfRklMRSA9IDQwO1xuXG4vKiogQ29sbGFwc2VzIHJ1bnMgb2Ygd2hpdGVzcGFjZSBzbyBleGNlcnB0cyByZW5kZXIgb24gb25lIGxpbmUuICovXG5mdW5jdGlvbiBjb25kZW5zZSh0ZXh0OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gdGV4dC5yZXBsYWNlKC9cXHMrL2csICcgJyk7XG59XG5cbi8qKlxuICogRmluZHMgZXZlcnkgb2NjdXJyZW5jZSBvZiBgbmVlZGxlYCBhY3Jvc3MgcGFnZXMsIGNhc2UtaW5zZW5zaXRpdmVseS5cbiAqXG4gKiBgcGFnZXNgIGFuZCBgbG93ZXJQYWdlc2AgbXVzdCBiZSBwYXJhbGxlbCBhcnJheXM6IG9yaWdpbmFsIHRleHQgYW5kIGl0c1xuICogbG93ZXItY2FzZWQgdHdpbiwgd2hpY2gga2VlcHMgdGhlIHNlYXJjaCBjYXNlLWluc2Vuc2l0aXZlIHdpdGhvdXRcbiAqIHJlLWxvd2VyLWNhc2luZyBsYXJnZSBkb2N1bWVudHMgb24gZXZlcnkga2V5c3Ryb2tlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbWF0Y2hQYWdlcyhcbiAgcGFnZXM6IHN0cmluZ1tdLFxuICBsb3dlclBhZ2VzOiBzdHJpbmdbXSxcbiAgbmVlZGxlOiBzdHJpbmcsXG4gIG1heE1hdGNoZXMgPSBNQVhfTUFUQ0hFU19QRVJfRklMRVxuKTogeyBtYXRjaGVzOiBQYWdlTWF0Y2hbXTsgbWF0Y2hDb3VudDogbnVtYmVyIH0ge1xuICBjb25zdCBxdWVyeSA9IG5lZWRsZS50b0xvd2VyQ2FzZSgpO1xuICBjb25zdCBtYXRjaGVzOiBQYWdlTWF0Y2hbXSA9IFtdO1xuICBsZXQgbWF0Y2hDb3VudCA9IDA7XG4gIGlmICghcXVlcnkpIHtcbiAgICByZXR1cm4geyBtYXRjaGVzLCBtYXRjaENvdW50IH07XG4gIH1cblxuICBmb3IgKGxldCBwYWdlSW5kZXggPSAwOyBwYWdlSW5kZXggPCBsb3dlclBhZ2VzLmxlbmd0aDsgcGFnZUluZGV4ICs9IDEpIHtcbiAgICBjb25zdCBwYWdlTG93ZXIgPSBsb3dlclBhZ2VzW3BhZ2VJbmRleF07XG4gICAgY29uc3QgcGFnZVRleHQgPSBwYWdlc1twYWdlSW5kZXhdID8/ICcnO1xuICAgIGxldCBmcm9tID0gMDtcbiAgICBsZXQgb3JkaW5hbCA9IDA7XG4gICAgZm9yICg7Oykge1xuICAgICAgY29uc3QgYXQgPSBwYWdlTG93ZXIuaW5kZXhPZihxdWVyeSwgZnJvbSk7XG4gICAgICBpZiAoYXQgPT09IC0xKSB7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgICAgb3JkaW5hbCArPSAxO1xuICAgICAgbWF0Y2hDb3VudCArPSAxO1xuICAgICAgaWYgKG1hdGNoZXMubGVuZ3RoIDwgbWF4TWF0Y2hlcykge1xuICAgICAgICBjb25zdCBzdGFydCA9IE1hdGgubWF4KDAsIGF0IC0gRVhDRVJQVF9QQUQpO1xuICAgICAgICBjb25zdCBlbmQgPSBNYXRoLm1pbihwYWdlVGV4dC5sZW5ndGgsIGF0ICsgcXVlcnkubGVuZ3RoICsgRVhDRVJQVF9QQUQpO1xuICAgICAgICBjb25zdCByYXcgPSBwYWdlVGV4dC5zbGljZShzdGFydCwgZW5kKTtcbiAgICAgICAgY29uc3QgY29uZGVuc2VkID0gY29uZGVuc2UocmF3KTtcbiAgICAgICAgLy8gUmUtYW5jaG9yIHRoZSBvZmZzZXQgaW5zaWRlIHRoZSBjb25kZW5zZWQgZXhjZXJwdDogZXZlcnl0aGluZyBiZWZvcmVcbiAgICAgICAgLy8gdGhlIG1hdGNoIHNocmlua3MgYnkgdGhlIHdoaXRlc3BhY2UgdGhhdCB3YXMgY29sbGFwc2VkIGF3YXkuXG4gICAgICAgIGNvbnN0IGJlZm9yZSA9IGNvbmRlbnNlKHBhZ2VUZXh0LnNsaWNlKHN0YXJ0LCBhdCkpO1xuICAgICAgICBjb25zdCBvZmZzZXQgPSBiZWZvcmUubGVuZ3RoO1xuICAgICAgICBtYXRjaGVzLnB1c2goe1xuICAgICAgICAgIHBhZ2U6IHBhZ2VJbmRleCArIDEsXG4gICAgICAgICAgb3JkaW5hbCxcbiAgICAgICAgICBleGNlcnB0OiBgJHtzdGFydCA+IDAgPyAnXHUyMDI2JyA6ICcnfSR7Y29uZGVuc2VkfSR7ZW5kIDwgcGFnZVRleHQubGVuZ3RoID8gJ1x1MjAyNicgOiAnJ31gLFxuICAgICAgICAgIG9mZnNldDogTWF0aC5taW4ob2Zmc2V0ICsgKHN0YXJ0ID4gMCA/IDEgOiAwKSwgY29uZGVuc2VkLmxlbmd0aCksXG4gICAgICAgICAgbGVuZ3RoOiBxdWVyeS5sZW5ndGgsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgZnJvbSA9IGF0ICsgcXVlcnkubGVuZ3RoO1xuICAgIH1cbiAgfVxuICByZXR1cm4geyBtYXRjaGVzLCBtYXRjaENvdW50IH07XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgTmFtZU1hdGNoPFQ+IHtcbiAgZmlsZTogVDtcbiAgc2NvcmU6IG51bWJlcjtcbn1cblxuLyoqXG4gKiBSYW5rcyBmaWxlcyB3aG9zZSBuYW1lIG1hdGNoZXMgYmVzdCwgdGhlbiBmYWxscyBiYWNrIHRvIHBhdGggbWF0Y2hlcy5cbiAqIEEgbmFtZSBoaXQgYWx3YXlzIG91dHJhbmtzIGEgcGF0aC1vbmx5IGhpdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJhbmtOYW1lTWF0Y2hlczxUIGV4dGVuZHMgeyBuYW1lOiBzdHJpbmc7IHJlbGF0aXZlUGF0aD86IHN0cmluZyB9PihcbiAgZmlsZXM6IFRbXSxcbiAgcXVlcnk6IHN0cmluZ1xuKTogVFtdIHtcbiAgY29uc3QgbmVlZGxlID0gcXVlcnkudG9Mb3dlckNhc2UoKTtcbiAgaWYgKCFuZWVkbGUpIHtcbiAgICByZXR1cm4gW107XG4gIH1cbiAgY29uc3Qgc2NvcmVkOiBOYW1lTWF0Y2g8VD5bXSA9IFtdO1xuICBmb3IgKGNvbnN0IGZpbGUgb2YgZmlsZXMpIHtcbiAgICBjb25zdCBuYW1lID0gZmlsZS5uYW1lLnRvTG93ZXJDYXNlKCk7XG4gICAgY29uc3QgcmVsID0gKGZpbGUucmVsYXRpdmVQYXRoID8/ICcnKS50b0xvd2VyQ2FzZSgpO1xuICAgIGNvbnN0IGluTmFtZSA9IG5hbWUuaW5kZXhPZihuZWVkbGUpO1xuICAgIGNvbnN0IGluUGF0aCA9IHJlbC5pbmRleE9mKG5lZWRsZSk7XG4gICAgaWYgKGluTmFtZSAhPT0gLTEpIHtcbiAgICAgIHNjb3JlZC5wdXNoKHsgZmlsZSwgc2NvcmU6IDEwMDAgLSBpbk5hbWUgKiA1IH0pO1xuICAgIH0gZWxzZSBpZiAoaW5QYXRoICE9PSAtMSkge1xuICAgICAgc2NvcmVkLnB1c2goeyBmaWxlLCBzY29yZTogNTAwIC0gaW5QYXRoICogMiB9KTtcbiAgICB9XG4gIH1cbiAgc2NvcmVkLnNvcnQoKGEsIGIpID0+IGIuc2NvcmUgLSBhLnNjb3JlIHx8IGEuZmlsZS5uYW1lLmxvY2FsZUNvbXBhcmUoYi5maWxlLm5hbWUpKTtcbiAgcmV0dXJuIHNjb3JlZC5tYXAoKHJvdykgPT4gcm93LmZpbGUpO1xufVxuIiwgImltcG9ydCAqIGFzIGZzIGZyb20gJ25vZGU6ZnMvcHJvbWlzZXMnO1xuaW1wb3J0IHR5cGUgeyBEaXJlbnQgfSBmcm9tICdub2RlOmZzJztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAnbm9kZTpwYXRoJztcblxuZXhwb3J0IGludGVyZmFjZSBXYWxrT3B0aW9ucyB7XG4gIC8qKiBEaXJlY3RvcnkgbmFtZXMgdGhhdCBhcmUgYWx3YXlzIHNraXBwZWQuICovXG4gIHNraXBEaXJlY3Rvcmllcz86IFNldDxzdHJpbmc+O1xuICAvKiogTWF4aW11bSBudW1iZXIgb2YgUERGcyByZXR1cm5lZC4gKi9cbiAgbGltaXQ/OiBudW1iZXI7XG4gIC8qKiBNYXhpbXVtIGRpcmVjdG9yeSBkZXB0aCBiZWxvdyB0aGUgcm9vdC4gKi9cbiAgbWF4RGVwdGg/OiBudW1iZXI7XG59XG5cbmNvbnN0IERFRkFVTFRfU0tJUCA9IG5ldyBTZXQoWydub2RlX21vZHVsZXMnLCAnLmdpdCcsICdkaXN0JywgJ2J1aWxkJywgJ291dCcsICcubmV4dCcsICcudmVudiddKTtcblxuLyoqXG4gKiBEZXB0aC1maXJzdCBzZWFyY2ggZm9yIFBERnMgYmVsb3cgYHJvb3RgLlxuICpcbiAqIFRoaXMgZXhpc3RzIGFzIGEgZmFsbGJhY2sgZm9yIHRoZSB3b3Jrc3BhY2Ugc2VhcmNoIEFQSTogaXQgaXMgdXNlZCB3aGVuXG4gKiBzZWFyY2hpbmcgdGhlIGZpbGVzeXN0ZW0gZGlyZWN0bHkgaXMgcHJlZmVyYWJsZSAodmVyeSBsYXJnZSByZXBvcywgb3IgYVxuICogc2VhcmNoIEFQSSBmYWlsdXJlKS4gSXQgaXMgcGxhaW4gTm9kZSwgc28gaXQgaXMgdW5pdCB0ZXN0YWJsZS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGZpbmRQZGZGaWxlc0luRGlyZWN0b3J5KHJvb3Q6IHN0cmluZywgb3B0aW9uczogV2Fsa09wdGlvbnMgPSB7fSk6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgY29uc3Qgc2tpcCA9IG9wdGlvbnMuc2tpcERpcmVjdG9yaWVzID8/IERFRkFVTFRfU0tJUDtcbiAgY29uc3QgbGltaXQgPSBvcHRpb25zLmxpbWl0ID8/IDUwMDA7XG4gIGNvbnN0IG1heERlcHRoID0gb3B0aW9ucy5tYXhEZXB0aCA/PyAyNDtcbiAgY29uc3QgZm91bmQ6IHN0cmluZ1tdID0gW107XG5cbiAgY29uc3QgdmlzaXQgPSBhc3luYyAoZGlyZWN0b3J5OiBzdHJpbmcsIGRlcHRoOiBudW1iZXIpOiBQcm9taXNlPHZvaWQ+ID0+IHtcbiAgICBpZiAoZGVwdGggPiBtYXhEZXB0aCB8fCBmb3VuZC5sZW5ndGggPj0gbGltaXQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgbGV0IGVudHJpZXM6IERpcmVudFtdO1xuICAgIHRyeSB7XG4gICAgICBlbnRyaWVzID0gYXdhaXQgZnMucmVhZGRpcihkaXJlY3RvcnksIHsgd2l0aEZpbGVUeXBlczogdHJ1ZSB9KTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybjsgLy8gdW5yZWFkYWJsZSBkaXJlY3Rvcnk6IHNraXAgc2lsZW50bHlcbiAgICB9XG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBlbnRyaWVzKSB7XG4gICAgICBpZiAoZm91bmQubGVuZ3RoID49IGxpbWl0KSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGFic29sdXRlID0gcGF0aC5qb2luKGRpcmVjdG9yeSwgZW50cnkubmFtZSk7XG4gICAgICBpZiAoZW50cnkuaXNEaXJlY3RvcnkoKSkge1xuICAgICAgICBpZiAoc2tpcC5oYXMoZW50cnkubmFtZSkgfHwgZW50cnkubmFtZS5zdGFydHNXaXRoKCcuJykpIHtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBhd2FpdCB2aXNpdChhYnNvbHV0ZSwgZGVwdGggKyAxKTtcbiAgICAgIH0gZWxzZSBpZiAoZW50cnkuaXNGaWxlKCkgJiYgZW50cnkubmFtZS50b0xvd2VyQ2FzZSgpLmVuZHNXaXRoKCcucGRmJykpIHtcbiAgICAgICAgZm91bmQucHVzaChhYnNvbHV0ZSk7XG4gICAgICB9XG4gICAgfVxuICB9O1xuXG4gIGF3YWl0IHZpc2l0KHJvb3QsIDApO1xuICByZXR1cm4gZm91bmQ7XG59XG4iLCAiLyoqXG4gKiBJc29sYXRlZCBQREYgdGV4dCBleHRyYWN0aW9uLlxuICpcbiAqIHBkZi5qcyBpcyBsb2FkZWQgbGF6aWx5IHNvIHRoYXQgYWN0aXZhdGlvbiBzdGF5cyBjaGVhcCBhbmQgYSBwZGYuanMgcHJvYmxlbVxuICogY2FuIG5ldmVyIGJyZWFrIGV4dGVuc2lvbiBhY3RpdmF0aW9uLiBTd2FwcGluZyBpbiBhbm90aGVyIGVuZ2luZSBsYXRlciBvbmx5XG4gKiBtZWFucyByZXBsYWNpbmcgdGhpcyBmaWxlLlxuICovXG5cbmltcG9ydCAqIGFzIHBhdGggZnJvbSAnbm9kZTpwYXRoJztcbmltcG9ydCB7IHBhdGhUb0ZpbGVVUkwgfSBmcm9tICdub2RlOnVybCc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgUGRmVGV4dEV4dHJhY3RvciB7XG4gIC8qKiBSZXR1cm5zIG9uZSBzdHJpbmcgcGVyIHBhZ2UsIGluIGRvY3VtZW50IG9yZGVyLiAqL1xuICBleHRyYWN0KGRhdGE6IFVpbnQ4QXJyYXkpOiBQcm9taXNlPHN0cmluZ1tdPjtcbn1cblxudHlwZSBQZGZKcyA9IHtcbiAgR2xvYmFsV29ya2VyT3B0aW9uczogeyB3b3JrZXJTcmM6IHN0cmluZyB9O1xuICBnZXREb2N1bWVudChzcmM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KToge1xuICAgIHByb21pc2U6IFByb21pc2U8UGRmRG9jdW1lbnQ+O1xuICAgIGRlc3Ryb3koKTogUHJvbWlzZTx2b2lkPjtcbiAgfTtcbn07XG5cbnR5cGUgUGRmRG9jdW1lbnQgPSB7XG4gIG51bVBhZ2VzOiBudW1iZXI7XG4gIGdldFBhZ2UobjogbnVtYmVyKTogUHJvbWlzZTxQZGZQYWdlPjtcbiAgZGVzdHJveSgpOiBQcm9taXNlPHZvaWQ+O1xufTtcblxudHlwZSBQZGZQYWdlID0ge1xuICBnZXRUZXh0Q29udGVudCgpOiBQcm9taXNlPHsgaXRlbXM6IHsgc3RyPzogc3RyaW5nOyBoYXNFT0w/OiBib29sZWFuIH1bXSB9Pjtcbn07XG5cbmxldCBwZGZqc1Byb21pc2U6IFByb21pc2U8UGRmSnM+IHwgdW5kZWZpbmVkO1xuLyoqIERpcmVjdG9yeSBob2xkaW5nIHRoZSBjb3BpZWQgcGRmLmpzIGFzc2V0cyAoZGlzdC8gbmV4dCB0byBleHRlbnNpb24uanMpLiAqL1xubGV0IGFzc2V0QmFzZURpcmVjdG9yeSA9IF9fZGlybmFtZTtcblxuLyoqIExldHMgdGVzdHMgcG9pbnQgdGhlIGxvYWRlciBhdCBhbm90aGVyIGFzc2V0IGRpcmVjdG9yeS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXRQZGZBc3NldERpcmVjdG9yeShkaXJlY3Rvcnk6IHN0cmluZyk6IHZvaWQge1xuICBhc3NldEJhc2VEaXJlY3RvcnkgPSBkaXJlY3Rvcnk7XG4gIHBkZmpzUHJvbWlzZSA9IHVuZGVmaW5lZDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gbG9hZFBkZkpzKCk6IFByb21pc2U8UGRmSnM+IHtcbiAgaWYgKCFwZGZqc1Byb21pc2UpIHtcbiAgICBwZGZqc1Byb21pc2UgPSAoYXN5bmMgKCkgPT4ge1xuICAgICAgLy8gTG9hZGVkIGFzIGEgcmVhbCBFU00gZmlsZSwgbmV2ZXIgYnVuZGxlZDogcGRmLmpzIGNhbGxzIE5vZGUncyBgcmVxdWlyZWBcbiAgICAgIC8vIGludGVybmFsbHkgYW5kIGEgYnVuZGxlZCBjb3B5IHdvdWxkIGJyZWFrIHRoYXQuXG4gICAgICBjb25zdCBtb2R1bGVVcmwgPSBwYXRoVG9GaWxlVVJMKHBhdGguam9pbihhc3NldEJhc2VEaXJlY3RvcnksICdwZGYubWpzJykpLmhyZWY7XG4gICAgICBjb25zdCBtb2QgPSAoYXdhaXQgaW1wb3J0KG1vZHVsZVVybCkpIGFzIHVua25vd24gYXMgUGRmSnM7XG4gICAgICAvLyBUaGUgZXh0ZW5zaW9uIGhvc3QgaGFzIG5vIERPTSB3b3JrZXIsIHNvIHBkZi5qcyBydW5zIGl0cyBpbi1wcm9jZXNzXG4gICAgICAvLyB3b3JrZXIuIEl0IHN0aWxsIG5lZWRzIGEgcmVzb2x2YWJsZSB3b3JrZXIgVVJMIHRvIGJvb3RzdHJhcCB0aGF0IHBhdGgsXG4gICAgICAvLyB3aGljaCBpcyB3aHkgdGhlIGJ1aWxkIGNvcGllcyBgcGRmLndvcmtlci5tanNgIG5leHQgdG8gdGhlIGJ1bmRsZS5cbiAgICAgIG1vZC5HbG9iYWxXb3JrZXJPcHRpb25zLndvcmtlclNyYyA9IHBhdGhUb0ZpbGVVUkwoXG4gICAgICAgIHBhdGguam9pbihhc3NldEJhc2VEaXJlY3RvcnksICdwZGYud29ya2VyLm1qcycpXG4gICAgICApLmhyZWY7XG4gICAgICByZXR1cm4gbW9kO1xuICAgIH0pKCk7XG4gIH1cbiAgcmV0dXJuIHBkZmpzUHJvbWlzZTtcbn1cblxuZnVuY3Rpb24gam9pblBhZ2UoaXRlbXM6IHsgc3RyPzogc3RyaW5nOyBoYXNFT0w/OiBib29sZWFuIH1bXSk6IHN0cmluZyB7XG4gIGxldCBvdXQgPSAnJztcbiAgZm9yIChjb25zdCBpdGVtIG9mIGl0ZW1zKSB7XG4gICAgaWYgKHR5cGVvZiBpdGVtLnN0ciA9PT0gJ3N0cmluZycpIHtcbiAgICAgIG91dCArPSBpdGVtLnN0cjtcbiAgICB9XG4gICAgb3V0ICs9IGl0ZW0uaGFzRU9MID8gJ1xcbicgOiAnICc7XG4gIH1cbiAgcmV0dXJuIG91dC5yZXBsYWNlKC9bIFxcdF0rL2csICcgJykudHJpbSgpO1xufVxuXG5leHBvcnQgY29uc3QgcGRmVGV4dEV4dHJhY3RvcjogUGRmVGV4dEV4dHJhY3RvciA9IHtcbiAgYXN5bmMgZXh0cmFjdChkYXRhOiBVaW50OEFycmF5KTogUHJvbWlzZTxzdHJpbmdbXT4ge1xuICAgIGNvbnN0IHBkZmpzID0gYXdhaXQgbG9hZFBkZkpzKCk7XG4gICAgY29uc3QgdGFzayA9IHBkZmpzLmdldERvY3VtZW50KHtcbiAgICAgIGRhdGEsXG4gICAgICBpc0V2YWxTdXBwb3J0ZWQ6IGZhbHNlLFxuICAgICAgZGlzYWJsZUZvbnRGYWNlOiB0cnVlLFxuICAgICAgdXNlU3lzdGVtRm9udHM6IGZhbHNlLFxuICAgICAgLy8gUmVxdWlyZWQ6IHdpdGhvdXQgaXQgcGRmLmpzIGNhbm5vdCBib290c3RyYXAgaXRzIGluLXByb2Nlc3Mgd29ya2VyLlxuICAgICAgc3RhbmRhcmRGb250RGF0YVVybDogYCR7cGF0aFRvRmlsZVVSTChwYXRoLmpvaW4oYXNzZXRCYXNlRGlyZWN0b3J5LCAnc3RhbmRhcmRfZm9udHMnKSkuaHJlZn0vYCxcbiAgICAgIC8vIHBkZi5qcyBvbmx5IGxvYWRzIHN0YW5kYXJkIGZvbnQgbWV0cmljcyBvdmVyIGh0dHAocyksIHdoaWNoIGEgTm9kZVxuICAgICAgLy8gZXh0ZW5zaW9uIGhvc3QgbmV2ZXIgaGFzLCBzbyBpdCB3b3VsZCB3YXJuIGZvciBldmVyeSBQREYgdGhhdCB1c2VzIG9uZVxuICAgICAgLy8gb2YgdGhlIDE0IGJ1aWx0LWluIGZvbnRzLiBFcnJvcnMgYXJlIHN0aWxsIHJlcG9ydGVkIGF0IHRoaXMgbGV2ZWwuXG4gICAgICB2ZXJib3NpdHk6IDAsXG4gICAgfSk7XG4gICAgY29uc3QgZG9jID0gYXdhaXQgdGFzay5wcm9taXNlO1xuICAgIGNvbnN0IHBhZ2VzOiBzdHJpbmdbXSA9IFtdO1xuICAgIHRyeSB7XG4gICAgICBmb3IgKGxldCBwYWdlTnVtYmVyID0gMTsgcGFnZU51bWJlciA8PSBkb2MubnVtUGFnZXM7IHBhZ2VOdW1iZXIgKz0gMSkge1xuICAgICAgICBjb25zdCBwYWdlID0gYXdhaXQgZG9jLmdldFBhZ2UocGFnZU51bWJlcik7XG4gICAgICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCBwYWdlLmdldFRleHRDb250ZW50KCk7XG4gICAgICAgIHBhZ2VzLnB1c2goam9pblBhZ2UoY29udGVudC5pdGVtcykpO1xuICAgICAgICBjb25zdCBjbGVhbnVwID0gKHBhZ2UgYXMgdW5rbm93biBhcyB7IGNsZWFudXA/OiAoKSA9PiB2b2lkIH0pLmNsZWFudXA7XG4gICAgICAgIGlmICh0eXBlb2YgY2xlYW51cCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgIGNsZWFudXAuY2FsbChwYWdlKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICBhd2FpdCBkb2MuZGVzdHJveSgpLmNhdGNoKCgpID0+IHVuZGVmaW5lZCk7XG4gICAgfVxuICAgIHJldHVybiBwYWdlcztcbiAgfSxcbn07XG5cbi8qKiBUZXN0IGhvb2s6IGZvcmdldCB0aGUgY2FjaGVkIHBkZi5qcyBpbnN0YW5jZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZXNldFBkZkpzQ2FjaGUoKTogdm9pZCB7XG4gIHBkZmpzUHJvbWlzZSA9IHVuZGVmaW5lZDtcbn1cbiIsICJpbXBvcnQgKiBhcyB2c2NvZGUgZnJvbSAndnNjb2RlJztcbmltcG9ydCB7IFN0b3JlQ29yZSwgdHlwZSBLZXlWYWx1ZVN0b3JlIH0gZnJvbSAnLi9zdG9yZUNvcmUudHMnO1xuaW1wb3J0IHR5cGUgeyBGaWxlUmVmLCBQZXJzaXN0ZWRTdGF0ZSwgU21hcnRSdWxlIH0gZnJvbSAnLi90eXBlcy50cyc7XG5cbmV4cG9ydCB0eXBlIHsgRmlsZVJlZiwgUGVyc2lzdGVkU3RhdGUsIFNtYXJ0UnVsZSB9O1xuXG4vKipcbiAqIFZTIENvZGUgYWRhcHRlciBhcm91bmQgYFN0b3JlQ29yZWAuXG4gKlxuICogRXZlcnl0aGluZyBkb21haW4tc3BlY2lmaWMgbGl2ZXMgaW4gYHN0b3JlQ29yZS50c2AgKHdoaWNoIGlzIHVuaXQgdGVzdGVkKTtcbiAqIHRoaXMgZmlsZSBvbmx5IHN1cHBsaWVzIHRoZSBlbnZpcm9ubWVudDogbWVtZW50b3MsIGNvbmZpZ3VyYXRpb24sIHRoZSBjaGFuZ2VcbiAqIGV2ZW50IGFuZCB0aGUgZGVib3VuY2UgdGltZXIuXG4gKi9cbmV4cG9ydCBjbGFzcyBTdG9yZSB7XG4gIHByaXZhdGUgcmVhZG9ubHkgY29yZTogU3RvcmVDb3JlO1xuICBwcml2YXRlIHJlYWRvbmx5IGVtaXR0ZXIgPSBuZXcgdnNjb2RlLkV2ZW50RW1pdHRlcjx2b2lkPigpO1xuICByZWFkb25seSBvbkRpZENoYW5nZSA9IHRoaXMuZW1pdHRlci5ldmVudDtcbiAgcHJpdmF0ZSBzYXZlVGltZXI6IE5vZGVKUy5UaW1lb3V0IHwgdW5kZWZpbmVkO1xuXG4gIGNvbnN0cnVjdG9yKGNvbnRleHQ6IHZzY29kZS5FeHRlbnNpb25Db250ZXh0KSB7XG4gICAgdGhpcy5jb3JlID0gbmV3IFN0b3JlQ29yZSh7XG4gICAgICB3b3Jrc3BhY2VTdGF0ZTogYXNLZXlWYWx1ZVN0b3JlKGNvbnRleHQud29ya3NwYWNlU3RhdGUpLFxuICAgICAgZ2xvYmFsU3RhdGU6IGFzS2V5VmFsdWVTdG9yZShjb250ZXh0Lmdsb2JhbFN0YXRlKSxcbiAgICAgIGNvbmZpZzogPFQ+KGtleTogc3RyaW5nLCBmYWxsYmFjazogVCk6IFQgPT5cbiAgICAgICAgdnNjb2RlLndvcmtzcGFjZS5nZXRDb25maWd1cmF0aW9uKCdwZGZIdWInKS5nZXQ8VD4oa2V5LCBmYWxsYmFjayksXG4gICAgICBlbWl0dGVyOiB7IGZpcmU6ICgpID0+IHRoaXMuZW1pdHRlci5maXJlKCksIGRpc3Bvc2U6ICgpID0+IHVuZGVmaW5lZCB9LFxuICAgICAgZGVmYXVsdEdyb3VwTmFtZTogdnNjb2RlLndvcmtzcGFjZVxuICAgICAgICAuZ2V0Q29uZmlndXJhdGlvbigncGRmSHViJylcbiAgICAgICAgLmdldDxzdHJpbmc+KCdmYXZvcml0ZXMuZGVmYXVsdEdyb3VwTmFtZScsICdGYXZvcml0ZXMnKSxcbiAgICAgIGV4aXN0czogKHBhdGgpID0+IHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICByZXR1cm4gcmVxdWlyZSgnbm9kZTpmcycpLmV4aXN0c1N5bmMocGF0aCkgYXMgYm9vbGVhbjtcbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgc2NoZWR1bGU6IChjYWxsYmFjaykgPT4ge1xuICAgICAgICBpZiAodGhpcy5zYXZlVGltZXIpIHtcbiAgICAgICAgICBjbGVhclRpbWVvdXQodGhpcy5zYXZlVGltZXIpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuc2F2ZVRpbWVyID0gc2V0VGltZW91dChjYWxsYmFjaywgMjUwKTtcbiAgICAgIH0sXG4gICAgICBjYW5jZWxTY2hlZHVsZWQ6ICgpID0+IHtcbiAgICAgICAgaWYgKHRoaXMuc2F2ZVRpbWVyKSB7XG4gICAgICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuc2F2ZVRpbWVyKTtcbiAgICAgICAgICB0aGlzLnNhdmVUaW1lciA9IHVuZGVmaW5lZDtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICB9KTtcbiAgfVxuXG4gIC8vIFRoZSBjb3JlIG93bnMgdGhlIGJlaGF2aW91cjsgdGhlIGFkYXB0ZXIgZm9yd2FyZHMgc28gY2FsbCBzaXRlcyBzdGF5IHNpbXBsZS5cbiAgZ2V0IGV4dGVybmFsTWF4KCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMuY29yZS5leHRlcm5hbE1heDtcbiAgfVxuXG4gIGdldCBkZWZhdWx0R3JvdXBJZCgpOiBzdHJpbmcge1xuICAgIHJldHVybiB0aGlzLmNvcmUuZGVmYXVsdEdyb3VwSWQ7XG4gIH1cblxuICBhc3luYyBmbHVzaCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLmNvcmUuZmx1c2goKTtcbiAgfVxuXG4gIGdldEdyb3VwcygpIHtcbiAgICByZXR1cm4gdGhpcy5jb3JlLmdldEdyb3VwcygpO1xuICB9XG5cbiAgZ2V0R3JvdXAoaWQ6IHN0cmluZykge1xuICAgIHJldHVybiB0aGlzLmNvcmUuZ2V0R3JvdXAoaWQpO1xuICB9XG5cbiAgY3JlYXRlR3JvdXAobmFtZTogc3RyaW5nKSB7XG4gICAgcmV0dXJuIHRoaXMuY29yZS5jcmVhdGVHcm91cChuYW1lKTtcbiAgfVxuXG4gIHJlbmFtZUdyb3VwKGlkOiBzdHJpbmcsIG5hbWU6IHN0cmluZyk6IHZvaWQge1xuICAgIHRoaXMuY29yZS5yZW5hbWVHcm91cChpZCwgbmFtZSk7XG4gIH1cblxuICBkZWxldGVHcm91cChpZDogc3RyaW5nKTogdm9pZCB7XG4gICAgdGhpcy5jb3JlLmRlbGV0ZUdyb3VwKGlkKTtcbiAgfVxuXG4gIGFkZEZhdm9yaXRlKGZpbGU6IEZpbGVSZWYsIGdyb3VwSWQ/OiBzdHJpbmcpIHtcbiAgICByZXR1cm4gdGhpcy5jb3JlLmFkZEZhdm9yaXRlKGZpbGUsIGdyb3VwSWQpO1xuICB9XG5cbiAgcmVtb3ZlRmF2b3JpdGUocGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHRoaXMuY29yZS5yZW1vdmVGYXZvcml0ZShwYXRoKTtcbiAgfVxuXG4gIGlzRmF2b3JpdGUocGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHRoaXMuY29yZS5pc0Zhdm9yaXRlKHBhdGgpO1xuICB9XG5cbiAgZmluZEZhdm9yaXRlR3JvdXAocGF0aDogc3RyaW5nKSB7XG4gICAgcmV0dXJuIHRoaXMuY29yZS5maW5kRmF2b3JpdGVHcm91cChwYXRoKTtcbiAgfVxuXG4gIGdldEV4dGVybmFsKCk6IEZpbGVSZWZbXSB7XG4gICAgcmV0dXJuIHRoaXMuY29yZS5nZXRFeHRlcm5hbCgpO1xuICB9XG5cbiAgYWRkRXh0ZXJuYWwoZmlsZTogRmlsZVJlZikge1xuICAgIHJldHVybiB0aGlzLmNvcmUuYWRkRXh0ZXJuYWwoZmlsZSk7XG4gIH1cblxuICByZW1vdmVFeHRlcm5hbChwYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5jb3JlLnJlbW92ZUV4dGVybmFsKHBhdGgpO1xuICB9XG5cbiAgcmVjb3JkT3Blbihmc1BhdGg6IHN0cmluZywgbmFtZTogc3RyaW5nLCBpblByb2plY3Q6IGJvb2xlYW4sIHJlbGF0aXZlUGF0aD86IHN0cmluZyk6IHZvaWQge1xuICAgIHRoaXMuY29yZS5yZWNvcmRPcGVuKGZzUGF0aCwgbmFtZSwgaW5Qcm9qZWN0LCByZWxhdGl2ZVBhdGgpO1xuICB9XG5cbiAgY2xlYXJSZWNlbnRzKCk6IHZvaWQge1xuICAgIHRoaXMuY29yZS5jbGVhclJlY2VudHMoKTtcbiAgfVxuXG4gIGdldFRvcEZpbGVzKHByb2plY3RPbmx5OiBib29sZWFuKSB7XG4gICAgcmV0dXJuIHRoaXMuY29yZS5nZXRUb3BGaWxlcyhwcm9qZWN0T25seSk7XG4gIH1cblxuICBwcnVuZU1pc3NpbmcoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy5jb3JlLnBydW5lTWlzc2luZygpO1xuICB9XG5cbiAgZ2V0U21hcnRHcm91cHMoKTogU21hcnRSdWxlW10ge1xuICAgIHJldHVybiB0aGlzLmNvcmUuZ2V0U21hcnRHcm91cHMoKTtcbiAgfVxuXG4gIGdldFNtYXJ0R3JvdXAoaWQ6IHN0cmluZyk6IFNtYXJ0UnVsZSB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIHRoaXMuY29yZS5nZXRTbWFydEdyb3VwKGlkKTtcbiAgfVxuXG4gIGFkZFNtYXJ0R3JvdXAocnVsZTogU21hcnRSdWxlKTogU21hcnRSdWxlIHtcbiAgICByZXR1cm4gdGhpcy5jb3JlLmFkZFNtYXJ0R3JvdXAocnVsZSk7XG4gIH1cblxuICBjcmVhdGVTbWFydEdyb3VwKFxuICAgIG5hbWU6IHN0cmluZyxcbiAgICBjb25kaXRpb25zOiBTbWFydFJ1bGVbJ2NvbmRpdGlvbnMnXSxcbiAgICBvdmVycmlkZXM6IFBhcnRpYWw8U21hcnRSdWxlPiA9IHt9XG4gICk6IFNtYXJ0UnVsZSB7XG4gICAgcmV0dXJuIHRoaXMuY29yZS5jcmVhdGVTbWFydEdyb3VwKG5hbWUsIGNvbmRpdGlvbnMsIG92ZXJyaWRlcyk7XG4gIH1cblxuICB1cGRhdGVTbWFydEdyb3VwKGlkOiBzdHJpbmcsIHBhdGNoOiBQYXJ0aWFsPFNtYXJ0UnVsZT4pOiBTbWFydFJ1bGUgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiB0aGlzLmNvcmUudXBkYXRlU21hcnRHcm91cChpZCwgcGF0Y2gpO1xuICB9XG5cbiAgcmVtb3ZlU21hcnRHcm91cChpZDogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHRoaXMuY29yZS5yZW1vdmVTbWFydEdyb3VwKGlkKTtcbiAgfVxuXG4gIGdldFJlaW5kZXhQb2xpY3koKSB7XG4gICAgcmV0dXJuIHRoaXMuY29yZS5nZXRSZWluZGV4UG9saWN5KCk7XG4gIH1cblxuICBwbGFuUmVpbmRleChyZWFzb246ICdleHBsaWNpdCcgfCAnY2hhbmdlJyB8ICd2aWV3T3BlbicgfCAnc3RhcnR1cCcsIG5vdzogbnVtYmVyLCBwZW5kaW5nU2luY2U6IG51bWJlcikge1xuICAgIHJldHVybiB0aGlzLmNvcmUucGxhblJlaW5kZXgocmVhc29uLCBub3csIHBlbmRpbmdTaW5jZSk7XG4gIH1cblxuICBkaXNwb3NlKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLnNhdmVUaW1lcikge1xuICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuc2F2ZVRpbWVyKTtcbiAgICAgIHRoaXMuc2F2ZVRpbWVyID0gdW5kZWZpbmVkO1xuICAgIH1cbiAgICB0aGlzLmNvcmUuZGlzcG9zZSgpO1xuICAgIHRoaXMuZW1pdHRlci5kaXNwb3NlKCk7XG4gIH1cbn1cblxuLyoqIFN0cnVjdHVyYWwgYWRhcHRlcjogYHZzY29kZS5NZW1lbnRvYCBhbHJlYWR5IHNhdGlzZmllcyB0aGlzIHNoYXBlLiAqL1xuZnVuY3Rpb24gYXNLZXlWYWx1ZVN0b3JlKG1lbWVudG86IHZzY29kZS5NZW1lbnRvKTogS2V5VmFsdWVTdG9yZSB7XG4gIHJldHVybiB7XG4gICAgZ2V0OiA8VD4oa2V5OiBzdHJpbmcpID0+IG1lbWVudG8uZ2V0PFQ+KGtleSksXG4gICAgdXBkYXRlOiAoa2V5OiBzdHJpbmcsIHZhbHVlOiB1bmtub3duKSA9PiBQcm9taXNlLnJlc29sdmUobWVtZW50by51cGRhdGUoa2V5LCB2YWx1ZSkpLFxuICB9O1xufVxuIiwgImltcG9ydCB0eXBlIHsgT3BlblN0YXQgfSBmcm9tICcuL3NlYXJjaC9yZWNlbnRzLnRzJztcbmltcG9ydCB0eXBlIHsgU21hcnRSdWxlIH0gZnJvbSAnLi9zZWFyY2gvc21hcnRSdWxlcy50cyc7XG5cbi8qKiBBIGZpbGUgdGhhdCBjYW4gYmUgb3BlbmVkLCBlaXRoZXIgaW5zaWRlIGEgd29ya3NwYWNlIGZvbGRlciBvciBvdXRzaWRlIGV2ZXJ5IGZvbGRlci4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRmlsZVJlZiB7XG4gIC8qKiBBYnNvbHV0ZSwgbm9ybWFsaXplZCBwYXRoLiAqL1xuICBwYXRoOiBzdHJpbmc7XG4gIC8qKiBCYXNlbmFtZSwgY2FjaGVkIHNvIHRoZSBVSSBkb2VzIG5vdCBoYXZlIHRvIGNvbXB1dGUgaXQuICovXG4gIG5hbWU6IHN0cmluZztcbiAgLyoqIEZvbGRlci1yZWxhdGl2ZSBwYXRoIHdoZW4gaW5zaWRlIHRoZSB3b3Jrc3BhY2UsIHVzZWQgZm9yIGRpc3BsYXkuICovXG4gIHJlbGF0aXZlUGF0aD86IHN0cmluZztcbiAgLyoqIFdvcmtzcGFjZSBmb2xkZXIgdGhhdCBvd25zIHRoZSBmaWxlLCB3aGVuIGl0IGlzIGluc2lkZSB0aGUgcHJvamVjdC4gKi9cbiAgZm9sZGVyTmFtZT86IHN0cmluZztcbiAgLyoqIFRydWUgZm9yIGZpbGVzIG91dHNpZGUgZXZlcnkgd29ya3NwYWNlIGZvbGRlciAoZXh0ZXJuYWwgZmF2b3JpdGVzKS4gKi9cbiAgZXh0ZXJuYWw/OiBib29sZWFuO1xufVxuXG4vKiogQSB1c2VyLW5hbWVkLCBmbGF0IGNvbGxlY3Rpb24gb2YgZmlsZXMuIEdyb3VwcyBuZXZlciBuZXN0LiAqL1xuZXhwb3J0IGludGVyZmFjZSBGYXZvcml0ZUdyb3VwIHtcbiAgaWQ6IHN0cmluZztcbiAgbmFtZTogc3RyaW5nO1xuICBmaWxlczogRmlsZVJlZltdO1xuICBjcmVhdGVkQXQ6IG51bWJlcjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBQZXJzaXN0ZWRTdGF0ZSB7XG4gIHZlcnNpb246IG51bWJlcjtcbiAgZ3JvdXBzOiBGYXZvcml0ZUdyb3VwW107XG4gIGV4dGVybmFsOiBGaWxlUmVmW107XG4gIHJlY2VudHM6IE9wZW5TdGF0W107XG4gIC8qKiBBdXRvLWNvbGxlY3Rpb25zIGRlZmluZWQgYnkgcnVsZXMuICovXG4gIHNtYXJ0R3JvdXBzOiBTbWFydFJ1bGVbXTtcbn1cblxuZXhwb3J0IGNvbnN0IFNUQVRFX1ZFUlNJT04gPSAyO1xuXG5leHBvcnQgZnVuY3Rpb24gZW1wdHlTdGF0ZSgpOiBQZXJzaXN0ZWRTdGF0ZSB7XG4gIHJldHVybiB7IHZlcnNpb246IFNUQVRFX1ZFUlNJT04sIGdyb3VwczogW10sIGV4dGVybmFsOiBbXSwgcmVjZW50czogW10sIHNtYXJ0R3JvdXBzOiBbXSB9O1xufVxuXG5leHBvcnQgdHlwZSB7IE9wZW5TdGF0LCBTbWFydFJ1bGUgfTtcbiIsICIvKipcbiAqIEFsbCBwZXJzaXN0ZWQsIHVzZXItb3duZWQgc3RhdGUgaW4gb25lIHBsYWNlOiBmYXZvcml0ZSBncm91cHMsIHRoZSBleHRlcm5hbFxuICogZmlsZSBsaXN0LCBvcGVuIHN0YXRpc3RpY3MsIGFuZCBzbWFydC1ncm91cCBydWxlcy5cbiAqXG4gKiBUaGVyZSBpcyBubyBgdnNjb2RlYCBpbXBvcnQgaGVyZS4gVGltZXJzLCBldmVudHMsIGNvbmZpZ3VyYXRpb24gYW5kIHN0b3JhZ2VcbiAqIGFyZSBpbmplY3RlZCwgd2hpY2ggbWVhbnMgdGhlIHJlYWwgbG9naWMgKG5vdCBhIGNvcHkgb2YgaXQpIHJ1bnMgdW5kZXIgdGVzdFxuICogaW4gYHN0b3JlQ29yZS50ZXN0LnRzYC5cbiAqL1xuaW1wb3J0IHsgcGxhblJlaW5kZXgsIHBydW5lTWlzc2luZywgcmFua09wZW5TdGF0cywgcmVjb3JkT3BlblN0YXQsIHR5cGUgT3BlblN0YXQsIHR5cGUgUmFua2luZ1N0cmF0ZWd5LCB0eXBlIFJlaW5kZXhQb2xpY3kgfSBmcm9tICcuL3NlYXJjaC9yZWNlbnRzLnRzJztcbmltcG9ydCB7IGNyZWF0ZVJ1bGUsIHR5cGUgUnVsZUNvbmRpdGlvbnMsIHR5cGUgU21hcnRSdWxlIH0gZnJvbSAnLi9zZWFyY2gvc21hcnRSdWxlcy50cyc7XG5pbXBvcnQgeyBTVEFURV9WRVJTSU9OLCB0eXBlIEZhdm9yaXRlR3JvdXAsIHR5cGUgRmlsZVJlZiwgdHlwZSBQZXJzaXN0ZWRTdGF0ZSB9IGZyb20gJy4vdHlwZXMudHMnO1xuXG5jb25zdCBERUZBVUxUX0dST1VQX0lEID0gJ2RlZmF1bHQnO1xuXG4vKiogTWluaW1hbCBrZXkvdmFsdWUgc3RvcmU6IHN0cnVjdHVyYWxseSBjb21wYXRpYmxlIHdpdGggYHZzY29kZS5NZW1lbnRvYC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgS2V5VmFsdWVTdG9yZSB7XG4gIGdldDxUPihrZXk6IHN0cmluZyk6IFQgfCB1bmRlZmluZWQ7XG4gIHVwZGF0ZShrZXk6IHN0cmluZywgdmFsdWU6IHVua25vd24pOiBUaGVuYWJsZTx2b2lkPiB8IFByb21pc2U8dm9pZD47XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgU3RvcmVFdmVudEVtaXR0ZXIge1xuICBmaXJlKCk6IHZvaWQ7XG4gIGRpc3Bvc2UoKTogdm9pZDtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBTdG9yZURlcHMge1xuICB3b3Jrc3BhY2VTdGF0ZTogS2V5VmFsdWVTdG9yZTtcbiAgZ2xvYmFsU3RhdGU6IEtleVZhbHVlU3RvcmU7XG4gIGNvbmZpZzxUPihrZXk6IHN0cmluZywgZmFsbGJhY2s6IFQpOiBUO1xuICBlbWl0dGVyOiBTdG9yZUV2ZW50RW1pdHRlcjtcbiAgLyoqIEluamVjdGFibGUgY2xvY2ssIGZvciBkZXRlcm1pbmlzdGljIHJhbmtpbmcgdGVzdHMuICovXG4gIG5vdz86ICgpID0+IG51bWJlcjtcbiAgLyoqIEluamVjdGFibGUgZmlsZSBleGlzdGVuY2UgY2hlY2ssIGZvciBwcnVuaW5nIHRlc3RzLiAqL1xuICBleGlzdHM/OiAocGF0aDogc3RyaW5nKSA9PiBib29sZWFuO1xuICAvKiogU2NoZWR1bGVzIGEgZGVib3VuY2VkIGZsdXNoOyB0aGUgVlMgQ29kZSBhZGFwdGVyIHN1cHBsaWVzIGEgcmVhbCB0aW1lci4gKi9cbiAgc2NoZWR1bGU/OiAoY2FsbGJhY2s6ICgpID0+IHZvaWQpID0+IHZvaWQ7XG4gIGNhbmNlbFNjaGVkdWxlZD86ICgpID0+IHZvaWQ7XG4gIC8qKiBEZWZhdWx0IGdyb3VwIG5hbWUgdXNlZCB3aGVuIHRoZSBmaXJzdCBmYXZvcml0ZSBpcyBhZGRlZC4gKi9cbiAgZGVmYXVsdEdyb3VwTmFtZT86IHN0cmluZztcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG1ha2VJZChub3cgPSBEYXRlLm5vdygpKTogc3RyaW5nIHtcbiAgcmV0dXJuIGAke25vdy50b1N0cmluZygzNil9LSR7TWF0aC5yYW5kb20oKS50b1N0cmluZygzNikuc2xpY2UoMiwgOCl9YDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZUtleShwYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gcGF0aC5yZXBsYWNlKC9cXFxcL2csICcvJykucmVwbGFjZSgvXFwvKyQvLCAnJykudG9Mb3dlckNhc2UoKTtcbn1cblxuZXhwb3J0IGNsYXNzIFN0b3JlQ29yZSB7XG4gIHByaXZhdGUgc3RhdGU6IFBlcnNpc3RlZFN0YXRlO1xuICBwcml2YXRlIHJlYWRvbmx5IGRlcHM6IFN0b3JlRGVwcztcbiAgcHJpdmF0ZSByZWFkb25seSBub3c6ICgpID0+IG51bWJlcjtcbiAgcHJpdmF0ZSByZWFkb25seSBleGlzdHM6IChwYXRoOiBzdHJpbmcpID0+IGJvb2xlYW47XG5cbiAgY29uc3RydWN0b3IoZGVwczogU3RvcmVEZXBzKSB7XG4gICAgdGhpcy5kZXBzID0gZGVwcztcbiAgICB0aGlzLm5vdyA9IGRlcHMubm93ID8/ICgoKSA9PiBEYXRlLm5vdygpKTtcbiAgICB0aGlzLmV4aXN0cyA9IGRlcHMuZXhpc3RzID8/ICgoKSA9PiB0cnVlKTtcblxuICAgIGNvbnN0IHdvcmtzcGFjZSA9IGRlcHMud29ya3NwYWNlU3RhdGUuZ2V0PFBhcnRpYWw8UGVyc2lzdGVkU3RhdGU+PigncGRmSHViLnN0YXRlJyk7XG4gICAgY29uc3QgZ2xvYmFsRXh0ZXJuYWwgPSBkZXBzLmdsb2JhbFN0YXRlLmdldDxGaWxlUmVmW10+KCdwZGZIdWIuZXh0ZXJuYWwnKTtcbiAgICAvLyBTdG9yZWQgdmFsdWVzIGFyZSB1bnRydXN0ZWQ6IGFueXRoaW5nIG1hbGZvcm1lZCBpcyBkaXNjYXJkZWQgcmF0aGVyIHRoYW5cbiAgICAvLyBhbGxvd2VkIHRvIHBvaXNvbiBhIGNvbGxlY3Rpb24gKGEgc3RyaW5nIHdoZXJlIGFuIGFycmF5IGJlbG9uZ3Mgd291bGRcbiAgICAvLyBvdGhlcndpc2UgY3Jhc2ggdGhlIGZpcnN0IGAuZmlsdGVyYCBjYWxsKS5cbiAgICBjb25zdCBhc0FycmF5ID0gPFQ+KHZhbHVlOiB1bmtub3duLCBndWFyZDogKGVudHJ5OiB1bmtub3duKSA9PiBlbnRyeSBpcyBUKTogVFtdID0+XG4gICAgICBBcnJheS5pc0FycmF5KHZhbHVlKSA/IHZhbHVlLmZpbHRlcihndWFyZCkgOiBbXTtcblxuICAgIHRoaXMuc3RhdGUgPSB7XG4gICAgICB2ZXJzaW9uOiBTVEFURV9WRVJTSU9OLFxuICAgICAgZ3JvdXBzOiBhc0FycmF5KHdvcmtzcGFjZT8uZ3JvdXBzLCBpc0dyb3VwTGlrZSksXG4gICAgICBleHRlcm5hbDogYXNBcnJheSh3b3Jrc3BhY2U/LmV4dGVybmFsLCBpc0ZpbGVSZWZMaWtlKSxcbiAgICAgIHJlY2VudHM6IGFzQXJyYXkod29ya3NwYWNlPy5yZWNlbnRzLCBpc09wZW5TdGF0TGlrZSksXG4gICAgICBzbWFydEdyb3VwczogYXNBcnJheSh3b3Jrc3BhY2U/LnNtYXJ0R3JvdXBzLCBpc1NtYXJ0UnVsZUxpa2UpLFxuICAgIH07XG4gICAgaWYgKCF0aGlzLnN0YXRlLmV4dGVybmFsLmxlbmd0aCkge1xuICAgICAgdGhpcy5zdGF0ZS5leHRlcm5hbCA9IGFzQXJyYXkoZ2xvYmFsRXh0ZXJuYWwsIGlzRmlsZVJlZkxpa2UpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgdG91Y2goKTogdm9pZCB7XG4gICAgdGhpcy5kZXBzLmVtaXR0ZXIuZmlyZSgpO1xuICAgIHRoaXMuZGVwcy5zY2hlZHVsZT8uKCgpID0+IHZvaWQgdGhpcy5mbHVzaCgpKTtcbiAgfVxuXG4gIC8qKiBXcml0ZXMgYm90aCBtZW1lbnRvcyBpbW1lZGlhdGVseS4gKi9cbiAgYXN5bmMgZmx1c2goKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5kZXBzLmNhbmNlbFNjaGVkdWxlZD8uKCk7XG4gICAgYXdhaXQgdGhpcy5kZXBzLndvcmtzcGFjZVN0YXRlLnVwZGF0ZSgncGRmSHViLnN0YXRlJywgdGhpcy5zdGF0ZSk7XG4gICAgYXdhaXQgdGhpcy5kZXBzLmdsb2JhbFN0YXRlLnVwZGF0ZSgncGRmSHViLmV4dGVybmFsJywgdGhpcy5zdGF0ZS5leHRlcm5hbCk7XG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIGZhdm9yaXRlc1xuXG4gIGdldEdyb3VwcygpOiBGYXZvcml0ZUdyb3VwW10ge1xuICAgIHJldHVybiB0aGlzLnN0YXRlLmdyb3Vwcy5tYXAoKGdyb3VwKSA9PiAoeyAuLi5ncm91cCwgZmlsZXM6IFsuLi5ncm91cC5maWxlc10gfSkpO1xuICB9XG5cbiAgZ2V0R3JvdXAoaWQ6IHN0cmluZyk6IEZhdm9yaXRlR3JvdXAgfCB1bmRlZmluZWQge1xuICAgIHJldHVybiB0aGlzLnN0YXRlLmdyb3Vwcy5maW5kKChncm91cCkgPT4gZ3JvdXAuaWQgPT09IGlkKTtcbiAgfVxuXG4gIGdldCBkZWZhdWx0R3JvdXBJZCgpOiBzdHJpbmcge1xuICAgIHJldHVybiB0aGlzLnN0YXRlLmdyb3Vwc1swXT8uaWQgPz8gREVGQVVMVF9HUk9VUF9JRDtcbiAgfVxuXG4gIGNyZWF0ZUdyb3VwKG5hbWU6IHN0cmluZyk6IEZhdm9yaXRlR3JvdXAge1xuICAgIGNvbnN0IHRyaW1tZWQgPSBuYW1lLnRyaW0oKSB8fCAnR3JvdXAnO1xuICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5zdGF0ZS5ncm91cHMuZmluZCgoZ3JvdXApID0+IGdyb3VwLm5hbWUudG9Mb3dlckNhc2UoKSA9PT0gdHJpbW1lZC50b0xvd2VyQ2FzZSgpKTtcbiAgICBpZiAoZXhpc3RpbmcpIHtcbiAgICAgIHJldHVybiBleGlzdGluZztcbiAgICB9XG4gICAgY29uc3QgZ3JvdXA6IEZhdm9yaXRlR3JvdXAgPSB7IGlkOiBtYWtlSWQodGhpcy5ub3coKSksIG5hbWU6IHRyaW1tZWQsIGZpbGVzOiBbXSwgY3JlYXRlZEF0OiB0aGlzLm5vdygpIH07XG4gICAgdGhpcy5zdGF0ZS5ncm91cHMucHVzaChncm91cCk7XG4gICAgdGhpcy50b3VjaCgpO1xuICAgIHJldHVybiBncm91cDtcbiAgfVxuXG4gIHJlbmFtZUdyb3VwKGlkOiBzdHJpbmcsIG5hbWU6IHN0cmluZyk6IHZvaWQge1xuICAgIGNvbnN0IGdyb3VwID0gdGhpcy5zdGF0ZS5ncm91cHMuZmluZCgoZW50cnkpID0+IGVudHJ5LmlkID09PSBpZCk7XG4gICAgaWYgKCFncm91cCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBncm91cC5uYW1lID0gbmFtZS50cmltKCkgfHwgZ3JvdXAubmFtZTtcbiAgICB0aGlzLnRvdWNoKCk7XG4gIH1cblxuICBkZWxldGVHcm91cChpZDogc3RyaW5nKTogdm9pZCB7XG4gICAgY29uc3QgaW5kZXggPSB0aGlzLnN0YXRlLmdyb3Vwcy5maW5kSW5kZXgoKGdyb3VwKSA9PiBncm91cC5pZCA9PT0gaWQpO1xuICAgIGlmIChpbmRleCA9PT0gLTEpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5zdGF0ZS5ncm91cHMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICB0aGlzLnRvdWNoKCk7XG4gIH1cblxuICAvKiogQWRkcyBhIGZpbGUgdG8gYSBncm91cCwgbW92aW5nIGl0IG91dCBvZiBhbnkgb3RoZXIgZ3JvdXAgZmlyc3QuICovXG4gIGFkZEZhdm9yaXRlKGZpbGU6IEZpbGVSZWYsIGdyb3VwSWQ/OiBzdHJpbmcpOiBGYXZvcml0ZUdyb3VwIHtcbiAgICBsZXQgZ3JvdXAgPSBncm91cElkID8gdGhpcy5zdGF0ZS5ncm91cHMuZmluZCgoZW50cnkpID0+IGVudHJ5LmlkID09PSBncm91cElkKSA6IHVuZGVmaW5lZDtcbiAgICBpZiAoIWdyb3VwKSB7XG4gICAgICBncm91cCA9IHRoaXMuc3RhdGUuZ3JvdXBzLmZpbmQoKGVudHJ5KSA9PiBlbnRyeS5pZCA9PT0gdGhpcy5kZWZhdWx0R3JvdXBJZCk7XG4gICAgfVxuICAgIGlmICghZ3JvdXApIHtcbiAgICAgIGNvbnN0IGNyZWF0ZWQ6IEZhdm9yaXRlR3JvdXAgPSB7XG4gICAgICAgIGlkOiB0aGlzLnN0YXRlLmdyb3Vwcy5sZW5ndGggPyBtYWtlSWQodGhpcy5ub3coKSkgOiBERUZBVUxUX0dST1VQX0lELFxuICAgICAgICBuYW1lOiB0aGlzLmRlcHMuZGVmYXVsdEdyb3VwTmFtZSA/PyAnRmF2b3JpdGVzJyxcbiAgICAgICAgZmlsZXM6IFtdLFxuICAgICAgICBjcmVhdGVkQXQ6IHRoaXMubm93KCksXG4gICAgICB9O1xuICAgICAgdGhpcy5zdGF0ZS5ncm91cHMucHVzaChjcmVhdGVkKTtcbiAgICAgIGdyb3VwID0gY3JlYXRlZDtcbiAgICB9XG5cbiAgICAvLyBBIGZpbGUgbGl2ZXMgaW4gZXhhY3RseSBvbmUgZ3JvdXA6IHJlbW92ZSBpdCBmcm9tIHRoZSBvdGhlcnMgZmlyc3QuXG4gICAgY29uc3Qga2V5ID0gbm9ybWFsaXplS2V5KGZpbGUucGF0aCk7XG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiB0aGlzLnN0YXRlLmdyb3Vwcykge1xuICAgICAgZW50cnkuZmlsZXMgPSBlbnRyeS5maWxlcy5maWx0ZXIoKGNhbmRpZGF0ZSkgPT4gbm9ybWFsaXplS2V5KGNhbmRpZGF0ZS5wYXRoKSAhPT0ga2V5KTtcbiAgICB9XG4gICAgZ3JvdXAuZmlsZXMucHVzaChmaWxlKTtcbiAgICB0aGlzLnRvdWNoKCk7XG4gICAgcmV0dXJuIGdyb3VwO1xuICB9XG5cbiAgcmVtb3ZlRmF2b3JpdGUocGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgY29uc3Qga2V5ID0gbm9ybWFsaXplS2V5KHBhdGgpO1xuICAgIGxldCBjaGFuZ2VkID0gZmFsc2U7XG4gICAgZm9yIChjb25zdCBncm91cCBvZiB0aGlzLnN0YXRlLmdyb3Vwcykge1xuICAgICAgY29uc3QgYmVmb3JlID0gZ3JvdXAuZmlsZXMubGVuZ3RoO1xuICAgICAgZ3JvdXAuZmlsZXMgPSBncm91cC5maWxlcy5maWx0ZXIoKGZpbGUpID0+IG5vcm1hbGl6ZUtleShmaWxlLnBhdGgpICE9PSBrZXkpO1xuICAgICAgY2hhbmdlZCA9IGNoYW5nZWQgfHwgZ3JvdXAuZmlsZXMubGVuZ3RoICE9PSBiZWZvcmU7XG4gICAgfVxuICAgIGlmIChjaGFuZ2VkKSB7XG4gICAgICB0aGlzLnRvdWNoKCk7XG4gICAgfVxuICAgIHJldHVybiBjaGFuZ2VkO1xuICB9XG5cbiAgaXNGYXZvcml0ZShwYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICBjb25zdCBrZXkgPSBub3JtYWxpemVLZXkocGF0aCk7XG4gICAgcmV0dXJuIHRoaXMuc3RhdGUuZ3JvdXBzLnNvbWUoKGdyb3VwKSA9PiBncm91cC5maWxlcy5zb21lKChmaWxlKSA9PiBub3JtYWxpemVLZXkoZmlsZS5wYXRoKSA9PT0ga2V5KSk7XG4gIH1cblxuICBmaW5kRmF2b3JpdGVHcm91cChwYXRoOiBzdHJpbmcpOiBGYXZvcml0ZUdyb3VwIHwgdW5kZWZpbmVkIHtcbiAgICBjb25zdCBrZXkgPSBub3JtYWxpemVLZXkocGF0aCk7XG4gICAgcmV0dXJuIHRoaXMuc3RhdGUuZ3JvdXBzLmZpbmQoKGdyb3VwKSA9PiBncm91cC5maWxlcy5zb21lKChmaWxlKSA9PiBub3JtYWxpemVLZXkoZmlsZS5wYXRoKSA9PT0ga2V5KSk7XG4gIH1cblxuICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSBleHRlcm5hbFxuXG4gIGdldCBleHRlcm5hbE1heCgpOiBudW1iZXIge1xuICAgIGNvbnN0IHJhdyA9IHRoaXMuZGVwcy5jb25maWcoJ2V4dGVybmFsLm1heEl0ZW1zJywgMTApO1xuICAgIHJldHVybiBNYXRoLm1heCgxLCBNYXRoLm1pbigxMCwgTWF0aC5mbG9vcihyYXcpKSk7XG4gIH1cblxuICBnZXRFeHRlcm5hbCgpOiBGaWxlUmVmW10ge1xuICAgIHJldHVybiBbLi4udGhpcy5zdGF0ZS5leHRlcm5hbF07XG4gIH1cblxuICBhZGRFeHRlcm5hbChmaWxlOiBGaWxlUmVmKTogJ2FkZGVkJyB8ICdkdXBsaWNhdGUnIHwgJ2Z1bGwnIHtcbiAgICBjb25zdCBrZXkgPSBub3JtYWxpemVLZXkoZmlsZS5wYXRoKTtcbiAgICBpZiAodGhpcy5zdGF0ZS5leHRlcm5hbC5zb21lKChlbnRyeSkgPT4gbm9ybWFsaXplS2V5KGVudHJ5LnBhdGgpID09PSBrZXkpKSB7XG4gICAgICByZXR1cm4gJ2R1cGxpY2F0ZSc7XG4gICAgfVxuICAgIGlmICh0aGlzLnN0YXRlLmV4dGVybmFsLmxlbmd0aCA+PSB0aGlzLmV4dGVybmFsTWF4KSB7XG4gICAgICByZXR1cm4gJ2Z1bGwnO1xuICAgIH1cbiAgICB0aGlzLnN0YXRlLmV4dGVybmFsLnB1c2goeyAuLi5maWxlLCBleHRlcm5hbDogdHJ1ZSB9KTtcbiAgICB0aGlzLnRvdWNoKCk7XG4gICAgcmV0dXJuICdhZGRlZCc7XG4gIH1cblxuICByZW1vdmVFeHRlcm5hbChwYXRoOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgICBjb25zdCBrZXkgPSBub3JtYWxpemVLZXkocGF0aCk7XG4gICAgY29uc3QgYmVmb3JlID0gdGhpcy5zdGF0ZS5leHRlcm5hbC5sZW5ndGg7XG4gICAgdGhpcy5zdGF0ZS5leHRlcm5hbCA9IHRoaXMuc3RhdGUuZXh0ZXJuYWwuZmlsdGVyKChmaWxlKSA9PiBub3JtYWxpemVLZXkoZmlsZS5wYXRoKSAhPT0ga2V5KTtcbiAgICBpZiAodGhpcy5zdGF0ZS5leHRlcm5hbC5sZW5ndGggIT09IGJlZm9yZSkge1xuICAgICAgdGhpcy50b3VjaCgpO1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLSByZWNlbnRzXG5cbiAgcmVjb3JkT3Blbihmc1BhdGg6IHN0cmluZywgbmFtZTogc3RyaW5nLCBpblByb2plY3Q6IGJvb2xlYW4sIHJlbGF0aXZlUGF0aD86IHN0cmluZyk6IHZvaWQge1xuICAgIGNvbnN0IGNhcCA9IE1hdGgubWF4KDUwLCB0aGlzLmRlcHMuY29uZmlnKCdyZWNlbnQubWF4SXRlbXMnLCAxNSkgKiA0KTtcbiAgICB0aGlzLnN0YXRlLnJlY2VudHMgPSByZWNvcmRPcGVuU3RhdChcbiAgICAgIHRoaXMuc3RhdGUucmVjZW50cyxcbiAgICAgIHsgcGF0aDogZnNQYXRoLCBuYW1lLCBpblByb2plY3QsIHJlbGF0aXZlUGF0aCB9LFxuICAgICAgeyBub3c6IHRoaXMubm93KCksIGNhcCB9XG4gICAgKTtcbiAgICB0aGlzLnRvdWNoKCk7XG4gIH1cblxuICBjbGVhclJlY2VudHMoKTogdm9pZCB7XG4gICAgdGhpcy5zdGF0ZS5yZWNlbnRzID0gW107XG4gICAgdGhpcy50b3VjaCgpO1xuICB9XG5cbiAgZ2V0VG9wRmlsZXMocHJvamVjdE9ubHk6IGJvb2xlYW4pOiBPcGVuU3RhdFtdIHtcbiAgICByZXR1cm4gcmFua09wZW5TdGF0cyh0aGlzLnN0YXRlLnJlY2VudHMsIHtcbiAgICAgIHN0cmF0ZWd5OiB0aGlzLmRlcHMuY29uZmlnPFJhbmtpbmdTdHJhdGVneT4oJ3JlY2VudC5yYW5raW5nJywgJ2h5YnJpZCcpLFxuICAgICAgbGltaXQ6IHRoaXMuZGVwcy5jb25maWcoJ3JlY2VudC5tYXhJdGVtcycsIDE1KSxcbiAgICAgIHByb2plY3RPbmx5LFxuICAgICAgbm93OiB0aGlzLm5vdygpLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqIERyb3BzIHJlbWVtYmVyZWQgZmlsZXMgdGhhdCBubyBsb25nZXIgZXhpc3Qgb24gZGlzay4gKi9cbiAgcHJ1bmVNaXNzaW5nKCk6IG51bWJlciB7XG4gICAgY29uc3QgcmVzdWx0ID0gcHJ1bmVNaXNzaW5nKHRoaXMuc3RhdGUsIChwYXRoKSA9PiB0aGlzLmV4aXN0cyhwYXRoKSk7XG4gICAgaWYgKHJlc3VsdC5yZW1vdmVkID4gMCkge1xuICAgICAgdGhpcy5zdGF0ZSA9IHsgLi4udGhpcy5zdGF0ZSwgLi4ucmVzdWx0LnZhbHVlLCB2ZXJzaW9uOiBTVEFURV9WRVJTSU9OIH07XG4gICAgICB0aGlzLnRvdWNoKCk7XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQucmVtb3ZlZDtcbiAgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIHNtYXJ0IGdyb3Vwc1xuXG4gIC8qKiBSZXR1cm5zIGRlZXAgY29waWVzIHNvIGNhbGxlcnMgY2Fubm90IG11dGF0ZSBzdG9yZWQgcnVsZXMgYnkgYWNjaWRlbnQuICovXG4gIGdldFNtYXJ0R3JvdXBzKCk6IFNtYXJ0UnVsZVtdIHtcbiAgICByZXR1cm4gdGhpcy5zdGF0ZS5zbWFydEdyb3Vwcy5tYXAoY2xvbmVSdWxlKTtcbiAgfVxuXG4gIGdldFNtYXJ0R3JvdXAoaWQ6IHN0cmluZyk6IFNtYXJ0UnVsZSB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgcnVsZSA9IHRoaXMuc3RhdGUuc21hcnRHcm91cHMuZmluZCgoZW50cnkpID0+IGVudHJ5LmlkID09PSBpZCk7XG4gICAgcmV0dXJuIHJ1bGUgPyBjbG9uZVJ1bGUocnVsZSkgOiB1bmRlZmluZWQ7XG4gIH1cblxuICBhZGRTbWFydEdyb3VwKHJ1bGU6IFNtYXJ0UnVsZSk6IFNtYXJ0UnVsZSB7XG4gICAgdGhpcy5zdGF0ZS5zbWFydEdyb3Vwcy5wdXNoKHJ1bGUpO1xuICAgIHRoaXMudG91Y2goKTtcbiAgICByZXR1cm4gcnVsZTtcbiAgfVxuXG4gIC8qKiBDcmVhdGVzIGFuZCBzdG9yZXMgYSBydWxlIGluIG9uZSBzdGVwLiAqL1xuICBjcmVhdGVTbWFydEdyb3VwKG5hbWU6IHN0cmluZywgY29uZGl0aW9uczogUnVsZUNvbmRpdGlvbnMsIG92ZXJyaWRlczogUGFydGlhbDxTbWFydFJ1bGU+ID0ge30pOiBTbWFydFJ1bGUge1xuICAgIHJldHVybiB0aGlzLmFkZFNtYXJ0R3JvdXAoY3JlYXRlUnVsZShuYW1lLCBjb25kaXRpb25zLCBvdmVycmlkZXMpKTtcbiAgfVxuXG4gIHVwZGF0ZVNtYXJ0R3JvdXAoaWQ6IHN0cmluZywgcGF0Y2g6IFBhcnRpYWw8U21hcnRSdWxlPik6IFNtYXJ0UnVsZSB8IHVuZGVmaW5lZCB7XG4gICAgY29uc3QgcnVsZSA9IHRoaXMuc3RhdGUuc21hcnRHcm91cHMuZmluZCgoZW50cnkpID0+IGVudHJ5LmlkID09PSBpZCk7XG4gICAgaWYgKCFydWxlKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBPYmplY3QuYXNzaWduKHJ1bGUsIHBhdGNoLCB7IGlkOiBydWxlLmlkIH0pO1xuICAgIGlmIChwYXRjaC5jb25kaXRpb25zKSB7XG4gICAgICBydWxlLmNvbmRpdGlvbnMgPSB7IC4uLnBhdGNoLmNvbmRpdGlvbnMgfTtcbiAgICB9XG4gICAgdGhpcy50b3VjaCgpO1xuICAgIHJldHVybiBydWxlO1xuICB9XG5cbiAgcmVtb3ZlU21hcnRHcm91cChpZDogc3RyaW5nKTogYm9vbGVhbiB7XG4gICAgY29uc3QgaW5kZXggPSB0aGlzLnN0YXRlLnNtYXJ0R3JvdXBzLmZpbmRJbmRleCgocnVsZSkgPT4gcnVsZS5pZCA9PT0gaWQpO1xuICAgIGlmIChpbmRleCA9PT0gLTEpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgdGhpcy5zdGF0ZS5zbWFydEdyb3Vwcy5zcGxpY2UoaW5kZXgsIDEpO1xuICAgIHRoaXMudG91Y2goKTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tIG1pc2NcblxuICAvKiogUmVhZHMgdGhlIGN1cnJlbnQgaW5kZXggcG9saWN5IGZyb20gY29uZmlndXJhdGlvbi4gKi9cbiAgZ2V0UmVpbmRleFBvbGljeSgpOiBSZWluZGV4UG9saWN5IHtcbiAgICByZXR1cm4ge1xuICAgICAgdHJpZ2dlcjogdGhpcy5kZXBzLmNvbmZpZzwnb25EZW1hbmQnIHwgJ29uVmlld09wZW4nIHwgJ29uU3RhcnR1cCc+KCdpbmRleC50cmlnZ2VyJywgJ29uVmlld09wZW4nKSxcbiAgICAgIGRlYm91bmNlTXM6IHRoaXMuZGVwcy5jb25maWcoJ2luZGV4LmRlYm91bmNlTXMnLCAxNTAwKSxcbiAgICAgIG1heERlbGF5TXM6IHRoaXMuZGVwcy5jb25maWcoJ2luZGV4Lm1heERlbGF5TXMnLCAxMDAwMCksXG4gICAgfTtcbiAgfVxuXG4gIC8qKiBFeHBvc2VkIGZvciB0ZXN0czogYXNrcyB0aGUgcHVyZSBwb2xpY3kgd2hldGhlciBhIHJlaW5kZXggc2hvdWxkIHJ1bi4gKi9cbiAgcGxhblJlaW5kZXgocmVhc29uOiAnZXhwbGljaXQnIHwgJ2NoYW5nZScgfCAndmlld09wZW4nIHwgJ3N0YXJ0dXAnLCBub3c6IG51bWJlciwgcGVuZGluZ1NpbmNlOiBudW1iZXIpIHtcbiAgICByZXR1cm4gcGxhblJlaW5kZXgodGhpcy5nZXRSZWluZGV4UG9saWN5KCksIHJlYXNvbiwgbm93LCBwZW5kaW5nU2luY2UpO1xuICB9XG5cbiAgc25hcHNob3QoKTogUGVyc2lzdGVkU3RhdGUge1xuICAgIHJldHVybiBKU09OLnBhcnNlKEpTT04uc3RyaW5naWZ5KHRoaXMuc3RhdGUpKSBhcyBQZXJzaXN0ZWRTdGF0ZTtcbiAgfVxuXG4gIGRpc3Bvc2UoKTogdm9pZCB7XG4gICAgdGhpcy5kZXBzLmNhbmNlbFNjaGVkdWxlZD8uKCk7XG4gICAgdGhpcy5kZXBzLmVtaXR0ZXIuZGlzcG9zZSgpO1xuICB9XG59XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0gc2hhcGUgZ3VhcmRzXG5cbmZ1bmN0aW9uIGlzRmlsZVJlZkxpa2UodmFsdWU6IHVua25vd24pOiB2YWx1ZSBpcyBGaWxlUmVmIHtcbiAgY29uc3QgY2FuZGlkYXRlID0gdmFsdWUgYXMgRmlsZVJlZiB8IHVuZGVmaW5lZDtcbiAgcmV0dXJuIEJvb2xlYW4oY2FuZGlkYXRlICYmIHR5cGVvZiBjYW5kaWRhdGUucGF0aCA9PT0gJ3N0cmluZycgJiYgdHlwZW9mIGNhbmRpZGF0ZS5uYW1lID09PSAnc3RyaW5nJyk7XG59XG5cbmZ1bmN0aW9uIGlzR3JvdXBMaWtlKHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgRmF2b3JpdGVHcm91cCB7XG4gIGNvbnN0IGNhbmRpZGF0ZSA9IHZhbHVlIGFzIEZhdm9yaXRlR3JvdXAgfCB1bmRlZmluZWQ7XG4gIHJldHVybiBCb29sZWFuKFxuICAgIGNhbmRpZGF0ZSAmJlxuICAgICAgdHlwZW9mIGNhbmRpZGF0ZS5pZCA9PT0gJ3N0cmluZycgJiZcbiAgICAgIHR5cGVvZiBjYW5kaWRhdGUubmFtZSA9PT0gJ3N0cmluZycgJiZcbiAgICAgIEFycmF5LmlzQXJyYXkoY2FuZGlkYXRlLmZpbGVzKVxuICApO1xufVxuXG5mdW5jdGlvbiBpc09wZW5TdGF0TGlrZSh2YWx1ZTogdW5rbm93bik6IHZhbHVlIGlzIE9wZW5TdGF0IHtcbiAgY29uc3QgY2FuZGlkYXRlID0gdmFsdWUgYXMgT3BlblN0YXQgfCB1bmRlZmluZWQ7XG4gIHJldHVybiBCb29sZWFuKFxuICAgIGNhbmRpZGF0ZSAmJlxuICAgICAgdHlwZW9mIGNhbmRpZGF0ZS5wYXRoID09PSAnc3RyaW5nJyAmJlxuICAgICAgdHlwZW9mIGNhbmRpZGF0ZS5jb3VudCA9PT0gJ251bWJlcicgJiZcbiAgICAgIHR5cGVvZiBjYW5kaWRhdGUubGFzdE9wZW5lZCA9PT0gJ251bWJlcidcbiAgKTtcbn1cblxuZnVuY3Rpb24gY2xvbmVDb25kaXRpb25zKGNvbmRpdGlvbnM6IFNtYXJ0UnVsZVsnY29uZGl0aW9ucyddKTogU21hcnRSdWxlWydjb25kaXRpb25zJ10ge1xuICByZXR1cm4ge1xuICAgIC4uLmNvbmRpdGlvbnMsXG4gICAgaW5jbHVkZUdsb2JzOiBjb25kaXRpb25zLmluY2x1ZGVHbG9icyA/IFsuLi5jb25kaXRpb25zLmluY2x1ZGVHbG9ic10gOiB1bmRlZmluZWQsXG4gICAgZXhjbHVkZUdsb2JzOiBjb25kaXRpb25zLmV4Y2x1ZGVHbG9icyA/IFsuLi5jb25kaXRpb25zLmV4Y2x1ZGVHbG9ic10gOiB1bmRlZmluZWQsXG4gICAgZXh0ZW5zaW9uczogY29uZGl0aW9ucy5leHRlbnNpb25zID8gWy4uLmNvbmRpdGlvbnMuZXh0ZW5zaW9uc10gOiB1bmRlZmluZWQsXG4gIH07XG59XG5cbmZ1bmN0aW9uIGNsb25lUnVsZShydWxlOiBTbWFydFJ1bGUpOiBTbWFydFJ1bGUge1xuICByZXR1cm4geyAuLi5ydWxlLCBjb25kaXRpb25zOiBjbG9uZUNvbmRpdGlvbnMocnVsZS5jb25kaXRpb25zKSB9O1xufVxuXG5mdW5jdGlvbiBpc1NtYXJ0UnVsZUxpa2UodmFsdWU6IHVua25vd24pOiB2YWx1ZSBpcyBTbWFydFJ1bGUge1xuICBjb25zdCBjYW5kaWRhdGUgPSB2YWx1ZSBhcyBTbWFydFJ1bGUgfCB1bmRlZmluZWQ7XG4gIHJldHVybiBCb29sZWFuKFxuICAgIGNhbmRpZGF0ZSAmJlxuICAgICAgdHlwZW9mIGNhbmRpZGF0ZS5pZCA9PT0gJ3N0cmluZycgJiZcbiAgICAgIHR5cGVvZiBjYW5kaWRhdGUubmFtZSA9PT0gJ3N0cmluZycgJiZcbiAgICAgIGNhbmRpZGF0ZS5jb25kaXRpb25zICYmXG4gICAgICB0eXBlb2YgY2FuZGlkYXRlLmNvbmRpdGlvbnMgPT09ICdvYmplY3QnXG4gICk7XG59XG4iLCAiaW1wb3J0ICogYXMgdnNjb2RlIGZyb20gJ3ZzY29kZSc7XG5pbXBvcnQgdHlwZSB7IEZpbGVSZWYgfSBmcm9tICcuLi90eXBlcy50cyc7XG5pbXBvcnQgdHlwZSB7IFN0b3JlIH0gZnJvbSAnLi4vc3RvcmUudHMnO1xuaW1wb3J0IHR5cGUgeyBQZGZTZWFyY2hTZXJ2aWNlLCBJbmRleFN1bW1hcnkgfSBmcm9tICcuLi9zZWFyY2gvcGRmU2VhcmNoLnRzJztcbmltcG9ydCB0eXBlIHsgUHJvdmlkZXJSZWdpc3RyeSB9IGZyb20gJy4uL2FwaS9yZWdpc3RyeS50cyc7XG5pbXBvcnQgdHlwZSB7IFNlYXJjaEhpdCwgU2VhcmNoUmVzdWx0IH0gZnJvbSAnLi4vYXBpL3R5cGVzLnRzJztcbmltcG9ydCB0eXBlIHsgSG9zdFRvV2VidmlldywgVWlGaWxlLCBVaVNlY3Rpb24sIFVpU3RhdGUsIFdlYnZpZXdUb0hvc3QgfSBmcm9tICcuL3Byb3RvY29sLnRzJztcblxuY29uc3QgU0VBUkNIX0RFQk9VTkNFX01TID0gMjIwO1xuXG5mdW5jdGlvbiBhc1VpRmlsZShmaWxlOiBGaWxlUmVmLCBkZXRhaWw/OiBzdHJpbmcpOiBVaUZpbGUge1xuICByZXR1cm4ge1xuICAgIHBhdGg6IGZpbGUucGF0aCxcbiAgICBuYW1lOiBmaWxlLm5hbWUsXG4gICAgcmVsYXRpdmVQYXRoOiBmaWxlLnJlbGF0aXZlUGF0aCxcbiAgICBleHRlcm5hbDogZmlsZS5leHRlcm5hbCxcbiAgICBkZXRhaWwsXG4gIH07XG59XG5cbi8qKlxuICogSG9zdHMgdGhlIHNpZGViYXIuIE93bnMgbm90aGluZyBkb21haW4tc3BlY2lmaWM6IGl0IHJlbmRlcnMgd2hhdGV2ZXIgdGhlXG4gKiByZWdpc3RlcmVkIHNlY3Rpb24vc2VhcmNoIHByb3ZpZGVycyByZXR1cm4sIHdoaWNoIGlzIHdoYXQgbWFrZXMgdGhlIFVJXG4gKiBleHRlbmRhYmxlIHdpdGhvdXQgZWRpdGluZyB0aGlzIGZpbGUuXG4gKi9cbmV4cG9ydCBjbGFzcyBIdWJWaWV3UHJvdmlkZXIgaW1wbGVtZW50cyB2c2NvZGUuV2Vidmlld1ZpZXdQcm92aWRlciB7XG4gIHN0YXRpYyByZWFkb25seSB2aWV3VHlwZSA9ICdwZGZIdWIubWFpbic7XG5cbiAgcHJpdmF0ZSB2aWV3OiB2c2NvZGUuV2Vidmlld1ZpZXcgfCB1bmRlZmluZWQ7XG4gIHByaXZhdGUgc3RhdGU6IFVpU3RhdGUgfCB1bmRlZmluZWQ7XG4gIHByaXZhdGUgc2VhcmNoVGV4dCA9ICcnO1xuICBwcml2YXRlIG5hbWVPbmx5ID0gZmFsc2U7XG4gIHByaXZhdGUgc2VhcmNoVGltZXI6IE5vZGVKUy5UaW1lb3V0IHwgdW5kZWZpbmVkO1xuICBwcml2YXRlIHNlYXJjaFJ1biA9IDA7XG4gIHByaXZhdGUgaW5kZXhQcm9ncmVzczogSW5kZXhTdW1tYXJ5ID0ge1xuICAgIHBoYXNlOiAnaWRsZScsXG4gICAgcHJvY2Vzc2VkOiAwLFxuICAgIHRvdGFsOiAwLFxuICAgIGNhY2hlZDogMCxcbiAgICBleHRyYWN0ZWQ6IDAsXG4gICAgc2tpcHBlZDogMCxcbiAgICBmYWlsZWQ6IDAsXG4gICAgZWxhcHNlZE1zOiAwLFxuICB9O1xuICBwcml2YXRlIHJlYWRvbmx5IHZpZXdPcGVuZWRFbWl0dGVyID0gbmV3IHZzY29kZS5FdmVudEVtaXR0ZXI8dm9pZD4oKTtcbiAgLyoqIEZpcmVzIHdoZW4gdGhlIHNpZGViYXIgYmVjb21lcyB2aXNpYmxlLCBzbyBpbmRleGluZyBjYW4gYmUgZGVmZXJyYWJsZS4gKi9cbiAgcmVhZG9ubHkgb25WaWV3T3BlbmVkID0gdGhpcy52aWV3T3BlbmVkRW1pdHRlci5ldmVudDtcbiAgcHJpdmF0ZSB2aWV3T3BlbmVkT25jZSA9IGZhbHNlO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgcmVhZG9ubHkgZXh0ZW5zaW9uVXJpOiB2c2NvZGUuVXJpLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgc3RvcmU6IFN0b3JlLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgc2VydmljZTogUGRmU2VhcmNoU2VydmljZSxcbiAgICBwcml2YXRlIHJlYWRvbmx5IHJlZ2lzdHJ5OiBQcm92aWRlclJlZ2lzdHJ5LFxuICAgIHByaXZhdGUgcmVhZG9ubHkgb3BlbkZpbGU6IChmaWxlOiBGaWxlUmVmKSA9PiBQcm9taXNlPHZvaWQ+LFxuICAgIHByaXZhdGUgcmVhZG9ubHkgZXh0ZXJuYWxQaWNrZXI6ICgpID0+IFByb21pc2U8dm9pZD4sXG4gICAgcHJpdmF0ZSByZWFkb25seSBncm91cEFjdGlvbnM6IHtcbiAgICAgIGNyZWF0ZTogKCkgPT4gUHJvbWlzZTx2b2lkPjtcbiAgICAgIHJlbmFtZTogKGdyb3VwSWQ6IHN0cmluZykgPT4gUHJvbWlzZTx2b2lkPjtcbiAgICAgIGRlbGV0ZTogKGdyb3VwSWQ6IHN0cmluZykgPT4gUHJvbWlzZTx2b2lkPjtcbiAgICB9XG4gICkge1xuICAgIHRoaXMuc3RvcmUub25EaWRDaGFuZ2UoKCkgPT4gdm9pZCB0aGlzLnB1c2goKSk7XG4gICAgdGhpcy5yZWdpc3RyeS5vbkRpZENoYW5nZSgoKSA9PiB2b2lkIHRoaXMucHVzaCgpKTtcbiAgICB0aGlzLnNlcnZpY2Uub25Qcm9ncmVzcygocHJvZ3Jlc3MpID0+IHtcbiAgICAgIHRoaXMuaW5kZXhQcm9ncmVzcyA9IHByb2dyZXNzO1xuICAgICAgdm9pZCB0aGlzLnB1c2goKTtcbiAgICB9KTtcbiAgfVxuXG4gIHJlc29sdmVXZWJ2aWV3Vmlldyh2aWV3OiB2c2NvZGUuV2Vidmlld1ZpZXcpOiB2b2lkIHtcbiAgICB0aGlzLnZpZXcgPSB2aWV3O1xuICAgIGlmICghdGhpcy52aWV3T3BlbmVkT25jZSkge1xuICAgICAgdGhpcy52aWV3T3BlbmVkT25jZSA9IHRydWU7XG4gICAgICB0aGlzLnZpZXdPcGVuZWRFbWl0dGVyLmZpcmUoKTtcbiAgICB9XG4gICAgdmlldy53ZWJ2aWV3Lm9wdGlvbnMgPSB7XG4gICAgICBlbmFibGVTY3JpcHRzOiB0cnVlLFxuICAgICAgbG9jYWxSZXNvdXJjZVJvb3RzOiBbdnNjb2RlLlVyaS5qb2luUGF0aCh0aGlzLmV4dGVuc2lvblVyaSwgJ21lZGlhJyldLFxuICAgIH07XG4gICAgdmlldy53ZWJ2aWV3Lmh0bWwgPSB0aGlzLnJlbmRlckh0bWwodmlldy53ZWJ2aWV3KTtcbiAgICB2aWV3LndlYnZpZXcub25EaWRSZWNlaXZlTWVzc2FnZSgobWVzc2FnZTogV2Vidmlld1RvSG9zdCkgPT4gdm9pZCB0aGlzLm9uTWVzc2FnZShtZXNzYWdlKSk7XG4gICAgdmlldy5vbkRpZERpc3Bvc2UoKCkgPT4ge1xuICAgICAgdGhpcy52aWV3ID0gdW5kZWZpbmVkO1xuICAgIH0pO1xuICB9XG5cbiAgYXN5bmMgZm9jdXMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdnNjb2RlLmNvbW1hbmRzLmV4ZWN1dGVDb21tYW5kKGAke0h1YlZpZXdQcm92aWRlci52aWV3VHlwZX0uZm9jdXNgKTtcbiAgfVxuXG4gIC8qKiBSZWNvbXB1dGVzIHRoZSB3aG9sZSBzaWRlYmFyIHBheWxvYWQgYW5kIHNlbmRzIGl0IHRvIHRoZSB3ZWJ2aWV3LiAqL1xuICBhc3luYyBwdXNoKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghdGhpcy52aWV3KSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHN0YXRlID0gYXdhaXQgdGhpcy5idWlsZFN0YXRlKCk7XG4gICAgdGhpcy5zdGF0ZSA9IHN0YXRlO1xuICAgIHZvaWQgdGhpcy52aWV3LndlYnZpZXcucG9zdE1lc3NhZ2UoeyB0eXBlOiAnc3RhdGUnLCBzdGF0ZSB9IHNhdGlzZmllcyBIb3N0VG9XZWJ2aWV3KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgYnVpbGRTdGF0ZSgpOiBQcm9taXNlPFVpU3RhdGU+IHtcbiAgICBjb25zdCBzZWN0aW9uczogVWlTZWN0aW9uW10gPSBbXTtcbiAgICBmb3IgKGNvbnN0IHByb3ZpZGVyIG9mIHRoaXMucmVnaXN0cnkuZ2V0U2VjdGlvblByb3ZpZGVycygpKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCBzbmFwc2hvdHMgPSBhd2FpdCBwcm92aWRlci5nZXRTZWN0aW9ucygpO1xuICAgICAgICBmb3IgKGNvbnN0IHNuYXBzaG90IG9mIHNuYXBzaG90cykge1xuICAgICAgICAgIHNlY3Rpb25zLnB1c2goe1xuICAgICAgICAgICAgaWQ6IHNuYXBzaG90LmlkLFxuICAgICAgICAgICAgdGl0bGU6IHNuYXBzaG90LnRpdGxlLFxuICAgICAgICAgICAgaWNvbjogaWNvbkZvcihwcm92aWRlci5pZCksXG4gICAgICAgICAgICBmaWxlczogc25hcHNob3QuaXRlbXM/Lm1hcCgoaXRlbSkgPT4gYXNVaUZpbGUoaXRlbS5maWxlLCBpdGVtLmRldGFpbCkpLFxuICAgICAgICAgICAgZ3JvdXBzOiBzbmFwc2hvdC5ncm91cHM/Lm1hcCgoZ3JvdXApID0+ICh7XG4gICAgICAgICAgICAgIGlkOiBncm91cC5pZCxcbiAgICAgICAgICAgICAgdGl0bGU6IGdyb3VwLnRpdGxlLFxuICAgICAgICAgICAgICBmaWxlczogZ3JvdXAuaXRlbXMubWFwKChpdGVtKSA9PiBhc1VpRmlsZShpdGVtLmZpbGUsIGl0ZW0uZGV0YWlsKSksXG4gICAgICAgICAgICAgIGhpbnQ6IGdyb3VwLmhpbnQsXG4gICAgICAgICAgICAgIHNtYXJ0OiBwcm92aWRlci5pZCA9PT0gJ3NtYXJ0JyxcbiAgICAgICAgICAgICAgZW5hYmxlZDogdGhpcy5zdG9yZS5nZXRTbWFydEdyb3VwKGdyb3VwLmlkKT8uZW5hYmxlZCA/PyB0cnVlLFxuICAgICAgICAgICAgfSkpLFxuICAgICAgICAgICAgaGludDogc25hcHNob3QuaGludCxcbiAgICAgICAgICAgIHN1cHBvcnRzR3JvdXBzOiBwcm92aWRlci5pZCA9PT0gJ2Zhdm9yaXRlcycsXG4gICAgICAgICAgICBzdXBwb3J0c1NtYXJ0R3JvdXBzOiBwcm92aWRlci5pZCA9PT0gJ3NtYXJ0JyxcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgc2VjdGlvbnMucHVzaCh7XG4gICAgICAgICAgaWQ6IGAke3Byb3ZpZGVyLmlkfS1lcnJvcmAsXG4gICAgICAgICAgdGl0bGU6IHByb3ZpZGVyLmxhYmVsLFxuICAgICAgICAgIGljb246ICd3YXJuaW5nJyxcbiAgICAgICAgICBmaWxlczogW10sXG4gICAgICAgICAgaGludDogYFByb3ZpZGVyIGZhaWxlZDogJHtTdHJpbmcoZXJyb3IpfWAsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuc3RhdGUgPSB7XG4gICAgICBzZWN0aW9ucyxcbiAgICAgIGdyb3VwczogdGhpcy5zdG9yZS5nZXRHcm91cHMoKS5tYXAoKGcpID0+ICh7IGlkOiBnLmlkLCBuYW1lOiBnLm5hbWUsIGNvdW50OiBnLmZpbGVzLmxlbmd0aCB9KSksXG4gICAgICBleHRlcm5hbENvdW50OiB0aGlzLnN0b3JlLmdldEV4dGVybmFsKCkubGVuZ3RoLFxuICAgICAgZXh0ZXJuYWxNYXg6IHRoaXMuc3RvcmUuZXh0ZXJuYWxNYXgsXG4gICAgICBpbmRleDoge1xuICAgICAgICBwaGFzZTogdGhpcy5pbmRleFByb2dyZXNzLnBoYXNlLFxuICAgICAgICBwcm9jZXNzZWQ6IHRoaXMuaW5kZXhQcm9ncmVzcy5wcm9jZXNzZWQsXG4gICAgICAgIHRvdGFsOiB0aGlzLmluZGV4UHJvZ3Jlc3MudG90YWwsXG4gICAgICAgIGN1cnJlbnRGaWxlOiB0aGlzLmluZGV4UHJvZ3Jlc3MuY3VycmVudEZpbGUsXG4gICAgICAgIGNhY2hlZDogdGhpcy5pbmRleFByb2dyZXNzLmNhY2hlZCxcbiAgICAgICAgZXh0cmFjdGVkOiB0aGlzLmluZGV4UHJvZ3Jlc3MuZXh0cmFjdGVkLFxuICAgICAgICBza2lwcGVkOiB0aGlzLmluZGV4UHJvZ3Jlc3Muc2tpcHBlZCxcbiAgICAgICAgZmFpbGVkOiB0aGlzLmluZGV4UHJvZ3Jlc3MuZmFpbGVkLFxuICAgICAgICBlbGFwc2VkTXM6IHRoaXMuaW5kZXhQcm9ncmVzcy5lbGFwc2VkTXMsXG4gICAgICAgIHN1bW1hcnk6IHRoaXMuaW5kZXhQcm9ncmVzcy5zdW1tYXJ5LFxuICAgICAgfSxcbiAgICAgIHNlYXJjaDogdGhpcy5zdGF0ZT8uc2VhcmNoID8/IG51bGwsXG4gICAgfTtcbiAgICByZXR1cm4gdGhpcy5zdGF0ZTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgb25NZXNzYWdlKG1lc3NhZ2U6IFdlYnZpZXdUb0hvc3QpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBzd2l0Y2ggKG1lc3NhZ2UudHlwZSkge1xuICAgICAgY2FzZSAncmVhZHknOlxuICAgICAgICBhd2FpdCB0aGlzLnB1c2goKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgY2FzZSAnc2VhcmNoJzpcbiAgICAgICAgdGhpcy5zZWFyY2hUZXh0ID0gbWVzc2FnZS50ZXh0O1xuICAgICAgICB0aGlzLm5hbWVPbmx5ID0gbWVzc2FnZS5uYW1lT25seTtcbiAgICAgICAgdGhpcy5zY2hlZHVsZVNlYXJjaCgpO1xuICAgICAgICByZXR1cm47XG4gICAgICBjYXNlICdvcGVuJzoge1xuICAgICAgICBhd2FpdCB0aGlzLm9wZW5GaWxlKHsgcGF0aDogbWVzc2FnZS5wYXRoLCBuYW1lOiBtZXNzYWdlLnBhdGguc3BsaXQoL1tcXFxcL10vKS5wb3AoKSA/PyBtZXNzYWdlLnBhdGggfSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGNhc2UgJ29wZW5FeHRlcm5hbFBpY2tlcic6XG4gICAgICAgIGF3YWl0IHRoaXMuZXh0ZXJuYWxQaWNrZXIoKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgY2FzZSAnY3JlYXRlR3JvdXAnOlxuICAgICAgICBhd2FpdCB0aGlzLmdyb3VwQWN0aW9ucy5jcmVhdGUoKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgY2FzZSAncmVuYW1lR3JvdXAnOlxuICAgICAgICBhd2FpdCB0aGlzLmdyb3VwQWN0aW9ucy5yZW5hbWUobWVzc2FnZS5ncm91cElkKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgY2FzZSAnZGVsZXRlR3JvdXAnOlxuICAgICAgICBhd2FpdCB0aGlzLmdyb3VwQWN0aW9ucy5kZWxldGUobWVzc2FnZS5ncm91cElkKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgY2FzZSAncmVtb3ZlRmF2b3JpdGUnOlxuICAgICAgICB0aGlzLnN0b3JlLnJlbW92ZUZhdm9yaXRlKG1lc3NhZ2UucGF0aCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIGNhc2UgJ3JlbW92ZUV4dGVybmFsJzpcbiAgICAgICAgdGhpcy5zdG9yZS5yZW1vdmVFeHRlcm5hbChtZXNzYWdlLnBhdGgpO1xuICAgICAgICByZXR1cm47XG4gICAgICBjYXNlICdtb3ZlVG9Hcm91cCc6IHtcbiAgICAgICAgY29uc3QgZmlsZSA9IHRoaXMuZmluZEZpbGVSZWYobWVzc2FnZS5wYXRoKTtcbiAgICAgICAgaWYgKGZpbGUpIHtcbiAgICAgICAgICB0aGlzLnN0b3JlLmFkZEZhdm9yaXRlKGZpbGUsIG1lc3NhZ2UuZ3JvdXBJZCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgY2FzZSAncmVpbmRleCc6XG4gICAgICAgIGF3YWl0IHZzY29kZS5jb21tYW5kcy5leGVjdXRlQ29tbWFuZCgncGRmSHViLnJlaW5kZXgnKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgY2FzZSAnY2FuY2VsSW5kZXgnOlxuICAgICAgICB0aGlzLnNlcnZpY2UuY2FuY2VsSW5kZXgoKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgY2FzZSAnY3JlYXRlU21hcnRHcm91cCc6XG4gICAgICAgIGF3YWl0IHZzY29kZS5jb21tYW5kcy5leGVjdXRlQ29tbWFuZCgncGRmSHViLmNyZWF0ZVNtYXJ0R3JvdXAnKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgY2FzZSAnZWRpdFNtYXJ0R3JvdXAnOlxuICAgICAgICBhd2FpdCB2c2NvZGUuY29tbWFuZHMuZXhlY3V0ZUNvbW1hbmQoJ3BkZkh1Yi5lZGl0U21hcnRHcm91cCcsIG1lc3NhZ2UuZ3JvdXBJZCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIGNhc2UgJ3RvZ2dsZVNtYXJ0R3JvdXAnOlxuICAgICAgICBhd2FpdCB2c2NvZGUuY29tbWFuZHMuZXhlY3V0ZUNvbW1hbmQoJ3BkZkh1Yi50b2dnbGVTbWFydEdyb3VwJywgbWVzc2FnZS5ncm91cElkKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgY2FzZSAnZGVsZXRlU21hcnRHcm91cCc6XG4gICAgICAgIGF3YWl0IHZzY29kZS5jb21tYW5kcy5leGVjdXRlQ29tbWFuZCgncGRmSHViLmRlbGV0ZVNtYXJ0R3JvdXAnLCBtZXNzYWdlLmdyb3VwSWQpO1xuICAgICAgICByZXR1cm47XG4gICAgICBjYXNlICdyZWZyZXNoJzpcbiAgICAgICAgYXdhaXQgdGhpcy5wdXNoKCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHJldHVybjtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGZpbmRGaWxlUmVmKHBhdGg6IHN0cmluZyk6IEZpbGVSZWYgfCB1bmRlZmluZWQge1xuICAgIGNvbnN0IGtleSA9IHBhdGgucmVwbGFjZSgvXFxcXC9nLCAnLycpLnRvTG93ZXJDYXNlKCk7XG4gICAgZm9yIChjb25zdCBncm91cCBvZiB0aGlzLnN0b3JlLmdldEdyb3VwcygpKSB7XG4gICAgICBmb3IgKGNvbnN0IGZpbGUgb2YgZ3JvdXAuZmlsZXMpIHtcbiAgICAgICAgaWYgKGZpbGUucGF0aC5yZXBsYWNlKC9cXFxcL2csICcvJykudG9Mb3dlckNhc2UoKSA9PT0ga2V5KSB7XG4gICAgICAgICAgcmV0dXJuIGZpbGU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHsgcGF0aCwgbmFtZTogcGF0aC5zcGxpdCgvW1xcXFwvXS8pLnBvcCgpID8/IHBhdGggfTtcbiAgfVxuXG4gIHByaXZhdGUgc2NoZWR1bGVTZWFyY2goKTogdm9pZCB7XG4gICAgaWYgKHRoaXMuc2VhcmNoVGltZXIpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLnNlYXJjaFRpbWVyKTtcbiAgICB9XG4gICAgdGhpcy5zZWFyY2hUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4gdm9pZCB0aGlzLnJ1blNlYXJjaCgpLCBTRUFSQ0hfREVCT1VOQ0VfTVMpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBydW5TZWFyY2goKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgdGV4dCA9IHRoaXMuc2VhcmNoVGV4dC50cmltKCk7XG4gICAgY29uc3QgbWluQ2hhcnMgPSBNYXRoLm1heCgxLCB2c2NvZGUud29ya3NwYWNlLmdldENvbmZpZ3VyYXRpb24oJ3BkZkh1YicpLmdldDxudW1iZXI+KCdzZWFyY2gubWluQ2hhcnMnLCAyKSk7XG4gICAgY29uc3QgcnVuID0gKyt0aGlzLnNlYXJjaFJ1bjtcblxuICAgIGlmICghdGhpcy52aWV3KSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKHRleHQubGVuZ3RoIDwgbWluQ2hhcnMpIHtcbiAgICAgIHRoaXMuc3RhdGUgPSB7XG4gICAgICAgIC4uLih0aGlzLnN0YXRlID8/IChhd2FpdCB0aGlzLmJ1aWxkU3RhdGUoKSkpLFxuICAgICAgICBzZWFyY2g6IG51bGwsXG4gICAgICB9O1xuICAgICAgYXdhaXQgdGhpcy5wdXNoKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgcGVuZGluZzogVWlTdGF0ZVsnc2VhcmNoJ10gPSB7XG4gICAgICB0ZXh0LFxuICAgICAgbmFtZU9ubHk6IHRoaXMubmFtZU9ubHksXG4gICAgICBydW5uaW5nOiB0cnVlLFxuICAgICAgaGl0czogW10sXG4gICAgICBjb250ZW50U2VhcmNoZWQ6ICF0aGlzLm5hbWVPbmx5LFxuICAgIH07XG4gICAgdGhpcy5zdGF0ZSA9IHsgLi4uKHRoaXMuc3RhdGUgPz8gKGF3YWl0IHRoaXMuYnVpbGRTdGF0ZSgpKSksIHNlYXJjaDogcGVuZGluZyB9O1xuICAgIGF3YWl0IHRoaXMucHVzaCgpO1xuXG4gICAgY29uc3QgdG9rZW5Tb3VyY2UgPSBuZXcgdnNjb2RlLkNhbmNlbGxhdGlvblRva2VuU291cmNlKCk7XG4gICAgY29uc3Qgc3RhcnRlZCA9IERhdGUubm93KCk7XG4gICAgdHJ5IHtcbiAgICAgIGlmICghdGhpcy5uYW1lT25seSkge1xuICAgICAgICAvLyBNYWtlIHN1cmUgY29udGVudCBpcyBpbmRleGVkIGJlZm9yZSBjbGFpbWluZyBhIGNvbnRlbnQgc2VhcmNoIHJlc3VsdC5cbiAgICAgICAgYXdhaXQgdGhpcy5zZXJ2aWNlLmVuc3VyZUluZGV4KCk7XG4gICAgICAgIGlmIChydW4gIT09IHRoaXMuc2VhcmNoUnVuKSB7XG4gICAgICAgICAgdG9rZW5Tb3VyY2UuY2FuY2VsKCk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBjb25zdCBwcm92aWRlcnMgPSB0aGlzLnJlZ2lzdHJ5LmdldFNlYXJjaFByb3ZpZGVycygpO1xuICAgICAgY29uc3QgcmVzdWx0cyA9IChcbiAgICAgICAgYXdhaXQgUHJvbWlzZS5hbGwoXG4gICAgICAgICAgcHJvdmlkZXJzLm1hcCgocHJvdmlkZXIpID0+XG4gICAgICAgICAgICBwcm92aWRlclxuICAgICAgICAgICAgICAuc2VhcmNoKHtcbiAgICAgICAgICAgICAgICB0ZXh0LFxuICAgICAgICAgICAgICAgIG5hbWVPbmx5OiB0aGlzLm5hbWVPbmx5LFxuICAgICAgICAgICAgICAgIHRva2VuOiB0b2tlblNvdXJjZS50b2tlbixcbiAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgLmNhdGNoKChlcnJvcik6IFNlYXJjaFJlc3VsdCA9PiAoeyBwcm92aWRlcklkOiBwcm92aWRlci5pZCwgbGFiZWw6IHByb3ZpZGVyLmxhYmVsLCBoaXRzOiBbXSwgbm90ZTogU3RyaW5nKGVycm9yKSB9KSlcbiAgICAgICAgICApXG4gICAgICAgIClcbiAgICAgIClcbiAgICAgICAgLmZpbHRlcihCb29sZWFuKVxuICAgICAgICAuZmxhdCgpO1xuXG4gICAgICBpZiAocnVuICE9PSB0aGlzLnNlYXJjaFJ1biB8fCAhdGhpcy52aWV3KSB7XG4gICAgICAgIHRva2VuU291cmNlLmNhbmNlbCgpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGhpdHM6IFNlYXJjaEhpdFtdID0gZGVkdXBlSGl0cyhyZXN1bHRzLmZsYXRNYXAoKHIpID0+IHIuaGl0cykpO1xuICAgICAgY29uc3Qgbm90ZXMgPSByZXN1bHRzLm1hcCgocikgPT4gci5ub3RlKS5maWx0ZXIoKG4pOiBuIGlzIHN0cmluZyA9PiBCb29sZWFuKG4pKTtcbiAgICAgIGNvbnN0IG5vdGUgPSBub3Rlcy5sZW5ndGhcbiAgICAgICAgPyBub3Rlc1swXVxuICAgICAgICA6IGAke2hpdHMubGVuZ3RofSBtYXRjaChlcykgaW4gJHtEYXRlLm5vdygpIC0gc3RhcnRlZH0gbXNgO1xuXG4gICAgICB0aGlzLnN0YXRlID0ge1xuICAgICAgICAuLi4odGhpcy5zdGF0ZSA/PyAoYXdhaXQgdGhpcy5idWlsZFN0YXRlKCkpKSxcbiAgICAgICAgc2VhcmNoOiB7XG4gICAgICAgICAgdGV4dCxcbiAgICAgICAgICBuYW1lT25seTogdGhpcy5uYW1lT25seSxcbiAgICAgICAgICBydW5uaW5nOiBmYWxzZSxcbiAgICAgICAgICBoaXRzOiBoaXRzLnNsaWNlKDAsIDMwMCkubWFwKChoaXQpID0+ICh7XG4gICAgICAgICAgICBwYXRoOiBoaXQucGF0aCxcbiAgICAgICAgICAgIG5hbWU6IGhpdC5uYW1lLFxuICAgICAgICAgICAgbG9jYXRpb246IGhpdC5sb2NhdGlvbixcbiAgICAgICAgICAgIGV4Y2VycHQ6IGhpdC5leGNlcnB0LFxuICAgICAgICAgICAgbWF0Y2hMZW5ndGg6IGhpdC5tYXRjaExlbmd0aCxcbiAgICAgICAgICAgIHNvdXJjZTogaGl0LnNvdXJjZSA/PyAnc2VhcmNoJyxcbiAgICAgICAgICB9KSksXG4gICAgICAgICAgbm90ZSxcbiAgICAgICAgICBjb250ZW50U2VhcmNoZWQ6ICF0aGlzLm5hbWVPbmx5LFxuICAgICAgICB9LFxuICAgICAgfTtcbiAgICAgIGF3YWl0IHRoaXMucHVzaCgpO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAodGhpcy52aWV3KSB7XG4gICAgICAgIHZvaWQgdGhpcy52aWV3LndlYnZpZXcucG9zdE1lc3NhZ2UoeyB0eXBlOiAnZXJyb3InLCBtZXNzYWdlOiBTdHJpbmcoZXJyb3IpIH0gc2F0aXNmaWVzIEhvc3RUb1dlYnZpZXcpO1xuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0b2tlblNvdXJjZS5kaXNwb3NlKCk7XG4gICAgfVxuICB9XG5cbiAgZGlzcG9zZSgpOiB2b2lkIHtcbiAgICB0aGlzLnZpZXdPcGVuZWRFbWl0dGVyLmRpc3Bvc2UoKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVySHRtbCh3ZWJ2aWV3OiB2c2NvZGUuV2Vidmlldyk6IHN0cmluZyB7XG4gICAgY29uc3Qgbm9uY2UgPSBtYWtlTm9uY2UoKTtcbiAgICBjb25zdCBzY3JpcHRVcmkgPSB3ZWJ2aWV3LmFzV2Vidmlld1VyaSh2c2NvZGUuVXJpLmpvaW5QYXRoKHRoaXMuZXh0ZW5zaW9uVXJpLCAnbWVkaWEnLCAnd2VidmlldycsICdtYWluLmpzJykpO1xuICAgIGNvbnN0IHN0eWxlVXJpID0gd2Vidmlldy5hc1dlYnZpZXdVcmkodnNjb2RlLlVyaS5qb2luUGF0aCh0aGlzLmV4dGVuc2lvblVyaSwgJ21lZGlhJywgJ3dlYnZpZXcnLCAnbWFpbi5jc3MnKSk7XG4gICAgY29uc3QgY3NwID0gW1xuICAgICAgYGRlZmF1bHQtc3JjICdub25lJ2AsXG4gICAgICBgaW1nLXNyYyAke3dlYnZpZXcuY3NwU291cmNlfSBkYXRhOmAsXG4gICAgICBgc3R5bGUtc3JjICR7d2Vidmlldy5jc3BTb3VyY2V9YCxcbiAgICAgIGBzY3JpcHQtc3JjICdub25jZS0ke25vbmNlfSdgLFxuICAgICAgYGZvbnQtc3JjICR7d2Vidmlldy5jc3BTb3VyY2V9YCxcbiAgICBdLmpvaW4oJzsgJyk7XG5cbiAgICByZXR1cm4gYDwhRE9DVFlQRSBodG1sPlxuPGh0bWwgbGFuZz1cImVuXCI+XG4gIDxoZWFkPlxuICAgIDxtZXRhIGNoYXJzZXQ9XCJVVEYtOFwiIC8+XG4gICAgPG1ldGEgaHR0cC1lcXVpdj1cIkNvbnRlbnQtU2VjdXJpdHktUG9saWN5XCIgY29udGVudD1cIiR7Y3NwfVwiIC8+XG4gICAgPG1ldGEgbmFtZT1cInZpZXdwb3J0XCIgY29udGVudD1cIndpZHRoPWRldmljZS13aWR0aCwgaW5pdGlhbC1zY2FsZT0xLjBcIiAvPlxuICAgIDxsaW5rIGhyZWY9XCIke3N0eWxlVXJpfVwiIHJlbD1cInN0eWxlc2hlZXRcIiAvPlxuICAgIDx0aXRsZT5QREYgSHViPC90aXRsZT5cbiAgPC9oZWFkPlxuICA8Ym9keT5cbiAgICA8ZGl2IGlkPVwiYXBwXCIgZGF0YS1ub25jZT1cIiR7bm9uY2V9XCI+PC9kaXY+XG4gICAgPHNjcmlwdCBub25jZT1cIiR7bm9uY2V9XCIgc3JjPVwiJHtzY3JpcHRVcml9XCI+PC9zY3JpcHQ+XG4gIDwvYm9keT5cbjwvaHRtbD5gO1xuICB9XG59XG5cbmZ1bmN0aW9uIG1ha2VOb25jZSgpOiBzdHJpbmcge1xuICBjb25zdCBjaGFycyA9ICdBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWmFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6MDEyMzQ1Njc4OSc7XG4gIGxldCBvdXQgPSAnJztcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCAzMjsgaSArPSAxKSB7XG4gICAgb3V0ICs9IGNoYXJzLmNoYXJBdChNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiBjaGFycy5sZW5ndGgpKTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG5mdW5jdGlvbiBkZWR1cGVIaXRzKGhpdHM6IFNlYXJjaEhpdFtdKTogU2VhcmNoSGl0W10ge1xuICBjb25zdCBzZWVuID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGNvbnN0IG91dDogU2VhcmNoSGl0W10gPSBbXTtcbiAgZm9yIChjb25zdCBoaXQgb2YgaGl0cykge1xuICAgIGNvbnN0IGtleSA9IGAke2hpdC5wYXRoLnRvTG93ZXJDYXNlKCl9fCR7aGl0LmxvY2F0aW9uID8/ICcnfXwke2hpdC5zb3VyY2UgPz8gJyd9YDtcbiAgICBpZiAoc2Vlbi5oYXMoa2V5KSkge1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIHNlZW4uYWRkKGtleSk7XG4gICAgb3V0LnB1c2goaGl0KTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuXG5mdW5jdGlvbiBpY29uRm9yKHByb3ZpZGVySWQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHN3aXRjaCAocHJvdmlkZXJJZCkge1xuICAgIGNhc2UgJ3JlY2VudCc6XG4gICAgICByZXR1cm4gJ2hpc3RvcnknO1xuICAgIGNhc2UgJ2Zhdm9yaXRlcyc6XG4gICAgICByZXR1cm4gJ3N0YXInO1xuICAgIGNhc2UgJ2V4dGVybmFsJzpcbiAgICAgIHJldHVybiAnbGluay1leHRlcm5hbCc7XG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiAnbGlzdCc7XG4gIH1cbn1cbiIsICJpbXBvcnQgKiBhcyBmcyBmcm9tICdub2RlOmZzL3Byb21pc2VzJztcbmltcG9ydCAqIGFzIHZzY29kZSBmcm9tICd2c2NvZGUnO1xuaW1wb3J0IHR5cGUgeyBJbmRleENvbmZpZywgSW5kZXhFbnZpcm9ubWVudCB9IGZyb20gJy4vaW5kZXhTZXJ2aWNlLnRzJztcbmltcG9ydCB7IHBkZlRleHRFeHRyYWN0b3IgfSBmcm9tICcuL3NlYXJjaC9wZGZUZXh0LnRzJztcbmltcG9ydCB0eXBlIHsgRmlsZVJlZiB9IGZyb20gJy4vdHlwZXMudHMnO1xuXG4vKipcbiAqIFZTIENvZGUvcGRmLmpzIGFkYXB0ZXIgZm9yIHRoZSAodGVzdGVkKSBgSW5kZXhTZXJ2aWNlYC5cbiAqXG4gKiBUaGlzIG1vZHVsZSBpcyBpbnRlbnRpb25hbGx5IHRoaW46IGl0IHJlYWRzIGJ5dGVzIGFuZCBoYW5kcyBiYWNrIGV4dHJhY3RlZFxuICogcGFnZXMuIEFsbCBzY2hlZHVsaW5nLCBjYWNoaW5nLCBjYW5jZWxsYXRpb24gYW5kIHByb2dyZXNzIGFjY291bnRpbmcgbGl2ZSBpblxuICogYGluZGV4U2VydmljZS50c2AsIHdoZXJlIHRoZXkgYXJlIGNvdmVyZWQgYnkgdW5pdCB0ZXN0cy5cbiAqL1xuZXhwb3J0IGNsYXNzIFZzY29kZUluZGV4RW52aXJvbm1lbnQgaW1wbGVtZW50cyBJbmRleEVudmlyb25tZW50IHtcbiAgcHJpdmF0ZSBsaXN0ZXI6ICgoKSA9PiBQcm9taXNlPEZpbGVSZWZbXT4pIHwgdW5kZWZpbmVkO1xuXG4gIC8qKlxuICAgKiBUaGUgZmlsZSBsaXN0aW5nIGNvbWVzIGZyb20gYFBkZlNlYXJjaFNlcnZpY2VgLCB3aGljaCBpbiB0dXJuIG5lZWRzIHRoaXNcbiAgICogZW52aXJvbm1lbnQuIFN1cHBseWluZyBpdCBhZnRlciBjb25zdHJ1Y3Rpb24ga2VlcHMgdGhlIHR3byBmcmVlIG9mIGFcbiAgICogY2lyY3VsYXIgcmVmZXJlbmNlLlxuICAgKi9cbiAgdXNlRmlsZUxpc3QobGlzdGVyOiAoKSA9PiBQcm9taXNlPEZpbGVSZWZbXT4pOiB2b2lkIHtcbiAgICB0aGlzLmxpc3RlciA9IGxpc3RlcjtcbiAgfVxuXG4gIGFzeW5jIGxpc3RGaWxlcygpIHtcbiAgICBpZiAoIXRoaXMubGlzdGVyKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1ZzY29kZUluZGV4RW52aXJvbm1lbnQudXNlRmlsZUxpc3QoKSB3YXMgbmV2ZXIgY2FsbGVkJyk7XG4gICAgfVxuICAgIHJldHVybiB0aGlzLmxpc3RlcigpO1xuICB9XG5cbiAgYXN5bmMgc3RhdChwYXRoOiBzdHJpbmcpOiBQcm9taXNlPHsgbXRpbWVNczogbnVtYmVyOyBzaXplOiBudW1iZXIgfSB8IHVuZGVmaW5lZD4ge1xuICAgIGNvbnN0IHN0YXRzID0gYXdhaXQgZnMuc3RhdChwYXRoKS5jYXRjaCgoKSA9PiB1bmRlZmluZWQpO1xuICAgIGlmICghc3RhdHMgfHwgIXN0YXRzLmlzRmlsZSgpKSB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgICByZXR1cm4geyBtdGltZU1zOiBzdGF0cy5tdGltZU1zLCBzaXplOiBzdGF0cy5zaXplIH07XG4gIH1cblxuICBhc3luYyByZWFkKHBhdGg6IHN0cmluZyk6IFByb21pc2U8VWludDhBcnJheT4ge1xuICAgIGNvbnN0IGJ1ZmZlciA9IGF3YWl0IGZzLnJlYWRGaWxlKHBhdGgpO1xuICAgIHJldHVybiBuZXcgVWludDhBcnJheShidWZmZXIpO1xuICB9XG5cbiAgYXN5bmMgZXh0cmFjdChkYXRhOiBVaW50OEFycmF5KSB7XG4gICAgY29uc3QgcGFnZXMgPSBhd2FpdCBwZGZUZXh0RXh0cmFjdG9yLmV4dHJhY3QoZGF0YSk7XG4gICAgcmV0dXJuIHsgcGFnZXMsIHRydW5jYXRlZDogZmFsc2UsIHRvdGFsUGFnZXM6IHBhZ2VzLmxlbmd0aCB9O1xuICB9XG59XG5cbi8qKiBSZWFkcyB0aGUgaW5kZXhpbmcgY29uZmlndXJhdGlvbiBmcm9tIHVzZXIgc2V0dGluZ3MuICovXG5leHBvcnQgZnVuY3Rpb24gcmVhZEluZGV4Q29uZmlnKCk6IEluZGV4Q29uZmlnIHtcbiAgY29uc3QgY29uZmlnID0gdnNjb2RlLndvcmtzcGFjZS5nZXRDb25maWd1cmF0aW9uKCdwZGZIdWInKTtcbiAgcmV0dXJuIHtcbiAgICBtYXhGaWxlU2l6ZUJ5dGVzOiBNYXRoLm1heCgxLCBjb25maWcuZ2V0PG51bWJlcj4oJ3NlYXJjaC5tYXhGaWxlU2l6ZU1iJywgNDApKSAqIDEwMjQgKiAxMDI0LFxuICAgIG1heFRleHRDaGFyc1BlckZpbGU6IE1hdGgubWF4KDY0LCBjb25maWcuZ2V0PG51bWJlcj4oJ3NlYXJjaC5tYXhUZXh0S2JQZXJGaWxlJywgMjA0OCkpICogMTAyNCxcbiAgICBj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UUFBUSxVQUFVLFlBQVk7QUFBQSxJQUN2QyxRQUFRO0FBQUEsTUFDTixnQkFBZ0IsQ0FBQyxTQUFTLGlCQUFpQixRQUFRLElBQUk7QUFBQSxNQUN2RCxjQUFjLE1BQU0sUUFBUSxhQUFhLElBQUk7QUFBQSxJQUMvQztBQUFBLEVBQ0Y7QUFFQSxVQUFRLGNBQWM7QUFBQSxJQUNwQixJQUFXLG1CQUFXLE1BQU07QUFDMUIsVUFBSSxjQUFjO0FBQ2hCLHFCQUFhLFlBQVk7QUFBQSxNQUMzQjtBQUNBLFlBQU0sUUFBUTtBQUNkLGNBQVEsUUFBUTtBQUNoQixlQUFTLFFBQVE7QUFBQSxJQUNuQixDQUFDO0FBQUEsRUFDSDtBQUVBLFNBQU87QUFDVDtBQUVBLFNBQVMsYUFBYSxPQUErQztBQUNuRSxTQUFPLElBQVcsbUJBQVcsTUFBTSxNQUFNLFFBQVEsQ0FBQztBQUNwRDtBQUVPLFNBQVMsYUFBbUI7QUFFbkM7IiwKICAibmFtZXMiOiBbInZzY29kZSIsICJzdGF0IiwgInBhdGgiLCAicGF0aCIsICJwYXRoIiwgInZzY29kZSIsICJuYW1lIiwgInBhdGgiLCAidnNjb2RlIiwgImNvbmZpZyIsICJmaW5pc2hlZCIsICJwYXRoIiwgImZzIiwgInBhdGgiLCAidnNjb2RlIiwgInBhdGgiLCAid29ya3NwYWNlIiwgImdyb3VwIiwgInBhdGgiLCAidnNjb2RlIiwgInBhdGgiLCAiZnMiLCAidnNjb2RlIiwgInBhdGgiLCAiY29uZmlnIiwgInBhdGgiXQp9Cg==
