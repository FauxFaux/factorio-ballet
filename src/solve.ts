import { entryEffects, entryMachine, entryRecipe, type Cell, type CellEntry } from './cell.ts';
import { machinesFor, recipeName, resourceName } from './data.ts';
import { netRates, speedOf } from './flow.ts';
import { fmt } from './ts.ts';
import type { ResourceId } from './types.ts';

/**
 * How many machines of each recipe a cell needs, worked out from the ones the user pinned.
 *
 * A cell is a handful of rows, one of which the user has usually typed a number into: "fifteen
 * steel furnaces", from which the coke plants feeding them follow. That is all this has to do, and
 * the answer is worth having even when it is incomplete — a row nobody could work out stays `auto`,
 * and whatever did not balance is in {@link Solution.balance} as a rate on the cell's edge. So
 * every failure here is partial, reportable, and named in a {@link SolveNote} rather than thrown.
 */
export interface Solution {
  /** Machines per row, index-parallel with `Cell.entries`; `undefined` where it could not be. */
  counts: (number | undefined)[];
  /**
   * Net rate per second across the rows which do have a count: positive leaves the cell, negative
   * has to be fed in, and ~0 is a resource the cell balances itself. Partial while `complete` is
   * false, because the rows without a count contribute nothing to it.
   */
  balance: Map<ResourceId, number>;
  /** Whether every row got a count. */
  complete: boolean;
  /** What the solver assumed, and everywhere it gave up; see {@link noteText}. */
  notes: SolveNote[];
}

/**
 * Something the user needs to know about their cell, always against the row it happened to. These
 * are the whole of the failure story: an unsolved cell should be readable as "here is what I
 * assumed, here is what I could not work out, here is what you could type to fix it".
 */
export type SolveNote =
  /** Nothing was pinned, so the first row was taken to be one machine. */
  | { kind: 'seeded'; entry: number }
  /** This row and another could both take up the slack on `resource`, so neither was scaled. */
  | { kind: 'contested'; entry: number; resource: ResourceId }
  /** This row's own flows disagreed on how many machines; the larger won, leaving `resource` over. */
  | { kind: 'conflict'; entry: number; resource: ResourceId; needed: number; used: number }
  /** Nothing in the rest of the cell said anything about how many of these there should be. */
  | { kind: 'stranded'; entry: number };

/** One row of a cell, reduced to the only thing the arithmetic cares about. */
export interface SolveRow {
  /** Net rates per second for a single machine, modules and all; {@link netRates}. */
  rates: Map<ResourceId, number>;
  /** Pinned by the user. A solver must never change one: it is the question, not the answer. */
  count?: number;
}

/**
 * A way of turning pinned rows into counts. There is one today; the interface exists because there
 * will be more — the linear-algebra solver this repo used to carry handles the cycles this one
 * cannot, and a cell wants to say which of them answered it.
 */
export interface Solver {
  id: string;
  human: string;
  /** One line on what it can and cannot do, for whatever ends up choosing between them. */
  about: string;
  solve(rows: SolveRow[]): Solution;
}

/** Rates below this are float noise rather than a flow worth chasing. */
const EPS = 1e-9;

/**
 * Demand propagation, and nothing cleverer: take the rows whose count is known, look at what that
 * leaves unbalanced, and scale one row which can absorb it. Repeat until nothing moves.
 *
 * It solves a chain, which is what a cell usually is, and it is honest about the three things it
 * cannot do: a cycle runs out of rows to scale, two rows which could both absorb the same resource
 * are left alone rather than picked between, and a row pulled two ways is scaled to the larger and
 * says so. It will not answer a question it cannot answer.
 */
export const dumbSolver: Solver = {
  id: 'dumb',
  human: 'Dumb',
  about: 'Scales one row at a time from whatever is unbalanced. No cycles.',
  solve: solveDumb,
};

export const SOLVERS: Solver[] = [dumbSolver];

export const defaultSolver = dumbSolver;

/**
 * The cell's rows, at the machines they are running in and with whatever is in their slots, handed
 * to a solver. The machine is `entryMachine`'s, so an unpinned one moves with the progress slider —
 * and so, therefore, do the modules' effects and the whole answer.
 */
export function solveCell(cell: Cell, progress: number, solver: Solver = defaultSolver): Solution {
  return solver.solve(cell.entries.map((entry) => rowOf(entry, progress)));
}

function rowOf(entry: CellEntry, progress: number): SolveRow {
  const recipe = entryRecipe(entry);
  /* A recipe the data no longer has: no rates, so it strands, which is the truth about it. */
  if (!recipe) return { rates: new Map(), count: entry.count };
  const machine = entryMachine(entry, recipe, progress);
  const speed = speedOf(machinesFor(recipe), machine);
  return {
    rates: netRates(recipe, speed, entryEffects(entry, recipe, machine)),
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
  }
}

/** `noteText` with the row's recipe in front of it, for a list away from the row itself. */
export function noteLine(cell: Cell, note: SolveNote): string {
  const entry = cell.entries[note.entry];
  return `${entry ? recipeName(entry.recipe) : '?'}: ${noteText(note)}`;
}

