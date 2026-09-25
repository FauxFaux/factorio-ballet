// @vitest-environment happy-dom
import { cleanup, screen, within } from '@testing-library/preact';
import { render } from '../../render-with-dataset.tsx';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import state from '../../assets/uranium.state.json';
import type { Cell } from '../../../src/cell.ts';
import { resolveChosen, resourceName } from '../../../src/data';
import { CellBox } from '../../../src/components/cell/box.tsx';
import { RecipeConnections } from '../../../src/components/cell/connections.tsx';

const cell: Cell = state.cl[0];
const chosen = resolveChosen({}, undefined, undefined, state.gp);

afterEach(cleanup);

function renderCell() {
  return render(
    <CellBox
      cell={[cell, () => {}]}
      active
      progress={state.gp}
      chosen={chosen}
      onActivate={() => {}}
      onRemove={() => {}}
      onSearch={() => {}}
    />,
  );
}

describe('cell display modes', () => {
  it('uses per-machine rates for the silicon-powder 2×2 kernel', () => {
    render(
      <RecipeConnections
        connections={{ inputs: [], outputs: [] }}
        solved
        belt={{ human: 'test belt', itemsPerSecond: 45, undergroundLength: 7 }}
        recipe="bob-silicon-powder"
        machine="angels-powderizer"
        inputRates={new Map([['item:angels-ingot-silicon', 15]])}
        outputRates={new Map([['item:bob-silicon-powder', 15]])}
        machineCount={1.5444015444015442}
        progress={1}
        onSelectResource={() => {}}
      />,
    );

    expect(screen.getByLabelText('Tile design')).toBeTruthy();
  });

  it('summarizes the 2×2 oxygen flare with no output', () => {
    render(
      <RecipeConnections
        connections={{ inputs: [], outputs: [] }}
        solved
        belt={{ human: 'test belt', itemsPerSecond: 45, undergroundLength: 7 }}
        recipe="angels-chemical-void-angels-gas-oxygen"
        machine="angels-flare-stack"
        inputRates={new Map([['fluid:angels-gas-oxygen', 307.06800094555194]])}
        outputRates={new Map()}
        machineCount={0.7676700023638798}
        progress={1}
        onSelectResource={() => {}}
      />,
    );

    const summary = screen.getByLabelText('Tile design');
    expect(
      within(summary).getByText('Columns/modules needed').nextElementSibling?.textContent,
    ).toBe('×1');
  });

  it('summarizes air separation with two fluid outputs', () => {
    render(
      <RecipeConnections
        connections={{ inputs: [], outputs: [] }}
        solved
        belt={{ human: 'test belt', itemsPerSecond: 45, undergroundLength: 7 }}
        recipe="angels-air-separation"
        machine="chemical-plant"
        inputRates={new Map([['fluid:angels-gas-compressed-air', 614.1360018911039]])}
        outputRates={
          new Map([
            ['fluid:angels-gas-nitrogen', 307.06800094555194],
            ['fluid:angels-gas-oxygen', 307.06800094555194],
          ])
        }
        machineCount={1.2597661577253414}
        progress={1}
        onSelectResource={() => {}}
      />,
    );

    expect(screen.getByLabelText('Tile design')).toBeTruthy();
  });

  it('folds recipe rows into icons whose controls live in their expanders', async () => {
    const user = userEvent.setup();
    const { container } = renderCell();

    expect(container.querySelector('.cell-recipes.is-horizontal')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Show recipes horizontally' }));

    const recipes = container.querySelectorAll<HTMLElement>('.cell-recipe.is-compact');
    expect(recipes).toHaveLength(cell.entries.length);
    expect(within(recipes[0]!).getByRole('spinbutton', { name: 'Machine count' })).toBeTruthy();
    expect(within(recipes[0]!).queryByRole('button', { name: 'Remove this recipe' })).toBeNull();

    await user.click(within(recipes[0]!).getByRole('button', { name: /^Show details for / }));
    expect(within(recipes[0]!).getByRole('button', { name: 'Remove this recipe' })).toBeTruthy();
    expect(recipes[0]!.querySelector('.cell-recipe-connections')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Show recipes vertically' }));
    expect(container.querySelector('.cell-recipes.is-horizontal')).toBeNull();
    expect(container.querySelector('.cell-recipe.is-compact')).toBeNull();
    expect(
      container.querySelector('.cell-recipe.is-expanded .cell-recipe-connections'),
    ).toBeTruthy();
  });

  it('unfolds resources into rows with actions and expandable connections', async () => {
    const user = userEvent.setup();
    const { container } = renderCell();
    const resource = 'item:uranium-ore';
    const name = resourceName(resource);

    expect(container.querySelector('.cell-in-play.is-vertical')).toBeNull();
    expect(screen.queryByRole('button', { name: `Search for recipes making ${name}` })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Show resources vertically' }));
    expect(container.querySelector('.cell-in-play.is-vertical')).toBeTruthy();
    expect(screen.getByRole('button', { name: `Search for recipes making ${name}` })).toBeTruthy();
    expect(screen.getByRole('button', { name: `Search for recipes using ${name}` })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: `Show recipes for ${name}` }));
    const row = container.querySelector<HTMLElement>(`[data-in-play-resource="${resource}"]`)!;
    expect(row.querySelector('.cell-in-play-connections')).toBeTruthy();
    expect(within(row).getByRole('button', { name: `Hide recipes for ${name}` })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Show resources horizontally' }));
    expect(container.querySelector('.cell-in-play.is-vertical')).toBeNull();
    expect(screen.getByRole('button', { name: `Hide recipes for ${name}` })).toBeTruthy();
  });

  it('summarizes the generated assembler design in a recipe expander', async () => {
    const user = userEvent.setup();
    render(
      <CellBox
        cell={[{ entries: [{ recipe: 'iron-plate' }] }, () => {}]}
        active
        progress={state.gp}
        chosen={chosen}
        onActivate={() => {}}
        onRemove={() => {}}
        onSearch={() => {}}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Show recipe connections' }));

    const summary = screen.getByLabelText('Tile design');
    expect(within(summary).getByText('Kernel size')).toBeTruthy();
    expect(within(summary).getByText(/\d+×\d+ tiles/)).toBeTruthy();
    expect(within(summary).getByText('Max column height')).toBeTruthy();
    expect(within(summary).getByText('Columns/modules needed')).toBeTruthy();
    expect(within(summary).getAllByText(/^×\d+$/)).toHaveLength(2);
  });

  it('uses the selected machine geometry for a fluid recipe', async () => {
    const user = userEvent.setup();
    render(
      <CellBox
        cell={[
          { entries: [{ recipe: 'bob-processing-electronics', machine: 'assembling-machine-2' }] },
          () => {},
        ]}
        active
        progress={state.gp}
        chosen={chosen}
        onActivate={() => {}}
        onRemove={() => {}}
        onSearch={() => {}}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Show recipe connections' }));

    const summary = document.querySelector('.cell-tile-design');
    expect(summary).toBeTruthy();
    expect(summary?.textContent).not.toContain('size or fluid-port geometry is missing');
  });
});
