import { describe, expect, it } from 'vitest';
import { newCell, type Cell } from '../src/cell.ts';
import { defaultMachine, machinesFor } from '../src/data/machines.ts';
import { staticData } from '../src/data/index.ts';
import { netRates, NO_EFFECTS, speedOf } from '../src/flow.ts';
import {
  dumbSolver,
  noteFor,
  solveCell,
  type Solution,
  type SolveRow,
  type Solver,
} from '../src/solve/index.ts';
import type { ResourceId } from '../src/types.ts';

const X = 'item:x' as ResourceId;
const Y = 'item:y' as ResourceId;
const Z = 'item:z' as ResourceId;

/** A row from bare rates, so the arithmetic can be read off the test. */
const row = (rates: Partial<Record<ResourceId, number>>, count?: number): SolveRow => ({
  rates: new Map(Object.entries(rates) as [ResourceId, number][]),
  count,
});

const solve = (...rows: SolveRow[]) => dumbSolver.solve(rows);

describe('Solver interface', () => {
  it('receives resolved rows from solveCell and returns its solution unchanged', () => {
    let received: SolveRow[] = [];
    const expected: Solution = {
      counts: [7],
      rates: [],
      inputRates: [],
      outputRates: [],
      balance: new Map(),
      complete: true,
      notes: [],
    };
    const solver: Solver = {
      id: 'recording',
      human: 'Recording',
      about: 'Records the rows it receives.',
      solve(rows) {
        received = rows;
        return expected;
      },
    };

    const answer = solveCell(
      { entries: [{ recipe: 'iron-plate', count: 3 }] },
      0,
      undefined,
      solver,
    );

    expect(answer).toBe(expected);
    expect(received).toHaveLength(1);
    expect(received[0]?.count).toBe(3);
    expect([...received[0]!.rates.values()]).toEqual(expect.arrayContaining([expect.any(Number)]));
    expect([...received[0]!.rates.values()].some((rate) => rate > 0)).toBe(true);
    expect([...received[0]!.rates.values()].some((rate) => rate < 0)).toBe(true);
  });
});

describe('dumbSolver', () => {
  it('has nothing to say about an empty cell', () => {
    const answer = solve();
    expect(answer.counts).toEqual([]);
    expect(answer.complete).toBe(true);
    expect(answer.notes).toEqual([]);
  });

  it('scales a consumer to eat what a pinned producer makes', () => {
    const answer = solve(row({ [X]: 2 }, 3), row({ [X]: -1, [Y]: 1 }));
    expect(answer.counts).toEqual([3, 6]);
    expect(answer.balance.get(X)).toBe(0);
    expect(answer.balance.get(Y)).toBe(6);
    expect(answer.complete).toBe(true);
  });

  /* The FACTORIO.md example's shape: the pinned row is the *last* one, and the count of the row
   * feeding it follows from what it is short of. */
  it('scales a producer to feed what a pinned consumer needs', () => {
    const answer = solve(row({ [X]: 2 }), row({ [X]: -12 }, 5));
    expect(answer.counts).toEqual([30, 5]);
    expect(answer.balance.get(X)).toBe(0);
  });

  it('assumes one of the top row when nothing is pinned', () => {
    const answer = solve(row({ [X]: 2 }), row({ [X]: -1 }));
    expect(answer.counts).toEqual([1, 2]);
    expect(answer.notes).toEqual([{ kind: 'seeded', entry: 0 }]);
  });

  it('leaves a pinned count alone even where it does not balance', () => {
    const answer = solve(row({ [X]: 2 }, 1), row({ [X]: -1 }, 1));
    expect(answer.counts).toEqual([1, 1]);
    expect(answer.balance.get(X)).toBe(1);
    expect(answer.notes).toEqual([]);
  });

  it('walks a three-row chain in whichever order the rows are in', () => {
    const forwards = solve(row({ [X]: 4 }, 1), row({ [X]: -2, [Y]: 1 }), row({ [Y]: -1, [Z]: 3 }));
    expect(forwards.counts).toEqual([1, 2, 2]);
    const backwards = solve(row({ [Y]: -1, [Z]: 3 }), row({ [X]: -2, [Y]: 1 }), row({ [X]: 4 }, 1));
    expect(backwards.counts).toEqual([2, 2, 1]);
  });

  it('scales to the hungriest of two demands, and says what it left unbalanced', () => {
    const answer = solve(row({ [X]: 2, [Y]: 2 }, 1), row({ [X]: -1, [Y]: -2 }));
    expect(answer.counts).toEqual([1, 2]);
    expect(answer.balance.get(X)).toBe(0);
    expect(answer.balance.get(Y)).toBe(-2);
    expect(answer.notes).toEqual([{ kind: 'conflict', entry: 1, resource: Y, needed: 1, used: 2 }]);
  });

  it('will not pick between two rows which could both take the slack', () => {
    const answer = solve(row({ [X]: 2 }, 1), row({ [X]: -1 }), row({ [X]: -1 }));
    expect(answer.counts).toEqual([1, undefined, undefined]);
    expect(answer.complete).toBe(false);
    expect(answer.notes).toEqual([
      { kind: 'contested', entry: 1, resource: X },
      { kind: 'contested', entry: 2, resource: X },
    ]);
    /* The rates it does know are still worth having: the surplus is real until one is pinned. */
    expect(answer.balance.get(X)).toBe(2);
  });

  it('solves the rest of a cell around a contested pair', () => {
    const answer = solve(
      row({ [X]: 2, [Z]: -1 }, 1),
      row({ [X]: -1 }),
      row({ [X]: -1 }),
      row({ [Z]: 4 }),
    );
    expect(answer.counts).toEqual([1, undefined, undefined, 0.25]);
  });

  it('says so when nothing connects a row to the rest', () => {
    const answer = solve(row({ [X]: 2 }, 1), row({ [Y]: -1, [Z]: 1 }));
    expect(answer.counts).toEqual([1, undefined]);
    expect(answer.notes).toEqual([{ kind: 'stranded', entry: 1 }]);
  });

  /* Not a claim that cycles are handled — the loop just happens to close when the ratios agree. */
  it('closes a two-row loop whose ratios happen to agree', () => {
    const answer = solve(row({ [X]: -1, [Y]: 1 }, 1), row({ [Y]: -1, [X]: 1 }));
    expect(answer.counts).toEqual([1, 1]);
    expect(answer.balance.get(X)).toBe(0);
  });

  it('gives up on a loop which does not, rather than spinning', () => {
    const answer = solve(row({ [X]: -1, [Y]: 2 }, 1), row({ [Y]: -1, [X]: 1 }));
    expect(answer.counts).toEqual([1, 2]);
    expect(noteFor(answer, 1)).toEqual({
      kind: 'conflict',
      entry: 1,
      resource: X,
      needed: 1,
      used: 2,
    });
    expect(answer.balance.get(X)).toBe(1);
  });
});

