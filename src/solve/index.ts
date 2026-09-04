import { entryEffects, entryMachine, entryRecipe, type Cell, type CellEntry } from '../cell.ts';
import { machinesFor } from '../data/machines.ts';
import { NO_CHOICE, recipeName, resourceName, type Chosen } from '../data/index.ts';
import { directionalRates, netRates, speedOf } from '../flow.ts';
import { fmt } from '../ts.ts';
import type { ResourceId } from '../types.ts';
import { dumbSolver } from './dumb.ts';
import { matrixSolver } from './matrix.ts';

/** How many machines of each recipe a cell needs, worked out from the ones the user pinned. */
export interface Solution {
  /** Machines per row, index-parallel with `Cell.entries`; `undefined` where it could not be. */
  counts: (number | undefined)[];
  /** Net rates for one machine in each row, index-parallel with `counts`. */
  rates: Map<ResourceId, number>[];
  /** Net rate per second across the rows which do have a count. */
  balance: Map<ResourceId, number>;
  /** Gross ingredient rates per second per machine, before returned resources are netted. */
  inputRates: Map<ResourceId, number>[];
  /** Gross product rates per second per machine, before returned resources are netted. */
  outputRates: Map<ResourceId, number>[];
  /** Whether every row got a count. */
  complete: boolean;
  /** What the solver assumed, and everywhere it gave up; see {@link noteText}. */
  notes: SolveNote[];
}

/** Something the user needs to know about their cell, against the row it happened to. */
export type SolveNote =
  | { kind: 'seeded'; entry: number }
  | { kind: 'contested'; entry: number; resource: ResourceId }
  | { kind: 'conflict'; entry: number; resource: ResourceId; needed: number; used: number }
  | { kind: 'stranded'; entry: number }
  | { kind: 'solver'; entry: number; detail: string };

/** One row of a cell, reduced to the only thing the arithmetic cares about. */
export interface SolveRow {
  /** Net rates per second for a single machine, modules and all; {@link netRates}. */
  rates: Map<ResourceId, number>;
  /** Gross ingredient rates, when the row came from a recipe rather than a solver unit test. */
  inputs?: Map<ResourceId, number>;
  /** Gross product rates, when the row came from a recipe rather than a solver unit test. */
  outputs?: Map<ResourceId, number>;
  /** Pinned by the user. A solver must never change one: it is the question, not the answer. */
  count?: number;
}

/** A named implementation which turns pinned rows into counts. */
export interface Solver {
  id: string;
  human: string;
  /** One line on what it can and cannot do, for whatever ends up choosing between them. */
  about: string;
  solve(rows: SolveRow[]): Solution;
}

export { dumbSolver, matrixSolver };

export const SOLVERS: Solver[] = [matrixSolver, dumbSolver];

/** The simultaneous, cycle-capable solver is the application default. */
export const defaultSolver: Solver = matrixSolver;

/** Resolve a cell to data-independent rows and hand them to the selected solver. */
export function solveCell(
  cell: Cell,
  progress: number,
  chosen: Chosen = NO_CHOICE,
  solver: Solver = defaultSolver,
): Solution {
  return solver.solve(cell.entries.map((entry) => rowOf(entry, progress, chosen)));
}

function rowOf(entry: CellEntry, progress: number, chosen: Chosen): SolveRow {
  const recipe = entryRecipe(entry);
  /* A recipe the data no longer has: no rates, so it strands, which is the truth about it. */
  if (!recipe) return { rates: new Map(), count: entry.count };
  const machine = entryMachine(entry, recipe, progress);
  const speed = speedOf(machinesFor(recipe), machine);
  const effects = entryEffects(entry, recipe, machine, chosen);
  return {
    rates: netRates(recipe, speed, effects),
    ...directionalRates(recipe, speed, effects),
    count: entry.count,
  };
}

/** The first thing the solver had to say about a row, if it had anything. */
export function noteFor(solution: Solution, entry: number): SolveNote | undefined {
  return solution.notes.find((note) => note.entry === entry);
}

/** Whether a note is a problem, as against something the solver merely assumed. */
export function isProblem(note: SolveNote): boolean {
  return note.kind !== 'seeded';
}

/** A note as a sentence, ending in what the user can type to resolve it. */
export function noteText(note: SolveNote): string {
  switch (note.kind) {
    case 'seeded':
      return 'Nothing was pinned, so this is taken to be one machine; type a count on any row to scale the cell against it instead.';
    case 'contested':
      return `This and another row could both balance ${resourceName(note.resource)}, and picking between them is not the solver's call: type a count on one of them.`;
    case 'conflict':
      return `${fmt(note.needed)} would balance ${resourceName(note.resource)}, but ${fmt(note.used)} is needed elsewhere, so ${resourceName(note.resource)} is left over.`;
    case 'stranded':
      return 'Nothing in the rest of the cell settles how many of these there are: type a count, or add the recipe on the other end of one of its resources.';
    case 'solver':
      return note.detail;
  }
}

/** `noteText` with the row's recipe in front of it, for a list away from the row itself. */
export function noteLine(cell: Cell, note: SolveNote): string {
  const entry = cell.entries[note.entry];
  return `${entry ? recipeName(entry.recipe) : '?'}: ${noteText(note)}`;
}
