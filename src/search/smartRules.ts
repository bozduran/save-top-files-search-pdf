/**
 * Smart-group rules: declarative, pure, and fully unit tested.
 *
 * A rule turns "every file matching this description" into a live collection.
 * Keeping this module free of `vscode` is what makes the behaviour provable in
 * tests, including the human-readable explanations shown in the sidebar.
 */
import { matchesGlob, matchesRegex, normalizePath } from './glob.ts';

export type RuleMatchMode = 'all' | 'any';

export interface RuleConditions {
  /** Glob patterns; a file matches if it matches ANY of them. */
  includeGlobs?: string[];
  /** Glob patterns that veto a match. */
  excludeGlobs?: string[];
  /** Regular expression tested against the relative path. */
  includeRegex?: string;
  /** Alternate patterns: match either the globs or the regex. */
  globOrRegex?: boolean;
  /** Extensions without the dot, e.g. ["pdf", "md"]. */
  extensions?: string[];
  /** Size window in kilobytes. */
  minSizeKb?: number;
  maxSizeKb?: number;
  /** Recency window in days, based on modification time. */
  modifiedWithinDays?: number;
}

export interface SmartRule {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  matchMode: RuleMatchMode;
  ignoreCase: boolean;
  conditions: RuleConditions;
  /** Evaluation priority; lower runs first. */
  order: number;
}

export interface RuleCandidate {
  /** Path relative to its workspace folder, slash-separated. */
  relativePath: string;
  /** File name including extension. */
  name: string;
  sizeBytes?: number;
  /** Modification time in epoch milliseconds. */
  modifiedMs?: number;
}

export interface RuleEvaluation {
  matched: boolean;
  /** Which conditions matched, for the sidebar tooltip and tests. */
  reasons: string[];
  /** Conditions that were configured but did not match. */
  misses: string[];
}

function patternsFrom(value: string[] | undefined): string[] {
  return (value ?? []).map((entry) => entry.trim()).filter(Boolean);
}

function daysToMs(days: number): number {
  return Math.max(0, days) * 24 * 60 * 60 * 1000;
}

/**
 * Evaluates one rule against one file.
 *
 * `now` is injectable so recency rules are deterministic under test.
 */
export function evaluateRule(
  rule: SmartRule,
  candidate: RuleCandidate,
  now = Date.now()
): RuleEvaluation {
  const reasons: string[] = [];
  const misses: string[] = [];
  const ignoreCase = rule.ignoreCase;
  const path = normalizePath(candidate.relativePath);

  const includeGlobs = patternsFrom(rule.conditions.includeGlobs);
  const excludeGlobs = patternsFrom(rule.conditions.excludeGlobs);
  const extensions = patternsFrom(rule.conditions.extensions).map((ext) =>
    ext.replace(/^\./, '').toLowerCase()
  );

  // --- positive conditions -------------------------------------------------
  const positives: { label: string; hit: boolean }[] = [];

  if (includeGlobs.length) {
    const hit = includeGlobs.some((pattern) => matchesGlob(pattern, path, ignoreCase));
    const matchedPattern = includeGlobs.find((pattern) => matchesGlob(pattern, path, ignoreCase));
    positives.push({
      label: `matches ${matchedPattern ?? includeGlobs.join(' or ')}`,
      hit,
    });
  }

  if (rule.conditions.includeRegex) {
    const hit = matchesRegex(rule.conditions.includeRegex, path, ignoreCase);
    positives.push({ label: `matches /${rule.conditions.includeRegex}/`, hit });
  }

  if (rule.conditions.globOrRegex && positives.length > 1) {
    // Collapse glob + regex into a single either/or condition.
    const combined: { label: string; hit: boolean } = {
      label: positives.map((entry) => entry.label).join(' or '),
      hit: positives.some((entry) => entry.hit),
    };
    positives.length = 0;
    positives.push(combined);
  }

  if (extensions.length) {
    const ext = (candidate.name.split('.').pop() ?? '').toLowerCase();
    positives.push({ label: `extension .${ext || '?'}`, hit: extensions.includes(ext) });
  }

  if (rule.conditions.minSizeKb !== undefined) {
    const kb = (candidate.sizeBytes ?? 0) / 1024;
    positives.push({ label: `at least ${rule.conditions.minSizeKb} KB`, hit: kb >= rule.conditions.minSizeKb });
  }
  if (rule.conditions.maxSizeKb !== undefined) {
    const kb = (candidate.sizeBytes ?? 0) / 1024;
    positives.push({ label: `at most ${rule.conditions.maxSizeKb} KB`, hit: kb <= rule.conditions.maxSizeKb });
  }
  if (rule.conditions.modifiedWithinDays !== undefined) {
    const age = now - (candidate.modifiedMs ?? 0);
    positives.push({
      label: `changed in the last ${rule.conditions.modifiedWithinDays} day(s)`,
      hit: age >= 0 && age <= daysToMs(rule.conditions.modifiedWithinDays),
    });
  }

  for (const condition of positives) {
    (condition.hit ? reasons : misses).push(condition.label);
  }

  let matched: boolean;
  if (!positives.length) {
    // No positive conditions: everything matches unless an exclude vetoes it.
    matched = true;
  } else if (rule.matchMode === 'any') {
    matched = positives.some((condition) => condition.hit);
  } else {
    matched = positives.every((condition) => condition.hit);
  }

  // --- exclusions always veto ---------------------------------------------
  for (const pattern of excludeGlobs) {
    if (matchesGlob(pattern, path, ignoreCase)) {
      matched = false;
      misses.push(`excluded by ${pattern}`);
    }
  }

  return { matched, reasons, misses };
}

