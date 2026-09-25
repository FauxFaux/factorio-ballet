import { describe, expect, it } from 'vitest';
import type { FactoryModule } from '../../src/compute/modules.ts';
import type { SpringLinks } from '../../src/components/layout/spring-layout.ts';
import { preLayoutModules } from '../../src/components/layout/pre-layout.ts';

function module(id: string, inputs: string[] = [], outputs: string[] = []): FactoryModule {
  return {
    id,
    recipe: id,
    machineCount: 1,
    copies: 1,
    size: { width: 8, height: 10 },
    ports: [],
    inputs: Object.fromEntries(inputs.map((resource) => [resource, 1])),
    outputs: Object.fromEntries(outputs.map((resource) => [resource, 1])),
  };
}

const links: SpringLinks = {
  connections: [],
  stationConnections: [
    {
      stationId: 'iron',
      stationIndex: 0,
      moduleId: 'ingot',
      resource: 'item:ore',
      rate: 1,
      side: 'input',
      modulePort: { edge: 'bottom', x: 2, transport: 'belt' },
    },
  ],
  inputStationStops: [{ x: 20, y: 40 }],
  outputStationStops: [],
};

describe('pre-layout', () => {
  it('starts with a zero-input utility, then expands from stations through available outputs', () => {
    const result = preLayoutModules(
      [
        module('finished', ['item:ingot', 'fluid:air']),
        module('ingot', ['item:ore'], ['item:ingot']),
        module('air', [], ['fluid:air']),
      ],
      links,
      new Set(['air']),
    );
    expect(result.map(({ module }) => module.id)).toEqual(['air', 'ingot', 'finished']);
    for (const placement of result) {
      expect(placement.x).toBeGreaterThan(20);
      expect(placement.x + placement.module.size.width).toBeLessThanOrEqual(187);
    }
    for (let a = 0; a < result.length; a++) {
      for (let b = a + 1; b < result.length; b++) {
        const first = result[a]!;
        const second = result[b]!;
        expect(
          first.x + first.module.size.width + 5 <= second.x ||
            second.x + second.module.size.width + 5 <= first.x ||
            first.y + first.module.size.height + 5 <= second.y ||
            second.y + second.module.size.height + 5 <= first.y,
        ).toBe(true);
      }
    }
  });

  it('seeds a dependency cycle when no module is ready', () => {
    const result = preLayoutModules(
      [module('A', ['item:b'], ['item:a']), module('B', ['item:a'], ['item:b'])],
      { ...links, stationConnections: [], inputStationStops: [] },
    );
    expect(result).toHaveLength(2);
    expect(result.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
  });
});
