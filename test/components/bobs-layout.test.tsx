// @vitest-environment happy-dom

import { cleanup, screen, waitFor } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '../render-with-dataset.tsx';
import { BobsLayoutSurface } from '../../src/components/layout/bobs-layout.tsx';
import { defaultDataset } from '../with-bobang.ts';
import { solveCell } from '../../src/solve/index.ts';
import { noChoice } from '../../src/data/index.ts';
import type { BobResult } from '../../src/compute/bobs/types.ts';
import type { Cell } from '../../src/cell.ts';

const { solve } = vi.hoisted(() => ({ solve: vi.fn() }));
vi.mock('../../src/compute/bobs/bobs-solver.ts', () => ({ solveBobLayout: solve }));

const result: BobResult = {
  status: 'optimal',
  message: 'Optimal within search bounds.',
  layout: {
    width: 3,
    height: 5,
    nodes: [
      {
        id: '0:0',
        label: 'Copper wire 1',
        kind: 'assembler',
        position: { x: 0, y: 0 },
        size: { width: 3, height: 3 },
      },
    ],
    inserters: [],
  },
};

function surface(count = 1) {
  const cell: Cell = { entries: [{ recipe: 'copper-cable', count }], layout: { type: 'bobs' } };
  return (
    <BobsLayoutSurface
      cell={cell}
      solution={solveCell(defaultDataset, defaultDataset.data, cell, 0, noChoice(defaultDataset))}
      progress={0}
      inputs={['item:copper-plate']}
      outputs={['item:copper-cable']}
    />
  );
}

beforeEach(() => {
  vi.stubGlobal('crossOriginIsolated', true);
  solve.mockReset();
  solve.mockResolvedValue(result);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Bob layout surface', () => {
  it('solves the cell and reruns with the selected bounds', async () => {
    const user = userEvent.setup();
    render(surface());
    expect(await screen.findByRole('img', { name: 'Bob assembler layout' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('Optimal within search bounds');
    const maxWidth = screen.getByRole('spinbutton', { name: 'Max width' });
    await user.clear(maxWidth);
    await user.type(maxWidth, '12');
    await user.click(screen.getByRole('button', { name: 'Solve' }));
    await waitFor(() => expect(solve).toHaveBeenCalledTimes(2));
    expect(solve.mock.calls[1][1].maxWidth).toBe(12);
    expect(solve.mock.calls[0][2].aborted).toBe(true);
  });

  it('aborts an ongoing search when stopped or removed', async () => {
    const user = userEvent.setup();
    solve.mockImplementation(
      (_problem, _options, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    const view = render(surface());
    const stop = await screen.findByRole('button', { name: 'Stop' });
    await waitFor(() => expect(solve).toHaveBeenCalledTimes(1));
    await user.click(stop);
    expect(solve.mock.calls[0][2].aborted).toBe(true);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Search stopped.'));
    await user.click(screen.getByRole('button', { name: 'Solve' }));
    await waitFor(() => expect(solve).toHaveBeenCalledTimes(2));
    view.unmount();
    expect(solve.mock.calls[1][2].aborted).toBe(true);
  });

  it('discards obsolete answers after the cell changes', async () => {
    let finish: (answer: BobResult) => void = () => {};
    solve.mockImplementationOnce(
      () =>
        new Promise<BobResult>((resolve) => {
          finish = resolve;
        }),
    );
    solve.mockResolvedValueOnce({ status: 'unknown', message: 'Second search timed out.' });
    const view = render(surface());
    await waitFor(() => expect(solve).toHaveBeenCalledTimes(1));
    view.rerender(surface(2));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('Second search timed out.'),
    );
    finish(result);
    await waitFor(() =>
      expect(screen.queryByRole('img', { name: 'Bob assembler layout' })).toBeNull(),
    );
  });

  it('explains missing browser isolation without starting the solver', async () => {
    vi.stubGlobal('crossOriginIsolated', false);
    render(surface());
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('cross-origin isolation'),
    );
    expect(solve).not.toHaveBeenCalled();
  });
});
