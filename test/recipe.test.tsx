// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { staticData } from '../src/data/index.ts';
import { machinesFor } from '../src/data/machines.ts';
import { RecipeCard } from '../src/components/recipe.tsx';

afterEach(cleanup);

describe('RecipeCard', () => {
  it('previews a machine while it is hovered and restores auto selection afterwards', () => {
    const recipe = staticData.recipes['iron-gear-wheel'];
    const machine = machinesFor(recipe)[0]!;
    const { container } = render(
      <RecipeCard
        match={{ id: 'iron-gear-wheel', recipe, name: recipe.human ?? 'Iron gear wheel' }}
        onPick={() => undefined}
        progress={0}
      />,
    );

    const card = container.firstElementChild!;
    const machineButton = screen.getByRole('button', { name: new RegExp(`\\(${machine.id}\\)`) });
    fireEvent.mouseEnter(machineButton);
    expect(card.classList.contains('is-previewing')).toBe(true);

    fireEvent.mouseLeave(machineButton.parentElement!);
    expect(card.classList.contains('is-previewing')).toBe(false);
  });

  it('adds a recipe in the machine selected from its machine list', async () => {
    const user = userEvent.setup();
    const recipe = staticData.recipes['iron-gear-wheel'];
    const machine = machinesFor(recipe)[0]!;
    const onAdd = vi.fn();

    render(
      <RecipeCard
        match={{ id: 'iron-gear-wheel', recipe, name: recipe.human ?? 'Iron gear wheel' }}
        onPick={() => undefined}
        onAdd={onAdd}
        progress={0}
      />,
    );

    await user.click(screen.getByRole('button', { name: new RegExp(`\\(${machine.id}\\)`) }));
    await user.click(screen.getByRole('button', { name: 'Add to this cell' }));

    expect(onAdd).toHaveBeenCalledWith(machine.id);
  });

  it('returns to automatic machine choice when the selected machine is clicked again', async () => {
    const user = userEvent.setup();
    const recipe = staticData.recipes['iron-gear-wheel'];
    const machine = machinesFor(recipe)[0]!;
    const onAdd = vi.fn();

    render(
      <RecipeCard
        match={{ id: 'iron-gear-wheel', recipe, name: recipe.human ?? 'Iron gear wheel' }}
        onPick={() => undefined}
        onAdd={onAdd}
        progress={0}
      />,
    );

    const machineButton = screen.getByRole('button', { name: new RegExp(`\\(${machine.id}\\)`) });
    await user.click(machineButton);
    await user.click(machineButton);
    await user.click(screen.getByRole('button', { name: 'Add to this cell' }));

    expect(onAdd).toHaveBeenCalledWith(undefined);
  });
});