/** What one row would do to the cell's balance, per machine, if it ran `count` of them. */
type Proposal = {
  resource: ResourceId;
  count: number;
  /** Whether it is filling a shortfall rather than eating a surplus; see {@link pickRow}. */
  pull: boolean;
};

function solveDumb(rows: SolveRow[]): Solution {
  const counts = rows.map((row) => row.count);
  const notes: SolveNote[] = [];

  /* Nothing pinned means no question has been asked, so ask the obvious one: the top row is the
   * recipe the cell was started from, and one of it is a scale the rest can be read against. */
  if (rows.length > 0 && !counts.some((count) => count !== undefined)) {
    counts[0] = 1;
    notes.push({ kind: 'seeded', entry: 0 });
  }

  /** Which resource a row was passed over for, kept for the report if it is never solved at all. */
  let contested = new Map<number, ResourceId>();

  /* One row per pass, against a freshly totalled balance: solving two rows off the same snapshot
   * would scale the second one as though the first were not there. So `rows.length` passes is not
   * a "couple of tries and give up", it is exactly enough for a chain in the worst order. */
  for (let pass = 0; pass < rows.length; pass++) {
    const balance = balanceOf(rows, counts);
    const open = rows.map((row, i) => (counts[i] === undefined ? proposalsFor(row, balance) : []));

    /* A resource two rows could both absorb says nothing about either of them. Dropping it from
     * both is what stops the answer depending on the order the recipes were added in. */
    const takers = new Map<ResourceId, number>();
    for (const list of open) {
      for (const { resource } of list) takers.set(resource, (takers.get(resource) ?? 0) + 1);
    }
    const usable = open.map((list) => list.filter(({ resource }) => takers.get(resource) === 1));

    const row = pickRow(usable);
    if (row === undefined) {
      contested = contestedBy(open, takers);
      break;
    }

    const proposals = usable[row];
    const most = proposals.reduce((a, b) => (b.count > a.count ? b : a));
    const least = proposals.reduce((a, b) => (b.count < a.count ? b : a));
    counts[row] = most.count;
    /* Pulled two ways: run enough to satisfy the hungriest, and leave the rest of it spare, which
     * is the reading a factory gives you anyway. The surplus is in `balance` as well as here. */
    if (least.count < most.count - EPS) {
      notes.push({
        kind: 'conflict',
        entry: row,
        resource: least.resource,
        needed: least.count,
        used: most.count,
      });
    }
  }

  for (let i = 0; i < rows.length; i++) {
    if (counts[i] !== undefined) continue;
    const resource = contested.get(i);
    notes.push(
      resource ? { kind: 'contested', entry: i, resource } : { kind: 'stranded', entry: i },
    );
  }

  return {
    counts,
    balance: scrub(balanceOf(rows, counts)),
    complete: counts.every((count) => count !== undefined),
    notes: notes.sort((a, b) => a.entry - b.entry),
  };
}

function balanceOf(rows: SolveRow[], counts: (number | undefined)[]): Map<ResourceId, number> {
  const balance = new Map<ResourceId, number>();
  rows.forEach((row, i) => {
    const count = counts[i];
    if (count === undefined) return;
    for (const [resource, rate] of row.rates) {
      balance.set(resource, (balance.get(resource) ?? 0) + rate * count);
    }
  });
  return balance;
}

/**
 * How many of this row each currently unbalanced resource would ask for. A row only has something
 * to say about a resource it is on the *other* side of: one which makes what the cell is short of,
 * or uses what the cell has spare. A row on the same side would only make the imbalance worse.
 */
function proposalsFor(row: SolveRow, balance: Map<ResourceId, number>): Proposal[] {
  const out: Proposal[] = [];
  for (const [resource, rate] of row.rates) {
    const net = balance.get(resource) ?? 0;
    if (Math.abs(net) < EPS || Math.abs(rate) < EPS) continue;
    if (net > 0 === rate > 0) continue;
    out.push({ resource, count: -net / rate, pull: net < 0 });
  }
  return out;
}

/**
 * Which row to scale next: one filling a shortfall before one eating a surplus, then top-down.
 * Demand is the direction a factory is planned in — "fifteen furnaces, so how much coke" — and
 * following it first means the numbers appear in the order the user would have worked them out.
 */
function pickRow(usable: Proposal[][]): number | undefined {
  const pulls = usable.findIndex((list) => list.some(({ pull }) => pull));
  if (pulls !== -1) return pulls;
  const any = usable.findIndex((list) => list.length > 0);
  return any === -1 ? undefined : any;
}

/** For each row which had only contested proposals left, the resource it was contested on. */
function contestedBy(open: Proposal[][], takers: Map<ResourceId, number>): Map<number, ResourceId> {
  const out = new Map<number, ResourceId>();
  open.forEach((list, i) => {
    const clash = list.find(({ resource }) => (takers.get(resource) ?? 0) > 1);
    if (clash) out.set(i, clash.resource);
  });
  return out;
}

/** Float dust reads as an unbalanced cell; a resource which came out level should say zero. */
function scrub(balance: Map<ResourceId, number>): Map<ResourceId, number> {
  for (const [resource, rate] of balance) {
    if (Math.abs(rate) < EPS) balance.set(resource, 0);
  }
  return balance;
}
