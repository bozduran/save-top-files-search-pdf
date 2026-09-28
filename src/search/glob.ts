/**
 * Pure glob matching for smart-group rules.
 *
 * Semantics (chosen to match what people expect from an editor search box):
 *   - `*`  matches any run of characters, but never `/`
 *   - `**` matches across path separators when it starts a path segment
 *   - `**` as its own segment also matches zero segments, so `**` + `/a.pdf`
 *     matches a top-level `a.pdf` and `docs/a.pdf`
 *   - a trailing `**` matches the whole remaining subtree
 *   - `?`  matches a single character except `/`
 *   - `[abc]`, `[a-z]`, `[!abc]` are character classes
 *   - `{a,b}` expands to alternatives
 *
 * A pattern without `/` is matched against the file name *and* every path
 * suffix, so `*.pdf` means "somewhere in the project" rather than only at the
 * workspace root.
 *
 * Patterns are compiled to regular expressions (with an LRU cache) rather than
 * matched character by character: user rules are evaluated against every file
 * in the project, so matching has to stay linear.
 *
 * No `vscode` import: this is unit tested directly.
 */

/** Normalizes a path for matching: forward slashes, no leading `./`. */
export function normalizePath(value: string): string {
  return value
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/{2,}/g, '/');
}

/** Expands `{a,b}` groups into separate patterns. */
export function expandBraces(pattern: string): string[] {
  const open = pattern.indexOf('{');
  if (open === -1) {
    return [pattern];
  }
  let depth = 0;
  let close = -1;
  for (let i = open; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
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

  const options: string[] = [];
  let current = '';
  let nesting = 0;
  for (const char of body) {
    if (char === '{') {
      nesting += 1;
    } else if (char === '}') {
      nesting -= 1;
    }
    if (char === ',' && nesting === 0) {
      options.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  options.push(current);

  return options.flatMap((option) => expandBraces(`${prefix}${option}${suffix}`));
}

/**
 * Converts one brace-free glob into a regular expression source string.
 *
 * `**` is only special when it begins a path segment (start of pattern or right
 * after `/`); anywhere else it behaves like `*`, which keeps patterns such as
 * `a/x**y` from silently matching across directories.
 */
export function globToRegExpSource(pattern: string): string {
  let source = '';
  let i = 0;
  while (i < pattern.length) {
    const char = pattern[i];

    if (char === '*' && pattern[i + 1] === '*' && (i === 0 || pattern[i - 1] === '/')) {
      if (pattern[i + 2] === '/') {
        // One or more whole path segments.
        source += '(?:[^/]+/)*';
        i += 3;
        continue;
      }
      // Trailing `**` (or `**` before more text) spans directories.
      source += '.*';
      i += 2;
      continue;
    }

    if (char === '*') {
      source += '[^/]*';
      i += 1;
      continue;
    }
    if (char === '?') {
      source += '[^/]';
      i += 1;
      continue;
    }
    if (char === '[') {
      const close = pattern.indexOf(']', i + 1);
      if (close === -1) {
        source += '\\[';
        i += 1;
        continue;
      }
      let body = pattern.slice(i + 1, close);
      let negated = false;
      if (body.startsWith('!') || body.startsWith('^')) {
        negated = true;
        body = body.slice(1);
      }
      const escaped = body.replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
      source += `[${negated ? '^' : ''}${escaped}]`;
      i = close + 1;
      continue;
    }

    source += char.replace(/[.+^${}()|\\[\]]/g, '\\$&');
    i += 1;
  }
  return source;
}

function compileOne(pattern: string, ignoreCase: boolean): RegExp {
  return new RegExp(`^${globToRegExpSource(pattern)}$`, ignoreCase ? 'i' : '');
}

interface CompiledPattern {
  /** Matchers for the whole relative path. */
  full: RegExp[];
  /** Matchers for the file name and path suffixes (patterns without `/`). */
  suffix: RegExp[];
}

/** Small LRU so repeated evaluations of the same rule do not recompile. */
const CACHE_LIMIT = 512;
const compiledCache = new Map<string, CompiledPattern>();

function compile(pattern: string, ignoreCase: boolean): CompiledPattern {
  const normalized = normalizePath(pattern);
  const key = `${ignoreCase ? 'i' : 's'}\u0000${normalized}`;
  const cached = compiledCache.get(key);
  if (cached) {
    compiledCache.delete(key); // refresh LRU position
    compiledCache.set(key, cached);
    return cached;
  }

  const expanded = expandBraces(normalized);
  const value: CompiledPattern = {
    full: expanded.map((entry) => compileOne(entry, ignoreCase)),
    suffix: normalized.includes('/') ? [] : expanded.map((entry) => compileOne(entry, ignoreCase)),
  };

  compiledCache.set(key, value);
  if (compiledCache.size > CACHE_LIMIT) {
    const oldest = compiledCache.keys().next().value;
    if (oldest !== undefined) {
      compiledCache.delete(oldest);
    }
  }
  return value;
}

/** Test hook: drops the compiled-pattern cache. */
export function clearGlobCache(): void {
  compiledCache.clear();
}

/**
 * Matches `pattern` against a relative path.
 *
 * Patterns containing `/` are anchored to the whole path. Patterns without `/`
 * are matched against the file name and every path suffix, so `*.pdf` finds
 * PDFs in any folder.
 */
export function matchesGlob(pattern: string, relativePath: string, ignoreCase = true): boolean {
  const path = normalizePath(relativePath);
  const { full, suffix } = compile(pattern, ignoreCase);

  for (const matcher of full) {
    if (matcher.test(path)) {
      return true;
    }
  }

  if (suffix.length) {
    const parts = path.split('/');
    const name = parts[parts.length - 1];
    for (const matcher of suffix) {
      if (matcher.test(name)) {
        return true;
      }
    }
    for (let i = 1; i < parts.length; i += 1) {
      const candidate = parts.slice(i).join('/');
      for (const matcher of suffix) {
        if (matcher.test(candidate)) {
          return true;
        }
      }
    }
  }
  return false;
}

/** True when the text looks like a usable regular expression. */
export function isValidRegex(source: string): boolean {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}

export function matchesRegex(source: string, relativePath: string, ignoreCase = true): boolean {
  try {
    const flags = ignoreCase ? 'i' : '';
    return new RegExp(source, flags).test(normalizePath(relativePath));
  } catch {
    return false;
  }
}
