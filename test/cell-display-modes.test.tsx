// @vitest-environment happy-dom
import { cleanup, render, screen, within } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import state from './assets/uranium.state.json';
import type { Cell } from '../src/cell.ts';
import { resolveChosen, resourceName } from '../src/data/index.ts';
import { CellBox } from '../src/components/cell/box.tsx';

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
});
