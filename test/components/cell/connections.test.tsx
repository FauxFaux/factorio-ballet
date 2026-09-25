// @vitest-environment happy-dom

import { render, screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import cpuCell from '../../../docs/cells/cpu.json';
import { RecipeConnections } from '../../../src/components/cell/connections.tsx';
import { staticData } from '../../../src/data/decode.ts';
import { DatasetProvider } from '../../../src/dataset/context.tsx';
import { defaultDataset } from '../../../src/dataset/index.ts';

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
          belt={staticData.belts['bob-ultimate-transport-belt']}
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

    expect(
      screen.getByText('Max column height').closest('div')?.querySelector('dd')?.textContent,
    ).toBe('×1');
    await user.click(screen.getByRole('button', { name: 'Debug design' }));
    expect(debugged).toMatchObject({
      inputs: { solids: { 'item:angels-ingot-silicon': expect.any(Number) } },
      outputs: { fluids: { 'fluid:angels-liquid-molten-silicon': expect.any(Number) } },
      assemblers: [{ name: 'angels-liquid-molten-silicon' }],
    });
  });
});
