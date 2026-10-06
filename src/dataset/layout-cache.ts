import type { AssemblerDesignThroughput } from '../compute/assembler-design.ts';
import type { KernelProblem } from '../compute/kernel-problems.ts';
import { searchKernelLayouts, type KernelLayoutSearch } from '../compute/kernel-layout-options.ts';

export interface LayoutRequest {
  problem: KernelProblem;
  throughput: AssemblerDesignThroughput;
  undergroundBeltReach: number;
}

export type LayoutSearchState =
  | { status: 'pending' }
  | { status: 'ready'; result: KernelLayoutSearch }
  | { status: 'error'; reason: string };

interface CachedSearch {
  state: LayoutSearchState;
  listeners: Set<() => void>;
  search?: Generator<void, KernelLayoutSearch>;
}

/** Object ordering and newly allocated rate maps must not invalidate equivalent inputs. */
export function layoutRequestKey(request: LayoutRequest): string {
  return JSON.stringify(request, (_key, value: unknown) => {
    if (typeof value === 'number' && !Number.isFinite(value)) return { number: String(value) };
    if (value && typeof value === 'object' && !Array.isArray(value))
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
    return value;
  });
}

/** One task per solver call, round-robin across subscribed recipes. No search runs in render. */
export class LayoutCache {
  private readonly entries = new Map<string, CachedSearch>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  private readonly limit: number;

  constructor(limit = 128) {
    this.limit = limit;
  }

  read(key: string): LayoutSearchState | undefined {
    return this.entries.get(key)?.state;
  }

  subscribe(key: string, request: LayoutRequest, listener: () => void): () => void {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        state: { status: 'pending' },
        listeners: new Set(),
        search: searchKernelLayouts(
          request.problem,
          request.throughput,
          request.undergroundBeltReach,
        ),
      };
    }
    // Touch on subscription for least-recently-used eviction.
    this.entries.delete(key);
    this.entries.set(key, entry);
    entry.listeners.add(listener);
    this.schedule();
    return () => {
      entry.listeners.delete(listener);
      // Defer cancellation to the next task so effect resubscriptions reuse pending work.
      this.prune();
    };
  }

  private schedule() {
    if (this.timer !== undefined) return;
    if (![...this.entries.values()].some((entry) => entry.search)) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      for (const [key, entry] of this.entries) {
        if (entry.search && entry.listeners.size === 0) this.entries.delete(key);
      }
      const next = [...this.entries].find(([, entry]) => entry.search);
      if (!next) return;
      const [key, entry] = next;
      try {
        const step = entry.search!.next();
        if (step.done) {
          entry.search = undefined;
          entry.state = { status: 'ready', result: step.value };
        }
      } catch (error) {
        entry.search = undefined;
        entry.state = {
          status: 'error',
          reason: error instanceof Error ? error.message : String(error),
        };
      }
      this.entries.delete(key);
      this.entries.set(key, entry);
      if (entry.state.status !== 'pending') {
        for (const listener of entry.listeners) listener();
      }
      this.prune();
      this.schedule();
    }, 0);
  }

  private prune() {
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= this.limit) break;
      if (entry.listeners.size === 0 && !entry.search) this.entries.delete(key);
    }
  }
}
