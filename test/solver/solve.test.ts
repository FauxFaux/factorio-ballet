import { describe, expect, it } from 'vitest';
import { staticData } from '../../src/data.ts';
import { getDefaultedItems, solve } from '../../src/solver/solve.ts';
import type { ActiveProcess, Solution } from '../../src/solver/types.ts';
import type { Ingredient, Product, ResourceId } from '../../src/types.ts';

// --- tiny fixture builders -------------------------------------------------

const prod = (resource: ResourceId, amount = 1, probability = 1): Product => ({
  resource,
  amount: { fixed: amount },
  probability,
});
const ing = (resource: ResourceId, amount: number): Ingredient => ({ resource, amount });
const proc = (
  id: string,
  ingredients: Ingredient[],
  products: Product[],
  duration = 1,
): ActiveProcess => ({ id, recipe: { ingredients, products, duration } });

type Solved = Extract<Solution, { ok: true }>;
const expectOk = (sol: Solution): Solved => {
  if (!sol.ok) throw new Error(`expected a solution, got ${sol.reason}: ${sol.detail}`);
  return sol;
};
const net = (sol: Solved, resource: ResourceId) =>
  sol.materials.find((m) => m.resource === resource)!;

// --- tests -----------------------------------------------------------------

describe('solve', () => {
  it('solves the ALGORITHM.md worked example', () => {
    const sol = expectOk(
      solve({
        processes: [
          proc('make_a', [ing('item:part_1', 5), ing('item:part_2', 2)], [prod('item:part_3', 5)]),
        ],
        requirements: [{ resource: 'item:part_3', amount: 7 }],
        io: ['item:part_1', 'item:part_2'],
      }),
    );
    expect(sol.counts.make_a).toBeCloseTo(1.4);
    expect(net(sol, 'item:part_3').net).toBeCloseTo(7);
    expect(net(sol, 'item:part_1').consumed).toBeCloseTo(-7); // 5 × 1.4
    expect(net(sol, 'item:part_2').consumed).toBeCloseTo(-2.8); // 2 × 1.4
  });

  it('balances a multi-step chain (FACTORIO.md iron → steel)', () => {
    // make_ingot: 4 iron-ore → 1 ingot / 2s ; make_steel: 2 ingot + 10 coke + 400 oxygen → 3 steel / 5s.
    const sol = expectOk(
      solve({
        processes: [
          proc('make_ingot', [ing('item:iron-ore', 4)], [prod('item:ingot', 1)], 2),
          proc(
            'make_steel',
            [ing('item:ingot', 2), ing('item:coke', 10), ing('fluid:oxygen', 400)],
            [prod('item:steel', 3)],
            5,
          ),
        ],
        requirements: [{ resource: 'item:steel', amount: 9 }],
        io: ['item:iron-ore', 'item:coke', 'fluid:oxygen'],
      }),
    );
    expect(sol.counts.make_steel).toBeCloseTo(15);
    expect(sol.counts.make_ingot).toBeCloseTo(12);
    expect(net(sol, 'item:ingot').net).toBeCloseTo(0); // intermediate, fully consumed
    expect(net(sol, 'item:coke').net).toBeCloseTo(-30);
  });

  it('resolves a self-consuming cycle (the "only really consumes 4 rock" effect)', () => {
    // 10 rock → 2 iron-ore + 6 rock. Rock is imported (and partly self-supplied).
    const sol = expectOk(
      solve({
        processes: [
          proc('grind', [ing('item:rock', 10)], [prod('item:iron-ore', 2), prod('item:rock', 6)]),
        ],
        requirements: [{ resource: 'item:iron-ore', amount: 2 }],
        io: ['item:rock'],
      }),
    );
    expect(sol.counts.grind).toBeCloseTo(1);
    const rock = net(sol, 'item:rock');
    expect(rock.consumed).toBeCloseTo(-10); // gross consumed
    expect(rock.produced).toBeCloseTo(6); // self-produced
    expect(rock.net).toBeCloseTo(-4); // net import: only really consumes 4
    expect(net(sol, 'item:iron-ore').net).toBeCloseTo(2);
  });

  it('auto-promotes a dangling raw input to I/O to keep the system square', () => {
    const problem = {
      processes: [proc('make_widget', [ing('item:raw', 2)], [prod('item:widget', 1)])],
      requirements: [{ resource: 'item:widget' as ResourceId, amount: 1 }],
      io: [] as ResourceId[],
    };
    expect(getDefaultedItems(problem)).toEqual(['item:raw']);

    const sol = expectOk(solve(problem));
    expect(sol.counts.make_widget).toBeCloseTo(1);
    expect(net(sol, 'item:raw').net).toBeCloseTo(-2); // imported via the defaulted slack
  });

  it('reports inconsistent when a requirement has no producer', () => {
    const sol = solve({
      processes: [],
      requirements: [{ resource: 'item:unobtainium', amount: 5 }],
      io: [],
    });
    expect(sol.ok).toBe(false);
    if (!sol.ok) expect(sol.reason).toBe('inconsistent');
  });

  it('reports underdetermined when two processes make the same item (free variable)', () => {
    const sol = solve({
      processes: [
        proc('make_a', [ing('item:raw', 1)], [prod('item:b', 1)]),
        proc('make_b', [ing('item:raw', 1)], [prod('item:b', 1)]),
      ],
      requirements: [{ resource: 'item:b', amount: 1 }],
      io: ['item:raw'],
    });
    expect(sol.ok).toBe(false);
    if (!sol.ok) expect(sol.reason).toBe('underdetermined');
  });

  it('solves a real two-recipe chain from static.json (steel-plate)', () => {
    const sol = expectOk(
      solve({
        processes: [
          { id: 'steel-plate', recipe: staticData.recipes['steel-plate'] },
          { id: 'iron-plate', recipe: staticData.recipes['iron-plate'] },
        ],
        requirements: [{ resource: 'item:steel-plate', amount: 2 }],
        io: ['fluid:angels-gas-oxygen', 'item:angels-ore1-crushed'],
      }),
    );
    expect(sol.counts['steel-plate']).toBeGreaterThan(0);
    expect(sol.counts['iron-plate']).toBeGreaterThan(0);
    expect(net(sol, 'item:steel-plate').net).toBeCloseTo(2);
    expect(net(sol, 'item:iron-plate').net).toBeCloseTo(0); // intermediate
  });
});
