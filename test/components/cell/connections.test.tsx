// @vitest-environment happy-dom

import { cleanup, render, screen, within } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import cpuCell from '../../../docs/cells/cpu.json';
import { RecipeConnections } from '../../../src/components/cell/connections.tsx';
import { DatasetProvider } from '../../../src/dataset/context.tsx';
import { defaultDataset } from '../../with-bobang.ts';

afterEach(cleanup);

describe('RecipeConnections', () => {
  it('uses tile design for the summary and opens debug with its computed problem', async () => {
    const user = userEvent.setup();
    let debugged: unknown;
    const row = cpuCell.recipes.find(({ recipe }) => recipe === 'angels-liquid-molten-silicon')!;
    render(
      <DatasetProvider value={defaultDataset}>
        <RecipeConnections
          connections={{ inputs: [], outputs: [] }}
          solved
          belt={defaultDataset.data.belts['bob-ultimate-transport-belt']}
          recipe={row.recipe}
          machine="angels-chemical-furnace-3"
          inputRates={new Map([['item:angels-ingot-silicon', row.inputs[0].rate / row.count]])}
          outputRates={
            new Map([['fluid:angels-liquid-molten-silicon', row.outputs[0].rate / row.count]])
          }
          machineCount={row.count}
          progress={1}
          onSelectResource={() => undefined}
          onDebugProblem={(problem) => {
            debugged = problem;
          }}
        />
      </DatasetProvider>,
    );

    const table = screen.getByRole('table', { name: 'Found kernel layouts' });
    expect(within(table).getByRole('columnheader', { name: 'Buildings/column' })).toBeTruthy();
    expect(within(table).getAllByRole('row').length).toBeGreaterThan(1);
    expect(within(table).getAllByRole('rowheader', { name: 'General' }).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Debug design' }));
    expect(debugged).toMatchObject({
      inputs: { solids: { 'item:angels-ingot-silicon': expect.any(Number) } },
      outputs: { fluids: { 'fluid:angels-liquid-molten-silicon': expect.any(Number) } },
      assemblers: [{ name: 'angels-liquid-molten-silicon' }],
    });
  });
  it('displays both regular and HIGH results requiring two repeats', () => {
    render(
      <DatasetProvider value={defaultDataset}>
        <RecipeConnections
          connections={{ inputs: [], outputs: [] }}
          solved
          belt={defaultDataset.data.belts['bob-ultimate-transport-belt']}
          recipe="bob-processing-electronics"
          machine="assembling-machine-2"
          inputRates={
            new Map([
              ['fluid:angels-liquid-sulfuric-acid', 28],
              ['item:bob-silicon-wafer', 16.799999999999997],
              ['item:angels-wire-platinum', 14],
              ['item:bob-silicon-nitride', 2.8],
            ])
          }
          outputRates={new Map([['item:bob-processing-electronics', 30.799999999999997]])}
          machineCount={17}
          progress={1}
          onSelectResource={() => undefined}
        />
      </DatasetProvider>,
    );
    const table = screen.getByRole('table', { name: 'Found kernel layouts' });
    expect(within(table).getByRole('row', { name: /General ×2 / })).toBeTruthy();
    expect(within(table).getByRole('row', { name: /HIGH single ×2 / })).toBeTruthy();
  });
});
