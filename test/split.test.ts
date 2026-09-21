import { describe, expect, it } from 'vitest';
import type { CellEntry } from '../src/cell.ts';
import type { Solution } from '../src/solve/index.ts';
import { proposedSplits } from '../src/compute/split.ts';
import type { ResourceId } from '../src/types.ts';

const recipeRows = [
  {
    recipe: 'cpu',
    count: 15,
    inputs: { 'fluid:acid': 420, 'item:wafer': 252, 'item:platinum': 210, 'item:nitride': 42 },
    outputs: { 'item:cpu': 462 },
  },
  {
    recipe: 'nitride',
    count: 26.25,
    inputs: { 'fluid:nitrogen': 341.25, 'item:powder': 26.25 },
    outputs: { 'item:nitride': 42 },
  },
  {
    recipe: 'powder',
    count: 1.5625,
    inputs: { 'item:ingot': 26.25 },
    outputs: { 'item:powder': 26.25 },
  },
  {
    recipe: 'wafer',
    count: 27.27272727272727,
    inputs: { 'item:mono': 19.09090909090909 },
    outputs: { 'item:wafer': 252 },
  },
  {
    recipe: 'mono',
    count: 23.86363636363636,
    inputs: { 'fluid:molten': 119.3181818181818, 'item:seed': 2.982954545454545 },
    outputs: { 'item:mono': 19.09090909090909 },
  },
  {
    recipe: 'seed',
    count: 0.2840909090909091,
    inputs: { 'fluid:nitrogen': 5.965909090909091, 'fluid:molten': 2.982954545454545 },
    outputs: { 'item:seed': 2.982954545454545 },
  },
  {
    recipe: 'molten',
    count: 0.4853219696969697,
    inputs: { 'item:ingot': 12.23011363636364 },
    outputs: { 'fluid:molten': 122.3011363636364 },
  },
  {
    recipe: 'oxygen-void',
    count: 0.7891270661157023,
    inputs: { 'fluid:oxygen': 347.2159090909091 },
    outputs: {},
  },
  {
    recipe: 'air-separation',
    count: 1.256890168654874,
    inputs: { 'fluid:compressed-air': 694.431818181818 },
    outputs: { 'fluid:nitrogen': 347.2159090909091, 'fluid:oxygen': 347.2159090909091 },
  },
  {
    recipe: 'compressed-air',
    count: 4.208677685950413,
    inputs: {},
    outputs: { 'fluid:compressed-air': 694.431818181818 },
  },
] as const;

function perMachine(values: Record<string, number>, count: number) {
  return new Map(
    Object.entries(values).map(([resource, rate]) => [resource as ResourceId, rate / count]),
  );
}

function cpuSolution(): { entries: CellEntry[]; solution: Solution } {
  const entries = recipeRows.map(({ recipe }) => ({ recipe }));
  const counts = recipeRows.map(({ count }) => count);
  const inputRates = recipeRows.map(({ inputs, count }) => perMachine(inputs, count));
  const outputRates = recipeRows.map(({ outputs, count }) => perMachine(outputs, count));
  const rates = recipeRows.map((_, index) => {
    const net = new Map(outputRates[index]);
    for (const [resource, rate] of inputRates[index]!) {
      net.set(resource, (net.get(resource) ?? 0) - rate);
    }
    return net;
  });
  return {
    entries,
    solution: {
      counts,
      rates,
      inputRates,
      outputRates,
      balance: new Map(),
      complete: true,
      notes: [],
    },
  };
}

describe('proposedSplits', () => {
  it('finds compatible regional and transport-first CPU partitions', () => {
    const { entries, solution } = cpuSolution();
    const proposals = proposedSplits(entries, solution, {
      itemsPerSecond: 30,
      undergroundLength: 7,
    });

    expect(proposals.map(({ name }) => name)).toEqual(['3 regions', '4 units']);
    expect(
      proposals[0]!.groups.map((group) => group.entries.map((index) => entries[index]!.recipe)),
    ).toEqual([
      ['oxygen-void', 'air-separation', 'compressed-air'],
      ['powder', 'mono', 'seed', 'molten'],
      ['nitride', 'wafer', 'cpu'],
    ]);
    expect(
      proposals[1]!.groups.map((group) => group.entries.map((index) => entries[index]!.recipe)),
    ).toEqual([
      ['oxygen-void', 'air-separation', 'compressed-air'],
      ['powder', 'molten'],
      ['mono', 'seed'],
      ['nitride', 'wafer', 'cpu'],
    ]);
    expect(proposals[1]!.groups.map(({ installedMachines }) => installedMachines)).toEqual([
      8, 3, 25, 70,
    ]);
  });

  it('reports the exact direct-producer ratios without using installed counts', () => {
    const { entries, solution } = cpuSolution();
    const [proposal] = proposedSplits(entries, solution, {
      itemsPerSecond: 30,
      undergroundLength: 7,
    });

    expect(proposal!.ratios).toEqual([
      { producer: 'nitride', producerMachines: 7, consumer: 'cpu', consumerMachines: 4 },
      { producer: 'wafer', producerMachines: 20, consumer: 'cpu', consumerMachines: 11 },
    ]);
  });

  it('does not suggest a partition until the cell is large and fully solved', () => {
    const { entries, solution } = cpuSolution();
    expect(
      proposedSplits(
        entries.slice(0, 3),
        { ...solution, counts: solution.counts.slice(0, 3) },
        {
          itemsPerSecond: 30,
          undergroundLength: 7,
        },
      ),
    ).toEqual([]);
    expect(
      proposedSplits(
        entries,
        { ...solution, counts: [undefined, ...solution.counts.slice(1)] },
        {
          itemsPerSecond: 30,
          undergroundLength: 7,
        },
      ),
    ).toEqual([]);
  });
});
