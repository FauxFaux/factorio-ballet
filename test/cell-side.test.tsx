// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { CellSide } from '../src/components/cell/side.tsx';
import type { Solution } from '../src/solve/index.ts';

afterEach(cleanup);

const ids = ['item:iron-plate', 'item:iron-gear-wheel'] as const;

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
        onSearch={() => {}}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText('10')).toBeTruthy();
    expect(screen.getByText('100')).toBeTruthy();
  });
});
