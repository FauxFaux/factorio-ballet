// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { CellSide } from '../src/components/cell/side.tsx';
import { staticData } from '../src/data/decode.ts';
import type { Solution } from '../src/solve/index.ts';
import type { Belt } from '../src/types.ts';

afterEach(cleanup);

const ids = ['item:iron-plate', 'item:iron-gear-wheel'] as const;
const belt: Belt = { human: 'test belt', itemsPerSecond: 75, undergroundLength: 7 };

function solutionFor(...rates: number[]): Solution {
  return {
    counts: [],
    rates: [],
    balance: new Map(ids.map((id, index) => [id, rates[index]])),
    inputRates: [],
    outputRates: [],
    complete: true,
    notes: [],
  };
}

describe('CellSide rates', () => {
  it('uses one decimal place until a rate exceeds 100', () => {
    const { rerender } = render(
      <CellSide
        dir="out"
        ids={[...ids]}
        solution={solutionFor(10.06, 0.44)}
        belt={belt}
        onSearch={() => {}}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText('10.1')).toBeTruthy();
    expect(screen.getByText('0.4')).toBeTruthy();

    rerender(
      <CellSide
        dir="out"
        ids={[...ids]}
        solution={solutionFor(10.06, 100.01)}
        belt={belt}
        onSearch={() => {}}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText('10')).toBeTruthy();
    expect(screen.getByText('100')).toBeTruthy();
  });

  it('warns when a rate exceeds the station belt or train capacity', () => {
    const trainLimit = 5 * staticData.resources[ids[0]]!.stackSize!;
    render(
      <CellSide
        dir="out"
        ids={[...ids]}
        solution={solutionFor(301, trainLimit + 1)}
        belt={belt}
        onSearch={() => {}}
        onSelect={() => {}}
      />,
    );

    expect(screen.getByText('301').className).toContain('is-over-belt-capacity');
    expect(screen.getByText((trainLimit + 1).toFixed(0)).className).toContain(
      'is-over-train-capacity',
    );
    expect(screen.getByTitle(/cannot keep one station supplied/)).toBeTruthy();
  });
});
