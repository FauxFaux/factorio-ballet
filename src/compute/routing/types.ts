import type { PathCell, PathSearchGrid, PathSearchResult } from './path-search.ts';

export interface RoutingRequest {
  /** Stable, unique identity used for canonical ordering and result lookup. */
  id: string;
  start: PathCell;
  goal: PathCell;
}

export interface RoutingInput extends PathSearchGrid {
  routes: RoutingRequest[];
}

export interface RoutingOptions {
  /** Debug heat map strategy; absent uses the reservation/conflict solver. */
  strategy?: 'contention';
  /** Maximum hidden tiles between underground belt endpoints; absent disables tunnels. */
  undergroundBeltReach?: number;
  /** Try deterministic whole-path reservation before conflict search; enabled by default. */
  reservationFirst?: boolean;
  /** Shared A* expansion budget, independent of wall-clock time. */
  maxPathStates?: number;
  /** Maximum conflicting collections expanded by the global search. */
  maxNodes?: number;
  /** Work allowance for whole-path reservation passes before CBS; zero disables them. */
  maxReservationStates?: number;
  /** Prefer fewer overlaps among collections within this fraction of the cheapest cost. */
  costSlack?: number;
}

export interface RoutingConflict {
  first: string;
  second: string;
  cell: PathCell;
}

export interface RoutingDiagnostics {
  pathSearches: number;
  pathStates: number;
  expandedNodes: number;
  generatedNodes: number;
  /** Deterministic priority orders attempted before the conflict search, if supported. */
  reservationPasses?: number;
  /** Overlapping cell uses in the best provisional collection, when one was computed. */
  remainingConflicts?: number;
  conflict?: RoutingConflict;
}

export type RoutedPath = Extract<PathSearchResult, { kind: 'found' }> & { id: string };

/** Only found results contain paths: provisional overlapping collections are never solutions. */
export type RoutingResult =
  | {
      kind: 'contention';
      /** Row-major contested path counts (zero for cells used by fewer than two paths). */
      generations: Uint32Array[];
      maximum: Uint32Array;
      status: 'complete' | 'budget-exhausted';
      diagnostics: RoutingDiagnostics;
    }
  | {
      kind: 'found';
      routes: RoutedPath[];
      cost: number;
      steps: number;
      turns: number;
      diagnostics: RoutingDiagnostics;
    }
  | { kind: 'no-solution'; diagnostics: RoutingDiagnostics }
  | { kind: 'budget-exhausted'; diagnostics: RoutingDiagnostics }
  | { kind: 'invalid'; message: string };

/** Geometry/UI adapters depend on this contract, not a particular routing algorithm. */
export type RoutingSolver = (input: RoutingInput, options?: RoutingOptions) => RoutingResult;
