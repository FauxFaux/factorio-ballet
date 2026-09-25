// @vitest-environment happy-dom
import { cleanup, screen, within } from '@testing-library/preact';
import { render } from './render-with-dataset.tsx';
import userEvent from '@testing-library/user-event';
import { useState } from 'preact/hooks';
import { afterEach, describe, expect, it } from 'vitest';
import state from './assets/plutonium.state.json';
import snapshot from './assets/plutonium.cell.json';
import { cellInterface, type Cell } from '../src/cell.ts';
import { resolveChosen, resourceName } from '../src/data/index.ts';
import { solveCell } from '../src/solve/index.ts';
import { dumbSolver } from '../src/solve/dumb.ts';
import { matrixSolver } from '../src/solve/matrix.ts';
import { CellBox } from '../src/components/cell/box.tsx';
import { staticData } from '../src/data/decode.ts';
import { defaultDataset } from '../src/dataset';

const cell: Cell = state.cl[0];
const chosen = resolveChosen(defaultDataset, state.mo, undefined, undefined, state.gp);
const u238 = 'item:uranium-238';
afterEach(cleanup);

describe('plutonium boundary diagnosis', () => {
  it('reproduces the misleading balanced U-238 in the saved dumb answer', () => {
    const answer = solveCell(staticData, cell, state.gp, chosen, dumbSolver);
    expect(answer.counts).toEqual(snapshot.recipes.map((recipe) => recipe.count));
    expect(answer.balance.get(u238)).toBe(0);
    expect(Math.abs(answer.balance.get('item:uranium-235')!)).toBeGreaterThan(0.1);
    expect(Math.abs(answer.balance.get('item:angels-neptunium-240')!)).toBeGreaterThan(0.01);
  });

  it.each([matrixSolver, dumbSolver])('suggests a verified U-238 export for $id', (solver) => {
    const answer = solveCell(staticData, cell, state.gp, chosen, solver);
    const suggestion = answer.boundarySuggestions?.find((note) => note.resource === u238);
    expect(suggestion).toMatchObject({
      direction: 'export',
      requiresMatrix: solver === dumbSolver,
    });
    expect(answer.boundarySuggestions?.filter((note) => note.direction === 'export')).toHaveLength(
      1,
    );
    const exported: Cell = { ...cell, exports: [u238] };
    const fixed = solveCell(staticData, exported, state.gp, chosen, matrixSolver);
    expect(fixed.complete).toBe(true);
    expect(fixed.notes).toEqual([]);
    expect(fixed.boundarySuggestions).toEqual([]);
    expect(fixed.counts[0]).toBe(7);
    expect(fixed.balance.get(u238)).toBeCloseTo(suggestion!.rate, 9);
    expect(fixed.balance.get(u238)).toBeGreaterThan(0);
    const iface = cellInterface(staticData, exported);
    for (const resource of iface.inPlay.filter(
      (id) => !iface.inputs.includes(id) && !iface.outputs.includes(id),
    )) {
      expect(fixed.balance.get(resource)).toBeCloseTo(0, 9);
    }
  });

  it('warns that exporting alone does not repair the dumb solver on this cycle', () => {
    const fixedBoundary: Cell = { ...cell, exports: [u238] };
    const dumb = solveCell(staticData, fixedBoundary, state.gp, chosen, dumbSolver);
    const iface = cellInterface(staticData, fixedBoundary);
    expect(
      iface.inPlay.some(
        (id) =>
          !iface.inputs.includes(id) &&
          !iface.outputs.includes(id) &&
          Math.abs(dumb.balance.get(id) ?? 0) > 1e-9,
      ),
    ).toBe(true);
  });

  it('applies a boundary suggestion while opening its resource details', async () => {
    function Example() {
      return (
        <CellBox
          cell={useState(cell)}
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
    const chip = screen.getByRole('button', {
      name: `Show recipes for ${resourceName(staticData, u238)}`,
    });
    expect(
      within(chip).getByLabelText(`Review export for ${resourceName(staticData, u238)}`),
    ).toBeTruthy();
    await user.click(
      screen.getByRole('button', { name: `export ${resourceName(staticData, u238)}` }),
    );
    expect(
      screen.queryByText(/recalculating with this boundary balances all other internal resources/),
    ).toBeNull();
    expect(screen.queryByText(/These internal balances cannot all close together/)).toBeNull();
    expect(
      screen.queryByLabelText(`Review export for ${resourceName(staticData, u238)}`),
    ).toBeNull();
    expect(screen.getByRole('button', { name: 'clear explicit export' })).toBeTruthy();
  });
});
