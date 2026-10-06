// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCellLayouts, useRecipeLayouts } from '../../../src/components/cell/recipe-layout.ts';
import { solveKernelTileDesign } from '../../../src/compute/tile-design/kernel-result.ts';
import type { Dataset } from '../../../src/dataset/index.ts';
import type { Solution } from '../../../src/solve/index.ts';
import { defaultDataset } from '../../with-bobang.ts';

vi.mock('../../../src/compute/tile-design/kernel-result.ts', () => ({
  solveKernelTileDesign: vi.fn(),
}));

const belt = defaultDataset.data.belts['bob-ultimate-transport-belt'];
const entries = [{ recipe: 'iron-plate', machine: 'stone-furnace' }];
function solution(count: number, rate = 1): Solution {
  return {
    counts: [count],
    rates: [],
    balance: new Map(),
    complete: true,
    notes: [],
    inputRates: [new Map([['item:iron-ore', rate]])],
    outputRates: [new Map([['item:iron-plate', rate]])],
  };
}
function Expanded({ ds, solved }: { ds: Dataset; solved: Solution }) {
  const layout = useRecipeLayouts(
    ds,
    'iron-plate',
    'stone-furnace',
    solved.inputRates[0],
    solved.outputRates[0],
    solved.counts[0],
    belt,
    1,
  );
  return (
    <output aria-label="Expanded layout">
      {layout.pending ? 'pending' : layout.options.length}
    </output>
  );
}
function Probe({
  ds,
  solved,
  expanded = false,
}: {
  ds: Dataset;
  solved: Solution;
  expanded?: boolean;
}) {
  const [layout] = useCellLayouts(ds, entries, solved, belt, 1);
  return (
    <>
      <output aria-label="Cell layout">
        {layout.pending
          ? 'pending'
          : `${layout.options[0]?.columns.reduce((sum, column) => sum + column.machineCount, 0)}:${layout.problem.inputs.solids['item:iron-ore']}`}
      </output>
      {expanded && <Expanded ds={ds} solved={solved} />}
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.mocked(solveKernelTileDesign).mockReset();
});

function mockSearch() {
  vi.mocked(solveKernelTileDesign).mockImplementation((_problem, _throughput, options) => ({
    status: 'found',
    candidate: {
      column: { entities: [] },
      width: 5,
      pitch: 5,
      machineIds: { 0: 'stone-furnace' },
      lanes: [],
      transfers: [],
      fluids: [],
      boundary: [],
    },
    validation: { valid: true, issues: [], supportedCopies: options?.repeatCount ?? 1 },
    optimal: true,
    stopReason: 'complete',
    diagnostics: {
      exploredStates: 1,
      capacityRejections: 0,
      validationRejections: 0,
      scope: 'one-machine/external-items/straight-surface-trunks',
    },
  }));
}

describe('cell layout answers', () => {
  it('warms collapsed rows and shares searches across expansion and count edits', async () => {
    mockSearch();
    const ds = { ...defaultDataset };
    const { rerender } = render(<Probe ds={ds} solved={solution(5)} />);
    expect(screen.getByLabelText('Cell layout').textContent).toBe('pending');
    await waitFor(() => expect(screen.getByLabelText('Cell layout').textContent).toBe('5:1'));
    expect(solveKernelTileDesign).toHaveBeenCalledTimes(21);
    rerender(<Probe ds={ds} solved={solution(50)} expanded />);
    expect(screen.getByLabelText('Cell layout').textContent).toBe('50:1');
    expect(screen.getByLabelText('Expanded layout').textContent).not.toBe('pending');
    await waitFor(() => expect(solveKernelTileDesign).toHaveBeenCalledTimes(21));
    rerender(<Probe ds={ds} solved={solution(50, 2)} expanded />);
    expect(screen.getByLabelText('Cell layout').textContent).toBe('pending');
    await waitFor(() => expect(screen.getByLabelText('Cell layout').textContent).toBe('50:2'));
    expect(solveKernelTileDesign).toHaveBeenCalledTimes(42);
  });

  it('does not display obsolete answers when rates change during a search', async () => {
    mockSearch();
    const ds = { ...defaultDataset };
    const { rerender } = render(<Probe ds={ds} solved={solution(5)} />);
    await waitFor(() => expect(solveKernelTileDesign).toHaveBeenCalled());
    rerender(<Probe ds={ds} solved={solution(10, 3)} />);
    expect(screen.getByLabelText('Cell layout').textContent).toBe('pending');
    await waitFor(() => expect(screen.getByLabelText('Cell layout').textContent).toBe('10:3'));
    expect(vi.mocked(solveKernelTileDesign).mock.lastCall?.[0].inputs.solids['item:iron-ore']).toBe(
      3,
    );
  });
});