describe('solveCell', () => {
  const plate = staticData.recipes['iron-plate'];
  const gears = staticData.recipes['iron-gear-wheel'];

  /** What one machine of a recipe does, at the machine an unpinned row resolves to. */
  const rateOf = (recipe: typeof plate, resource: ResourceId) => {
    const machines = machinesFor(recipe);
    const speed = speedOf(machines, defaultMachine(machines, 0)?.id);
    return netRates(recipe, speed, NO_EFFECTS).get(resource)!;
  };

  it('takes one of a lone recipe, and quotes its edges', () => {
    const answer = solveCell(newCell('iron-plate'), 0);
    expect(answer.counts).toEqual([1]);
    expect(answer.balance.get('item:iron-plate')).toBeCloseTo(rateOf(plate, 'item:iron-plate'), 9);
  });

  it('scales the next recipe along to what the first one makes', () => {
    const cell: Cell = {
      entries: [{ recipe: 'iron-plate', count: 3 }, { recipe: 'iron-gear-wheel' }],
    };
    const answer = solveCell(cell, 0);
    const made = 3 * rateOf(plate, 'item:iron-plate');
    const used = -rateOf(gears, 'item:iron-plate');
    expect(answer.counts[1]).toBeCloseTo(made / used, 9);
    expect(answer.balance.get('item:iron-plate')).toBe(0);
    expect(answer.complete).toBe(true);
  });

  it('makes replacement saws for the expected loss from wood sawing', () => {
    const answer = solveCell(
      {
        entries: [{ recipe: 'angels-wood-sawing-1', count: 1 }, { recipe: 'angels-solid-saw' }],
      },
      0,
    );

    expect(answer.counts[1]).toBeGreaterThan(0);
    expect(answer.balance.get('item:angels-solid-saw')).toBe(0);
    expect(answer.inputRates[0]!.get('item:angels-solid-saw')).toBeGreaterThan(0);
    expect(answer.outputRates[0]!.get('item:angels-solid-saw')).toBeGreaterThan(0);
  });

  /** The gear row, in a machine which has slots, so the loadout has somewhere to go. */
  const gearRow = (modules?: Record<string, number>) => ({
    recipe: 'iron-gear-wheel',
    machine: 'assembling-machine-3',
    modules,
  });

  it('runs a row at the rates its modules give it', () => {
    // three productivity module 3s: 1.36 gears where there was one, at 0.55× the crafts
    const bare = solveCell({ entries: [{ ...gearRow(), count: 1 }] }, 0).balance;
    const modded = solveCell(
      { entries: [{ ...gearRow({ 'productivity-module-3': 3 }), count: 1 }] },
      0,
    ).balance;
    expect(modded.get('item:iron-plate')).toBeCloseTo(bare.get('item:iron-plate')! * 0.55, 9);
    expect(modded.get('item:iron-gear-wheel')).toBeCloseTo(
      bare.get('item:iron-gear-wheel')! * 0.55 * 1.36,
      9,
    );
    // which is the point of them: more gears out of the same two plates
    expect(modded.get('item:iron-gear-wheel')! / -modded.get('item:iron-plate')!).toBeCloseTo(
      1.36 / 2,
      9,
    );
  });

  it('counts the machines the modules make necessary', () => {
    const against = (modules?: Record<string, number>) =>
      solveCell({ entries: [{ recipe: 'iron-plate', count: 3 }, gearRow(modules)] }, 0).counts[1]!;
    // the same plates to eat, and each assembler now eats them at 0.55×: more assemblers
    expect(against({ 'productivity-module-3': 3 })).toBeCloseTo(against() / 0.55, 9);
  });

  it('strands a recipe the data no longer has', () => {
    const cell: Cell = {
      entries: [{ recipe: 'iron-plate', count: 1 }, { recipe: 'no-such-recipe' }],
    };
    expect(solveCell(cell, 0).notes).toEqual([
      { kind: 'stranded', entry: 1 },
      {
        kind: 'solver',
        entry: 0,
        detail: 'The matrix solver returned an error, so the dumb solver was used instead.',
      },
    ]);
  });
});
