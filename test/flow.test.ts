import { describe, expect, it } from 'vitest';
import {
  flowTitle,
  netRates,
  NO_EFFECTS,
  productAmount,
  rateDigits,
  recipeFlows,
  speedOf,
} from '../src/flow.ts';
import { machinesFor, type MachineMatch } from '../src/data/machines.ts';
import { staticData } from '../src/data/index.ts';

const gears = staticData.recipes['iron-gear-wheel'];
/** Three results, the rarest of them 0.0055% of a craft: the reason for the third decimal. */
const uranium = staticData.recipes['uranium-processing'];
/** A `0–3` result rolled half the time, and the same recipe carries a fluid with a temperature. */
const mud = staticData.recipes['angels-water-heavy-mud'];

describe('speedOf', () => {
  const machines = machinesFor(gears);

  it('is the machine speed, and 1× for no machine', () => {
    expect(speedOf(machines, undefined)).toBe(1);
    expect(speedOf(machines, 'assembling-machine-2')).toBe(
      machines.find(({ id }) => id === 'assembling-machine-2')?.machine.speed,
    );
  });

  it('falls back to 1× for a machine which cannot run the recipe', () => {
    expect(speedOf(machines, 'bob-electrolyser-1')).toBe(1);
  });
});

describe('recipeFlows', () => {
  it('quotes amounts per craft and rates per second', () => {
    const { ins, outs } = recipeFlows(gears, [], 1);
    // 2 plates a craft, half a second a craft: four a second in, two out
    expect(ins).toEqual([
      { resource: 'item:iron-plate', amount: '2', rate: '4.00', note: undefined },
    ]);
    expect(outs).toEqual([
      { resource: 'item:iron-gear-wheel', amount: '1', rate: '2.00', note: undefined },
    ]);
  });

  it('scales with the machine it is quoted at', () => {
    expect(recipeFlows(gears, [], 0.5).outs[0].rate).toBe('1.00');
    expect(recipeFlows(gears, [], 2).outs[0].rate).toBe('4.00');
  });

  it('reads a chancy result as what it is worth on average', () => {
    const { outs } = recipeFlows(uranium, [], 1);
    // one 235 per 143 crafts, 12s apiece, and the label says which
    expect(outs[0]).toEqual({
      resource: 'item:uranium-235',
      amount: '1',
      rate: '0.001',
      note: '0.7%',
    });
  });

  it('spells a range out, and averages it for the rate', () => {
    const { outs } = recipeFlows(mud, [], 1);
    expect(outs[1].amount).toBe('0–3');
    // (0 + 3) / 2 rolled half the time, over the recipe's duration
    expect(Number(outs[1].rate)).toBeCloseTo(0.75 / mud.duration, 6);
  });

  it('notes the temperature an ingredient is wanted at', () => {
    const { ins } = recipeFlows(staticData.recipes['fission-reactor-equipment'], [], 1);
    expect(ins.find(({ resource }) => resource.startsWith('fluid:'))?.note).toBe('≤30°C');
  });
});

describe('rateDigits', () => {
  it('is two decimals for a recipe whose flows are all readable there', () => {
    expect(rateDigits(gears, machinesFor(gears))).toBe(2);
  });

  it('is three when any flow would read as 0.00 on any machine it can run in', () => {
    expect(rateDigits(uranium, [])).toBe(3);
  });

  it('takes the slowest machine into account, not just the 1× baseline', () => {
    const slow: MachineMatch[] = [
      {
        id: 'snail',
        machine: { kind: 'assembling-machine', categories: ['crafting'], speed: 0.01 },
      },
    ];
    expect(rateDigits(gears, [])).toBe(2);
    expect(rateDigits(gears, slow)).toBe(3);
  });
});

/** One garden in, two out: the second is made, the first is handed straight back. */
const garden = staticData.recipes['angels-temperate-garden'];

describe('productAmount', () => {
  const gear = gears.products[0];
  const [gardens] = garden.products;

  it('is what the recipe rolls, at no productivity', () => {
    expect(productAmount(gear, 1)).toBe(1);
    expect(productAmount(gardens, 1)).toBe(2);
  });

  it('pays the bonus on the whole of a product which borrowed nothing', () => {
    expect(productAmount(gear, 1.36)).toBeCloseTo(1.36);
  });

  it('pays it only on the part which is not a catalyst', () => {
    // two gardens out, one of them the one which went in: +100% is paid on the one it grew
    expect(productAmount(gardens, 2)).toBe(3);
    expect(productAmount(gardens, 1.5)).toBe(2.5);
  });

  it('pays nothing where the catalyst is the whole result and more', () => {
    // four rays in, one back out, three of them ignored: there is nothing left to pay a bonus on
    const [ray] = staticData.recipes['angels-fish-keeping-3'].products;
    expect(ray.ignoredByProductivity).toBe(3);
    expect(productAmount(ray, 2)).toBe(1);
  });

  it('rolls the chance on the bigger result rather than on a better chance', () => {
    const [u235] = staticData.recipes['uranium-processing'].products;
    expect(productAmount(u235, 1.36)).toBeCloseTo(u235.probability * 1.36);
  });
});

