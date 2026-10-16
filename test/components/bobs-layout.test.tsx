// @vitest-environment happy-dom

import { cleanup, screen, waitFor } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '../render-with-dataset.tsx';
import { BobsLayoutSurface } from '../../src/components/layout/bobs-layout.tsx';
import { defaultDataset } from '../with-bobang.ts';
import { solveCell } from '../../src/solve/index.ts';
import { noChoice } from '../../src/data/index.ts';
import type { BobAttempt, BobResult } from '../../src/compute/bobs/types.ts';
import type { Cell } from '../../src/cell.ts';

const { solve, solvePaired } = vi.hoisted(() => ({ solve: vi.fn(), solvePaired: vi.fn() }));
vi.mock('../../src/compute/bobs/bobs-solver.ts', () => ({
  solveBobLayout: solve,
  solveBobPairedLayout: solvePaired,
}));

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
  solvePaired.mockReset();
  solvePaired.mockResolvedValue(result);
  solve.mockResolvedValue(result);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Bob layout surface', () => {
  it('exposes fixed pairing budgets and runs the selected solver', async () => {
    const user = userEvent.setup();
    render(surface());
    await waitFor(() => expect(solve).toHaveBeenCalledTimes(1));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Solve mode' }), 'paired');
    expect(screen.queryByRole('spinbutton', { name: 'Relay chests' })).toBeNull();
    expect(
      (screen.getByRole('combobox', { name: 'Boundary chests' }) as HTMLSelectElement).value,
    ).toBe('left-right');
    expect(
      (
        screen.getByRole('checkbox', {
          name: 'Remove equivalent rotations and reflections',
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    for (const label of [
      'Pairing seconds',
      'Placement seconds',
      'Annealing seconds',
      'Pairing items/s',
      'Balance weight',
    ]) {
      expect(screen.getByRole('spinbutton', { name: label })).toBeTruthy();
    }
    await user.clear(screen.getByRole('spinbutton', { name: 'Pairing seconds' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Pairing seconds' }), '7');
    await user.click(screen.getByRole('button', { name: 'Solve' }));
    await waitFor(() => expect(solvePaired).toHaveBeenCalledTimes(1));
    expect(solvePaired.mock.calls[0][1]).toMatchObject({
      pairingSeconds: 7,
      annealingSeconds: 5,
      pairingCapacity: 144,
      boundaryEdges: 'left-right',
      breakSymmetry: true,
      balanceWeight: 1,
    });
    expect(solve).toHaveBeenCalledTimes(1);
    await user.clear(screen.getByRole('spinbutton', { name: 'Balance weight' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Balance weight' }), '3');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Boundary chests' }), 'any');
    await user.click(
      screen.getByRole('checkbox', { name: 'Remove equivalent rotations and reflections' }),
    );
    await user.click(screen.getByRole('button', { name: 'Solve' }));
    await waitFor(() => expect(solvePaired).toHaveBeenCalledTimes(2));
    expect(solvePaired.mock.calls[1][1]).toMatchObject({
      boundaryEdges: 'any',
      breakSymmetry: false,
      balanceWeight: 3,
    });
  });

  it('shows live placements and keeps conflict regions selectable after success', async () => {
    const user = userEvent.setup();
    const failed: BobAttempt = {
      id: 1,
      layout: result.layout!,
      stage: 'conflict',
      promoted: [],
      message: 'No transport fits the first placement.',
      conflicts: [
        {
          kind: 'space',
          message: 'No free inserter tile near copper wire.',
          tiles: [{ x: 1, y: 3 }],
          ports: [],
        },
      ],
    };
    const pending: BobAttempt = {
      id: 2,
      layout: { ...result.layout!, width: 4 },
      stage: 'placement',
      promoted: [],
      conflicts: [],
      message: 'Connecting second placement…',
    };
    const solved: BobAttempt = { ...pending, stage: 'solved', message: 'Transport validated.' };
    let finish: (r: BobResult) => void = () => {};
    solve.mockImplementationOnce((_problem, _options, _signal, notify: (a: BobAttempt) => void) => {
      notify(failed);
      notify(pending);
      return new Promise<BobResult>((resolve) => {
        finish = resolve;
      });
    });
    render(surface());
    const first = await screen.findByRole('button', { name: /Attempt 1: Conflict/ });
    expect(
      screen.getByRole('button', { name: /Attempt 2: Connecting/ }).getAttribute('aria-pressed'),
    ).toBe('true');
    await user.click(first);
    expect(
      screen.getByRole('img', { name: /Inserter conflict region: No free inserter/ }),
    ).toBeTruthy();
    finish({
      status: 'feasible',
      message: 'Found a layout.',
      layout: solved.layout,
      attempts: [failed, solved],
    });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Found a layout.'));
    expect(first.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('img', { name: /Inserter conflict region/ })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Attempt 2: Connected/ }));
    expect(screen.queryByRole('img', { name: /Inserter conflict region/ })).toBeNull();
  });

  it('retains the last placement after stopping transport', async () => {
    const user = userEvent.setup();
    solve.mockImplementationOnce(
      (_problem, _options, signal: AbortSignal, notify: (a: BobAttempt) => void) => {
        notify({
          id: 1,
          layout: result.layout!,
          stage: 'placement',
          promoted: [],
          conflicts: [],
          message: 'Transport pending.',
        });
        return new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))),
        );
      },
    );
    render(surface());
    expect(await screen.findByRole('img', { name: 'Bob assembler layout' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Search stopped.'));
    expect(screen.getByRole('button', { name: /Attempt 1/ })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Bob assembler layout' })).toBeTruthy();
  });

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
    let notifyOld: (attempt: BobAttempt) => void = () => {};
    solve.mockImplementationOnce((_problem, _options, _signal, notify: (a: BobAttempt) => void) => {
      notifyOld = notify;
      return new Promise<BobResult>((resolve) => {
        finish = resolve;
      });
    });
    solve.mockResolvedValueOnce({ status: 'unknown', message: 'Second search timed out.' });
    const view = render(surface());
    await waitFor(() => expect(solve).toHaveBeenCalledTimes(1));
    view.rerender(surface(2));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toBe('Second search timed out.'),
    );
    finish(result);
    notifyOld({
      id: 1,
      layout: result.layout!,
      stage: 'placement',
      conflicts: [],
      promoted: [],
      message: 'Obsolete placement.',
    });
    await waitFor(() =>
      expect(screen.queryByRole('img', { name: 'Bob assembler layout' })).toBeNull(),
    );
    expect(screen.queryByRole('list', { name: 'Placement attempts' })).toBeNull();
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
