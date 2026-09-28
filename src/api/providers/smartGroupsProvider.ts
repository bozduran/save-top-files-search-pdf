import * as fs from 'node:fs/promises';
import type { SectionItem, SectionProvider, SectionSnapshot } from '../types.ts';
import {
  describeRule,
  filterByRule,
  validateRule,
  type RuleCandidate,
  type SmartRule,
} from '../../search/smartRules.ts';
import { type FileRef } from '../../types.ts';

export interface SmartGroupMatch extends FileRef {
  matchedBy: string;
}

/**
 * The provider only needs to read rules, so it depends on this narrow interface
 * rather than the full store. Both `StoreCore` and its VS Code adapter satisfy
 * it, which keeps the provider unit testable.
 */
export interface SmartRuleSource {
  getSmartGroups(): SmartRule[];
  getSmartGroup(id: string): SmartRule | undefined;
  updateSmartGroup(id: string, patch: Partial<SmartRule>): SmartRule | undefined;
}

/**
 * Smart groups: live collections driven by rules instead of by hand.
 *
 * A rule is evaluated against the files the caller supplies, so the provider
 * stays free of VS Code APIs and works for any file type — not just PDFs.
 */
export class SmartGroupsProvider implements SectionProvider {
  readonly id = 'smart';
  readonly label = 'Smart groups';
  readonly order = 15;

  private readonly store: SmartRuleSource;
  private readonly candidates: () => FileRef[];
  private readonly options: {
    now?: () => number;
    statFile?: (path: string) => Promise<{ sizeBytes: number; modifiedMs: number } | undefined>;
  };

  constructor(
    store: SmartRuleSource,
    candidates: () => FileRef[],
    options: {
      now?: () => number;
      statFile?: (path: string) => Promise<{ sizeBytes: number; modifiedMs: number } | undefined>;
    } = {}
  ) {
    this.store = store;
    this.candidates = candidates;
    this.options = options;
  }

  async getSections(): Promise<SectionSnapshot[]> {
    const rules = this.store.getSmartGroups();
    if (!rules.length) {
      return [];
    }

    const files = this.candidates();
    const metadata = await this.collectMetadata(files);
    const now = this.options.now?.() ?? Date.now();

    const groups = rules
      .filter((rule) => rule.enabled)
      .map((rule) => {
        const candidates: RuleCandidate[] = files.map((file) => ({
          relativePath: file.relativePath ?? file.name,
          name: file.name,
          sizeBytes: metadata.get(file.path)?.sizeBytes,
          modifiedMs: metadata.get(file.path)?.modifiedMs,
        }));

        const matchedFiles = files.filter((_, index) =>
          filterByRule(rule, [candidates[index]], now).length > 0
        );

        const invalid = validateRule(rule);
        return {
          id: rule.id,
          title: rule.name,
          items: matchedFiles.map((file): SectionItem => ({ kind: 'file' as const, file })),
          hint:
            invalid.length > 0
              ? `Rule needs attention: ${invalid[0]}`
              : describeRule(rule),
          rules: [rule],
        };
      });

    return [
      {
        id: 'smart',
        title: 'Smart groups',
        groups: groups.map((group) => ({
          id: group.id,
          title: group.title,
          items: group.items,
          hint: group.hint,
        })),
        hint: groups.length ? undefined : 'Add a smart group to auto-collect files by pattern.',
      },
    ];
  }

  /** Reads sizes and modification times once per distinct file. */
  private async collectMetadata(files: FileRef[]): Promise<Map<string, { sizeBytes: number; modifiedMs: number }>> {
    const metadata = new Map<string, { sizeBytes: number; modifiedMs: number }>();
    const statFile =
      this.options.statFile ??
      (async (path: string) => {
        const stats = await fs.stat(path).catch(() => undefined);
        return stats ? { sizeBytes: stats.size, modifiedMs: stats.mtimeMs } : undefined;
      });

    // Bounded parallelism: a rule with a size filter needs metadata for every
    // candidate, but we should not open thousands of descriptors at once.
    const queue = [...files];
    const workers = Array.from({ length: Math.min(16, queue.length) }, async () => {
      for (;;) {
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
}
