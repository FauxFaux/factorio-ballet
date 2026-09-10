// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { RadarAssemblers } from '../src/components/cell/radar-assemblers.tsx';
import type { Solution } from '../src/solve/index.ts';
import type { Belt } from '../src/types.ts';

afterEach(cleanup);

const belt: Belt = { human: 'test belt', itemsPerSecond: 15, undergroundLength: 7 };
const solution: Solution = {
  counts: [34],
  rates: [new Map()],
  balance: new Map(),
  inputRates: [new Map([['item:iron-ore', 1]])],
  outputRates: [new Map([['item:iron-plate', 1]])],
  complete: true,
  notes: [],
};

describe('RadarAssemblers', () => {
  it('mirrors multi-lane input station belts onto the bus', () => {
    const { container } = render(
      <svg>
        <RadarAssemblers
          inputs={['item:iron-ore']}
          outputs={['item:iron-plate']}
          entries={[{ recipe: 'iron-plate', machine: 'stone-furnace' }]}
          solution={solution}
          belt={belt}
          progress={0}
          startX={0}
          stackedStations={false}
        />
      </svg>,
    );

    const stationBelts = [
      ...container.querySelectorAll<SVGRectElement>(
        '[data-resource="item:iron-ore"][data-bus-segment="station-belt"]',
      ),
    ].sort((a, b) => Number(a.getAttribute('x')) - Number(b.getAttribute('x')));

    expect(stationBelts.map((belt) => Number(belt.getAttribute('y')))).toEqual([17, 18, 19]);
  });

  it('extends an input bus to the last wrapped assembler column', () => {
    const { container } = render(
      <svg>
        <RadarAssemblers
          inputs={['item:iron-ore']}
          outputs={['item:iron-plate']}
          entries={[{ recipe: 'iron-plate', machine: 'stone-furnace' }]}
          solution={solution}
          belt={belt}
          progress={0}
          startX={0}
          stackedStations={false}
        />
      </svg>,
    );

    const horizontal = [
      ...container.querySelectorAll<SVGRectElement>(
        '[data-resource="item:iron-ore"][data-bus-segment="horizontal"]',
      ),
    ].find((belt) => belt.getAttribute('y') === '17')!;

    const busEnd = Number(horizontal.getAttribute('x')) + Number(horizontal.getAttribute('width'));

    expect(busEnd).toBe(6.125);
  });
});
