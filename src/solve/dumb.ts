import type { ResourceId } from '../types.ts';
import type { Solution, SolveNote, SolveRow, Solver } from './index.ts';

/** Rates below this are float noise rather than a flow worth chasing. */
const EPS = 1e-9;

/** Demand propagation: scale one row at a time from whatever is unbalanced. */
export const dumbSolver: Solver = {
  id: 'dumb',
  human: 'Dumb',
  about: 'Scales one row at a time from whatever is unbalanced. No cycles.',
  solve: solveDumb,
};

type Proposal = {
  resource: ResourceId;
  count: number;
  /** Whether it is filling a shortfall rather than eating a surplus; see {@link pickRow}. */
  pull: boolean;
};

function solveDumb(rows: SolveRow[]): Solution {
  const counts = rows.map((row) => row.count);
  const notes: SolveNote[] = [];

  if (rows.length > 0 && !counts.some((count) => count !== undefined)) {
    counts[0] = 1;
    notes.push({ kind: 'seeded', entry: 0 });
  }

  let contested = new Map<number, ResourceId>();
  for (let pass = 0; pass < rows.length; pass++) {
    const balance = balanceOf(rows, counts);
    const open = rows.map((row, i) => (counts[i] === undefined ? proposalsFor(row, balance) : []));

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
    rates: rows.map((row) => row.rates),
    inputRates: rows.map(inputRates),
    outputRates: rows.map(outputRates),
    balance: scrub(balanceOf(rows, counts)),
    complete: counts.every((count) => count !== undefined),
    notes: notes.sort((a, b) => a.entry - b.entry),
  };
}

function inputRates(row: SolveRow): Map<ResourceId, number> {
  return (
    row.inputs ??
    new Map(
      [...row.rates].filter(([, rate]) => rate < 0).map(([resource, rate]) => [resource, -rate]),
    )
  );
}

function outputRates(row: SolveRow): Map<ResourceId, number> {
  return row.outputs ?? new Map([...row.rates].filter(([, rate]) => rate > 0));
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

function pickRow(usable: Proposal[][]): number | undefined {
  const pulls = usable.findIndex((list) => list.some(({ pull }) => pull));
  if (pulls !== -1) return pulls;
  const any = usable.findIndex((list) => list.length > 0);
  return any === -1 ? undefined : any;
}

function contestedBy(open: Proposal[][], takers: Map<ResourceId, number>): Map<number, ResourceId> {
  const out = new Map<number, ResourceId>();
  open.forEach((list, i) => {
    const clash = list.find(({ resource }) => (takers.get(resource) ?? 0) > 1);
    if (clash) out.set(i, clash.resource);
  });
  return out;
}

function scrub(balance: Map<ResourceId, number>): Map<ResourceId, number> {
  for (const [resource, rate] of balance) {
    if (Math.abs(rate) < EPS) balance.set(resource, 0);
  }
  return balance;
}