/** Keeps only the files that match the rule. */
export function filterByRule<T extends RuleCandidate>(
  rule: SmartRule,
  candidates: T[],
  now = Date.now()
): T[] {
  return candidates.filter((candidate) => evaluateRule(rule, candidate, now).matched);
}

/** One-line summary for the sidebar, e.g. "*.pdf, *.md · within 30 days". */
export function describeRule(rule: SmartRule): string {
  const parts: string[] = [];
  const { includeGlobs, excludeGlobs, includeRegex, extensions, minSizeKb, maxSizeKb, modifiedWithinDays } =
    rule.conditions;

  const globs = patternsFrom(includeGlobs);
  if (globs.length) {
    parts.push(globs.join(' or '));
  }
  if (includeRegex) {
    parts.push(`/${includeRegex}/`);
  }
  const exts = patternsFrom(extensions);
  if (exts.length) {
    parts.push(`*.{${exts.map((e) => e.replace(/^\./, '')).join(',')}}`);
  }
  if (minSizeKb !== undefined || maxSizeKb !== undefined) {
    parts.push(`${minSizeKb ?? 0}–${maxSizeKb ?? '∞'} KB`);
  }
  if (modifiedWithinDays !== undefined) {
    parts.push(`changed in ${modifiedWithinDays}d`);
  }
  const excluded = patternsFrom(excludeGlobs);
  if (!parts.length && !excluded.length) {
    return 'everything (no conditions yet)';
  }

  parts.push(rule.matchMode === 'any' ? 'any of these' : 'all of these');
  const base = parts.length > 1 ? parts.join(' · ') : 'everything';
  return excluded.length ? `${base} · except ${excluded.join(', ')}` : base;
}

/** Validates a rule before saving it, returning human-readable problems. */
export function validateRule(rule: SmartRule): string[] {
  const problems: string[] = [];
  if (!rule.name.trim()) {
    problems.push('A name is required.');
  }
  const { includeGlobs, excludeGlobs, includeRegex, extensions, minSizeKb, maxSizeKb, modifiedWithinDays } =
    rule.conditions;

  const hasPositive =
    patternsFrom(includeGlobs).length > 0 ||
    Boolean(includeRegex) ||
    patternsFrom(extensions).length > 0 ||
    minSizeKb !== undefined ||
    maxSizeKb !== undefined ||
    modifiedWithinDays !== undefined;

  if (!hasPositive) {
    problems.push('Add at least one condition (a pattern, extension, size or date filter).');
  }
  if (includeRegex && !isValidRegexSafe(includeRegex)) {
    problems.push(`The regular expression /${includeRegex}/ is not valid.`);
  }
  for (const pattern of [...patternsFrom(includeGlobs), ...patternsFrom(excludeGlobs)]) {
    if (pattern.includes('[') && !pattern.includes(']')) {
      problems.push(`The pattern "${pattern}" has an unclosed character class.`);
    }
  }
  if (minSizeKb !== undefined && maxSizeKb !== undefined && minSizeKb > maxSizeKb) {
    problems.push('The minimum size is larger than the maximum size.');
  }
  if (modifiedWithinDays !== undefined && modifiedWithinDays <= 0) {
    problems.push('The recency window must be at least one day.');
  }
  return problems;
}

function isValidRegexSafe(source: string): boolean {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}

/** Creates a rule with sane defaults. */
export function createRule(
  name: string,
  conditions: RuleConditions,
  overrides: Partial<SmartRule> = {}
): SmartRule {
  // Keep the caller's text (even if it is blank) so validateRule can report the
  // problem instead of the rule silently acquiring a default name.
  return {
    id: overrides.id ?? `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    description: overrides.description,
    enabled: overrides.enabled ?? true,
    matchMode: overrides.matchMode ?? 'all',
    ignoreCase: overrides.ignoreCase ?? true,
    order: overrides.order ?? 100,
    ...overrides,
    // The explicitly passed name and conditions always win over the overrides.
    name,
    conditions,
  };
}
