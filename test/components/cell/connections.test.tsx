// @vitest-environment happy-dom

import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import cpuCell from '../../../docs/cells/cpu.json';
import { RecipeConnections } from '../../../src/components/cell/connections.tsx';
import { staticData } from '../../../src/data/decode.ts';

describe('RecipeConnections', () => {
  it('uses per-machine rates when estimating the molten-silicon column height', () => {
    const row = cpuCell.recipes.find(({ recipe }) => recipe === 'angels-liquid-molten-silicon')!;
    render(
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
      />,
    );

    expect(
      screen.getByText('Max column height').closest('div')?.querySelector('dd')?.textContent,
    ).toBe('×2');
  });
});
