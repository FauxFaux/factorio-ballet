import type { Recipe, ResourceId } from '../types.ts';

/**
 * The solver problem: a fixed set of processes (recipes placed into the plan),
 * the net rates the user demands, and the items the solver may freely
 * source/sink. See `ALGORITHM.md` §1.
 */
export interface Problem {
  processes: ActiveProcess[];
  /** Net rates the user demands. Positive = produce, negative = consume. */
  requirements: Requirement[];
  /** Items the solver may freely import/export (each gets a slack column). */
  io: ResourceId[];
}

/**
 * A recipe placed into the plan. `multipliers`/`unmod` are the hooks for the
 * (not-yet-modelled) building/factory layer; they default to identity, so a
 * bare `{ id, recipe }` behaves as "one unmodified building". See `ALGORITHM.md`
 * §2 for what they will eventually mean (productivity, catalysts).
 */
export interface ActiveProcess {
  id: string;
  recipe: Recipe;
  multipliers?: Multipliers;
  /**
   * Resources whose rate is NOT affected by the input/output multipliers
   * (catalysts: consumed-and-produced items that productivity must skip).
   */
  unmod?: ResourceId[];
}

export interface Multipliers {
  /** Scales the recipe duration (slower/faster building). Default 1. */
  duration?: number;
  /** Scales modifiable ingredient amounts. Default 1. */
  inputs?: number;
  /** Scales modifiable product amounts (productivity bonus). Default 1. */
  outputs?: number;
}

/** A net rate the user pins for a resource. */
export interface Requirement {
  resource: ResourceId;
  amount: number;
}

/** Net throughput of one resource across the solved plan. */
export interface MaterialFlow {
  resource: ResourceId;
  /** Total consumed (≤ 0). */
  consumed: number;
  /** Total produced (≥ 0). */
  produced: number;
  /** consumed + produced. ~0 for a pure intermediate. */
  net: number;
}

export type Solution =
  | {
      ok: true;
      /** Building count per process id (continuous, e.g. 1.4). */
      counts: Record<string, number>;
      materials: MaterialFlow[];
    }
  | {
      ok: false;
      /**
       * `inconsistent`: requirements cannot be satisfied (a `[0…0 | c]` row).
       * `underdetermined`: a process column never became a pivot, so its count
       * is not uniquely determined (e.g. an item with no producer, or a loop
       * needing more I/O hints).
       */
      reason: 'inconsistent' | 'underdetermined';
      /** Human-readable explanation, e.g. the offending item or process id. */
      detail: string;
    };
