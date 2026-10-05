// @vitest-environment happy-dom

import { cleanup, render, screen, within } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import cpuCell from '../../../docs/cells/cpu.json';
import { RecipeConnections } from '../../../src/components/cell/connections.tsx';
import { DatasetProvider } from '../../../src/dataset/context.tsx';
import { defaultDataset } from '../../with-bobang.ts';
import { parseEnvelope } from '../../../src/boot/url-envelope.ts';
import { createIdTables, unpackCells } from '../../../src/boot/pack.ts';
import { entryMachine } from '../../../src/cell.ts';
import { resolveChosen } from '../../../src/data/index.ts';
import { solveCell } from '../../../src/solve/index.ts';
import { kernelCustomStateFor } from '../../../src/components/kernel-debug.tsx';
import { machineProblem, type KernelProblem } from '../../../src/compute/kernel-problems.ts';

afterEach(cleanup);

describe('RecipeConnections', () => {
  it('shows multi-building HIGH columns for the saved CPU plan and debugs its actual footprint', async () => {
    const envelope = parseEnvelope(
      '#yju7jZgxDoAgDEXvwm6CYkLifVxcjff3tVQjFYwjoTC07_9SyBmASw3_AT5mJKPqIeYNUHtLyu3Z-IAKjrs3KdPdPb-OTmW1PqJfz5Uqp5Sq84XLJ4hBXWuxpJun3YO3GDFpVjgsRJ9k1xwIfYHPJ1ocKDSRslPFuktv5kLx9n012yJk2I5sZNGZDC3KrfU9AQ',
    );
    if (envelope.kind !== 'ok') throw new Error(envelope.kind);
    const ds = defaultDataset;
    const [cell] = unpackCells(envelope.packed.cl, createIdTables(ds.data));
    const progress = envelope.packed.gp / 100;
    const chosen = resolveChosen(ds, envelope.packed.mo, undefined, undefined, progress);
    const solution = solveCell(ds, ds.data, cell, progress, chosen);
    const entry = cell.entries[0];
    const machine = entryMachine(entry, ds.data.recipes[entry.recipe], progress, ds);
    expect(machine).toBe('bob-electronics-machine-3');
    expect(solution.counts[0]).toBe(17);
    expect(solution.outputRates[0].get('item:bob-processing-electronics')).toBeCloseTo(30.8);
    const debug = vi.fn<(problem: KernelProblem) => void>();
    render(
      <DatasetProvider value={ds}>
        <RecipeConnections
          connections={{ inputs: [], outputs: [] }}
          solved
          belt={chosen.belt}
          recipe={entry.recipe}
          machine={machine}
          inputRates={solution.inputRates[0]}
          outputRates={solution.outputRates[0]}
          machineCount={solution.counts[0]}
          progress={progress}
          onSelectResource={() => undefined}
          onDebugProblem={debug}
        />
      </DatasetProvider>,
    );
    const table = screen.getByRole('table', { name: 'Found kernel layouts' });
    const single = within(table).getByRole('row', { name: /HIGH single ×2 / });
    expect(within(single).getAllByRole('cell')[3].textContent).toBe('1–2');
    expect(within(single).getAllByRole('cell')[4].textContent).toBe('2');
    const pair = within(table).getByRole('row', { name: /HIGH pair ×1 / });
    expect(within(pair).getAllByRole('cell')[3].textContent).toBe('2');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Debug design' }));
    const problem = debug.mock.calls[0][0];
    expect(problem.assemblers[0]).toMatchObject({ machine, size: { width: 2, height: 2 } });
    const custom = kernelCustomStateFor(problem, undefined, ds.data)!;
    expect(custom.building).toBe(`machine:${machine}`);
    const debugProblem = machineProblem(
      ds.data,
      custom.building as `machine:${string}`,
      custom.flows,
    );
    expect(debugProblem.assemblers[0].size).toEqual(problem.assemblers[0].size);
    expect(debugProblem.assemblers[0].fluidBoxes).toEqual(problem.assemblers[0].fluidBoxes);
  });

  it('complains when Debug design cannot match the selected machine', async () => {
    const debug = vi.fn();
    render(
      <DatasetProvider value={defaultDataset}>
        <RecipeConnections
          connections={{ inputs: [], outputs: [] }}
          solved
          belt={defaultDataset.data.belts['bob-ultimate-transport-belt']}
          recipe="bob-processing-electronics"
          machine="missing-machine"
          inputRates={new Map([['item:bob-silicon-wafer', 1]])}
          outputRates={new Map([['item:bob-processing-electronics', 1]])}
          machineCount={1}
          progress={1}
          onSelectResource={() => undefined}
          onDebugProblem={debug}
        />
      </DatasetProvider>,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Debug design' }));
    expect(screen.getByRole('alert').textContent).toContain('No matching machine');
    expect(debug).not.toHaveBeenCalled();
  });
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
          connections={{
            inputs: [
              {
                resource: 'item:bob-silicon-wafer',
                rate:
                  17 *
                  defaultDataset.data.belts['bob-ultimate-transport-belt'].itemsPerSecond *
                  0.3,
              },
            ],
            outputs: [{ resource: 'fluid:angels-liquid-sulfuric-acid', rate: 5.1 }],
          }}
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
    expect(screen.getByText('½/m')).toBeTruthy();
    expect(screen.getByTitle('0.3 belts per machine (display rounded up)')).toBeTruthy();
    expect(screen.getAllByLabelText(/belts per machine, rounded up/)).toHaveLength(1);
    expect(screen.queryByText('½/s/machine')).toBeNull();
    expect(within(table).getByRole('row', { name: /General ×2 / })).toBeTruthy();
    expect(within(table).getByRole('row', { name: /HIGH single ×2 / })).toBeTruthy();
  });
});
