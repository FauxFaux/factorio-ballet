import { describe, expect, it } from 'vitest';
import { flowTitle, rateDigits, recipeFlows, speedOf } from '../src/flow.ts';
import { machinesFor, staticData, type MachineMatch } from '../src/data.ts';

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

describe('flowTitle', () => {
  it('names the resource, its amount per craft, and any note', () => {
    const { ins, outs } = recipeFlows(uranium, [], 1);
    expect(flowTitle(ins[0])).toBe('Uranium ore: 10 per craft');
    expect(flowTitle(outs[0])).toBe('Uranium-235: 1 per craft, 0.7%');
  });
});
