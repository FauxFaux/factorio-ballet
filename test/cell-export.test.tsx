// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { useState } from 'preact/hooks';
import { afterEach, describe, expect, it } from 'vitest';
import state from './assets/uranium.state.json';
import { cellInterface, type Cell } from '../src/cell.ts';
import { resolveChosen, resourceName } from '../src/data/index.ts';
import { packCells, unpackCells } from '../src/pack.ts';
import { dumbSolver, matrixSolver, solveCell } from '../src/solve/index.ts';
import { CellBox } from '../src/components/cell/box.tsx';

const uranium: Cell = state.cl[0];
const chosen = resolveChosen({}, undefined, undefined, state.gp);
const exported: Cell = { ...uranium, exports: ['item:uranium-238'] };
afterEach(cleanup);

describe('explicit cell imports', () => {
  const imported: Cell = { ...uranium, imports: ['item:uranium-235'] };

  it('closes the uranium recycling loop with external U-235', () => {
    const solution = solveCell(imported, state.gp, chosen);
    expect(solution.complete).toBe(true);
    expect(solution.notes).toEqual([]);
    expect(solution.balance.get('item:uranium-235')).toBeLessThan(0);
    for (const resource of [
      'item:uranium-238',
      'item:angels-uranium-234',
      'item:uranium-fuel-cell',
      'item:angels-uranium-fuel-cell',
      'item:depleted-uranium-fuel-cell',
    ] as const) {
      expect(solution.balance.get(resource)).toBeCloseTo(0, 9);
    }
    expect(solution.balance.get('item:angels-neptunium-240')).toBeGreaterThan(0);
    expect(solution.rates[0].get('item:uranium-235')).toBeGreaterThan(0);
  });

  it('preserves imports and classifies them as inputs', () => {
    expect(unpackCells(packCells([imported]))).toEqual([imported]);
    expect(cellInterface(imported).inputs).toContain('item:uranium-235');
    expect(cellInterface(imported).outputs).not.toContain('item:uranium-235');
  });

  it.each([matrixSolver, dumbSolver])(
    'rejects a surplus on an explicit import with $id',
    (solver) => {
      const solution = solveCell(
        { ...exported, imports: ['item:angels-neptunium-240'] },
        state.gp,
        chosen,
        solver,
      );
      expect(solution.complete).toBe(false);
      expect(
        solution.notes.some(
          (note) =>
            note.kind === 'solver' && note.detail.includes('marked for import but has a surplus'),
        ),
      ).toBe(true);
    },
  );

  it('enables, clears and replaces an import from resource details', async () => {
    function Example() {
      const cell = useState(uranium);
      return (
        <CellBox
          cell={cell}
          active
          progress={state.gp}
          chosen={chosen}
          onActivate={() => {}}
          onRemove={() => {}}
          onSearch={() => {}}
        />
      );
    }
    const user = userEvent.setup();
    render(<Example />);
    await user.click(
      screen.getByRole('button', { name: `Show recipes for ${resourceName('item:uranium-235')}` }),
    );
    expect(screen.getByText(/or import the shortfall/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Import shortfall' }));
    expect(screen.getByText(/Explicit import: shortfall is supplied/)).toBeTruthy();
    expect(screen.getByTitle('Explicit import: shortfall is supplied externally')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Clear explicit import' }));
    expect(screen.queryByText('forced')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Import shortfall' }));
    await user.click(screen.getByRole('button', { name: 'Export surplus' }));
    expect(screen.queryByRole('button', { name: 'Clear explicit import' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Clear explicit export' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Import shortfall' }));
    expect(screen.queryByRole('button', { name: 'Clear explicit export' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Clear explicit import' })).toBeTruthy();
  });
});

describe('explicit cell exports', () => {
  it.each([matrixSolver, dumbSolver])('balances the uranium chain with $id', (solver) => {
    const solution = solveCell(exported, state.gp, chosen, solver);
    expect(solution.complete).toBe(true);
    expect(solution.notes).toEqual([]);
    expect(solution.balance.get('item:uranium-238')).toBeCloseTo(7.9007091625);
    expect(solution.balance.get('item:angels-neptunium-240')).toBeCloseTo(0.04418183);
    for (const id of [
      'item:uranium-235',
      'item:angels-uranium-234',
      'item:uranium-fuel-cell',
      'item:angels-uranium-fuel-cell',
      'item:depleted-uranium-fuel-cell',
    ] as const) {
      expect(solution.balance.get(id)).toBeCloseTo(0, 9);
    }
    expect(solution.rates[0].get('item:uranium-238')).toBeGreaterThan(0);
  });

  it('preserves exports in packed state and exposes them as outputs', () => {
    expect(unpackCells(packCells([exported]))).toEqual([exported]);
    expect(cellInterface(exported).outputs).toContain('item:uranium-238');
    expect(cellInterface(uranium).outputs).not.toContain('item:uranium-238');
  });

  it('rejects an export that requires external supply', () => {
    const solution = solveCell({ ...uranium, exports: ['item:uranium-ore'] }, state.gp, chosen);
    expect(solution.complete).toBe(false);
    expect(
      solution.notes.some((note) => note.kind === 'solver' && note.detail.includes('shortfall')),
    ).toBe(true);
  });

  it('allows an export to be enabled and cleared from resource details', async () => {
    function Example() {
      const cell = useState(uranium);
      return (
        <CellBox
          cell={cell}
          active
          progress={state.gp}
          chosen={chosen}
          onActivate={() => {}}
          onRemove={() => {}}
          onSearch={() => {}}
        />
      );
    }
    const user = userEvent.setup();
    render(<Example />);
    await user.click(
      screen.getByRole('button', { name: `Show recipes for ${resourceName('item:uranium-238')}` }),
    );
    await user.click(screen.getByRole('button', { name: 'Export surplus' }));
    expect(screen.getByText('forced')).toBeTruthy();
    expect(screen.getByText(/Explicit export: surplus may leave/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Clear explicit export' }));
    expect(screen.queryByText('forced')).toBeNull();
  });
});
