import { Frontier } from './path-search-frontier.ts';
import type { PathSearchResult } from './path-search.ts';

export interface RelaxedPathResult {
  path: PathSearchResult;
  /** Two incompatible atomic moves: every valid route must omit at least one. */
  conflict?: [number, number];
}

/**
 * Resolve placement conflicts without putting the entire route history in each A* state.
 * Each node excludes atomic moves and obtains a relaxed optimum. A collision creates two
 * exhaustive branches, excluding either move. Pop nodes in objective order so the first
 * collision-free route is optimal, including the steps, turns, and tunnel-count tie-breaks.
 * The low-level searches share the caller's expansion budget, including failed branches.
 */
export function resolvePathSelfConflicts(
  search: (forbidden: ReadonlySet<number>) => RelaxedPathResult,
): PathSearchResult {
  interface Node {
    forbidden: number[];
    path: Extract<PathSearchResult, { kind: 'found' }>;
    conflict?: [number, number];
  }
  const nodes: Node[] = [];
  const frontier = new Frontier();
  const seen = new Set<string>();
  const enqueue = (forbidden: number[]): PathSearchResult | undefined => {
    const key = forbidden.join(',');
    if (seen.has(key)) return;
    seen.add(key);
    const { path, conflict } = search(new Set(forbidden));
    if (path.kind === 'no-path') return;
    if (path.kind !== 'found') return path;
    const state = nodes.length;
    nodes.push({ forbidden, path, conflict });
    frontier.push({
      state,
      cost: path.cost,
      steps: path.steps,
      turns: path.turns,
      undergrounds: path.undergroundBelts?.length ?? 0,
      estimate: path.cost,
      estimatedSteps: path.steps,
    });
  };
  const failure = enqueue([]);
  if (failure) return failure;
  for (let entry = frontier.pop(); entry; entry = frontier.pop()) {
    const node = nodes[entry.state];
    if (!node.conflict) return node.path;
    for (const move of node.conflict) {
      const failure = enqueue([...node.forbidden, move].sort((a, b) => a - b));
      if (failure) return failure;
    }
  }
  return { kind: 'no-path' };
}