/**
 * The claim `productAmount` rests on: where productivity can be paid on a resource the recipe also
 * takes, the data says how much of it is a catalyst, so nothing here has to work it out.
 *
 * Worth asserting rather than assuming, because the game has not always worked this way. In the 1.1
 * dump `factorio-raw-types` ships, `kovarex-enrichment-process` states no `catalyst_amount` at all,
 * though the game of course paid no productivity on the 40 uranium-235 it hands back: 1.1 derived
 * the catalyst from the ingredients and the dump showed nothing. 2.0's recipes state it — ours
 * gives kovarex its 40 — and this is where we find out if a pack does not.
 */
describe('the ingested catalyst shares', () => {
  const pairs = Object.entries(staticData.recipes).flatMap(([id, recipe]) => {
    if (!recipe.allowProductivity) return [];
    const ingredients = new Map(recipe.ingredients.map((i) => [i.resource, i.amount]));
    return recipe.products.flatMap((product) => {
      const taken = ingredients.get(product.resource);
      if (taken === undefined) return [];
      const made = 'fixed' in product.amount ? product.amount.fixed : product.amount.max;
      return [
        { at: `${id}/${product.resource}`, share: product.ignoredByProductivity, taken, made },
      ];
    });
  });

  it('states one wherever a productivity bonus could be paid on a resource going in', () => {
    // 29 of them here; a pack which stopped stating them would leave this list empty, not short
    expect(pairs.length).toBeGreaterThan(20);
    expect(
      pairs
        .filter(({ share, taken, made }) => share !== Math.min(taken, made))
        .map(({ at, share }) => `${at}: ${share}`),
    ).toEqual([]);
  });

  it('states them where no amount of arithmetic over the recipe could find them', () => {
    // glass takes molten tin and hands back tin *ingots*: a catalyst which changes form on the way
    // through, so "the resource is on both sides" sees nothing at all here
    const glass = staticData.recipes['angels-plate-glass-3'];
    const ingot = glass.products.find(({ resource }) => resource === 'item:angels-ingot-tin');
    expect(glass.ingredients.map(({ resource }) => resource)).not.toContain(
      'item:angels-ingot-tin',
    );
    expect(ingot?.ignoredByProductivity).toBe(2);
    // and the bonus is paid on the glass beside it, which the recipe did make
    expect(productAmount(ingot!, 1.5)).toBe(2);
    expect(productAmount(glass.products[0], 1.5)).toBe(7.5);
  });
});

describe('netRates', () => {
  it('is per second at the speed given, ingredients negative', () => {
    // 2 plates for a gear, half a second a craft, and a machine running at 1.25×
    const rates = netRates(gears, 1.25, NO_EFFECTS);
    expect(rates.get('item:iron-plate')).toBeCloseTo(-5);
    expect(rates.get('item:iron-gear-wheel')).toBeCloseTo(2.5);
  });

  it('leaves ingredients alone when productivity goes up, and crafts fewer when speed goes down', () => {
    // three productivity module 3s: 1.36× out, 0.55× the crafts
    const rates = netRates(gears, 1.25, { speed: 0.55, productivity: 1.36 });
    expect(rates.get('item:iron-plate')).toBeCloseTo(-5 * 0.55);
    expect(rates.get('item:iron-gear-wheel')).toBeCloseTo(2.5 * 0.55 * 1.36);
  });

  it('nets a catalyst down to what the recipe actually made', () => {
    // quoted per craft, so the numbers read as the recipe does: 2 out, 1 in, 1 grown
    expect(netRates(garden, garden.duration, NO_EFFECTS).get('item:angels-temperate-garden')).toBe(
      1,
    );
    // two bio-yield module 5s is +100%, and the game does not pay it on the garden handed back:
    // 2 + 1 rather than 2 × 2, so the cell gains two gardens a craft and not three
    const modded = netRates(garden, garden.duration, { speed: 1, productivity: 2 });
    expect(modded.get('item:angels-temperate-garden')).toBe(2);
  });
});

describe('flowTitle', () => {
  it('names the resource, its amount per craft, and any note', () => {
    const { ins, outs } = recipeFlows(uranium, [], 1);
    expect(flowTitle(ins[0])).toBe('Uranium ore: 10 per craft');
    expect(flowTitle(outs[0])).toBe('Uranium-235: 1 per craft, 0.7%');
  });
});
