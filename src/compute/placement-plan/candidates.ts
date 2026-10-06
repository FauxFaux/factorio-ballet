import type { FactoryModule } from '../modules.ts';
import { EPSILON, partitionWorkloads, type RecipePlacements } from './recipes.ts';

/** Unordered powers-of-two partitions, halving the largest block at each step.
 * Keep the odd singleton as a remainder; never expand twos into extra singletons. */
export function* powerSplits(buildings: number): Generator<number[]> {
  if (!Number.isInteger(buildings) || buildings < 1) return;
  const pieces: number[] = [];
  let remaining = buildings;
  while (remaining) {
    const size = 2 ** Math.floor(Math.log2(remaining));
    pieces.push(size);
    remaining -= size;
  }
  while (true) {
    pieces.sort((a, b) => b - a);
    yield [...pieces];
    const largest = pieces[0];
    if (largest <= 2) return;
    pieces.splice(0, 1, largest / 2, largest / 2);
  }
}

function balanced(buildings: number, placements: number): number[] {
  return Array.from(
    { length: placements },
    (_, i) => Math.floor(buildings / placements) + Number(i < buildings % placements),
  );
}

/** Build a supported partition without borrowing or rounding any extra buildings. */
function fromCounts(
  recipe: RecipePlacements,
  requested: readonly number[],
  mode: 'proportional' | 'first' | 'last',
): FactoryModule[] {
  const counts = requested.flatMap((count) => recipe.partition(count)!).sort((a, b) => b - a);
  let slack = recipe.installed - recipe.workload;
  const works = counts.map((count) => {
    if (mode === 'proportional') return (count * recipe.workload) / recipe.installed;
    const idle = Math.min(slack, count);
    slack -= idle;
    return count - idle;
  });
  if (mode === 'last') {
    slack = recipe.installed - recipe.workload;
    for (let i = counts.length - 1; i >= 0; i--) {
      const idle = Math.min(slack, counts[i]);
      works[i] = counts[i] - idle;
      slack -= idle;
    }
  }
  return counts.map((count, index) => recipe.build(count, works[index], index)!);
}

export function candidateKey(modules: readonly FactoryModule[]): string {
  return modules
    .map((module) => `${module.machineCount}:${module.workload!.toPrecision(12)}`)
    .join('/');
}

/** A deliberately small independent candidate set, ready for whole-cell enumeration. */
export function recipeCandidates(
  recipe: RecipePlacements,
  recipes: readonly RecipePlacements[],
  limit: number,
  maxPlacements: number,
): FactoryModule[][] {
  const candidates: FactoryModule[][] = [];
  const seen = new Set<string>();
  const add = (modules: FactoryModule[] | undefined) => {
    if (
      !modules ||
      modules.length > maxPlacements ||
      candidates.length >= limit ||
      modules.some((module) => module.workload! <= 0)
    )
      return;
    const key = candidateKey(modules);
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(modules);
    }
  };
  const base = recipe.partition(recipe.installed)!;
  const even = balanced(recipe.installed, recipe.minimum);
  add(fromCounts(recipe, base, 'proportional'));
  if (recipe.installed === 1) return candidates;
  add(fromCounts(recipe, even, 'proportional'));
  // These exact capacity boundaries let coordinated downstream changes survive shortlisting.
  add(fromCounts(recipe, base, 'first'));
  add(fromCounts(recipe, base, 'last'));
  if (recipe.installed === 1 || candidates.length >= limit) return candidates;

  // Seed whole neighborhoods, including repeated dedicated supplies and their remainder.
  for (const [resource, rate] of Object.entries({
    ...recipe.problem.outputs.solids,
    ...recipe.problem.outputs.fluids,
  })) {
    if (rate <= EPSILON) continue;
    for (const mode of ['base', 'balanced'] as const) {
      const targets = recipes
        .filter((other) => other !== recipe)
        .flatMap((other) => {
          const input =
            other.problem.inputs.solids[resource as `item:${string}`] ??
            other.problem.inputs.fluids[resource as `fluid:${string}`] ??
            0;
          const counts =
            mode === 'base'
              ? other.partition(other.installed)!
              : balanced(other.installed, other.minimum);
          return counts
            .map((count) => (input * other.workload * count) / other.installed / rate)
            .filter((amount) => amount > EPSILON);
        });
      if (
        targets.length > 1 &&
        Math.abs(targets.reduce((a, b) => a + b, 0) - recipe.workload) < EPSILON
      )
        add(partitionWorkloads(recipe, targets.slice(0, -1)));
      for (const target of targets) add(partitionWorkloads(recipe, [target]));
    }
  }
  for (const split of powerSplits(recipe.installed)) {
    if (split.length > maxPlacements || candidates.length >= limit) break;
    add(fromCounts(recipe, split, 'proportional'));
  }
  for (
    let count = recipe.minimum + 1;
    count <= Math.min(recipe.installed, maxPlacements);
    count++
  ) {
    if (candidates.length >= limit) break;
    add(fromCounts(recipe, balanced(recipe.installed, count), 'proportional'));
  }
  return candidates;
}
