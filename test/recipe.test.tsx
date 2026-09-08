// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { staticData } from '../src/data/index.ts';
import { defaultMachine, machinesFor } from '../src/data/machines.ts';
import { RecipeCard } from '../src/components/recipe.tsx';

afterEach(cleanup);

describe('RecipeCard', () => {
  it('shows expanded flow rates to two decimal places per second', async () => {
    const user = userEvent.setup();
    const recipe = staticData.recipes['iron-gear-wheel'];
    const { container } = render(
      <RecipeCard
        match={{ id: 'iron-gear-wheel', recipe, name: recipe.human ?? 'Iron gear wheel' }}
        onPick={() => undefined}
        progress={0}
      />,
    );

    await user.click(container.querySelector('[title="Unfold the ingredients"]')!);

    expect(screen.getByText('4.00/s')).toBeDefined();
    expect(screen.getByText('2.00/s')).toBeDefined();
  });

  it('uses compact fractions for quarter-based machine speeds', () => {
    const recipe = staticData.recipes['iron-gear-wheel'];
    const { container } = render(
      <RecipeCard
        match={{ id: 'iron-gear-wheel', recipe, name: recipe.human ?? 'Iron gear wheel' }}
        onPick={() => undefined}
        progress={0}
      />,
    );

    const speeds = [...container.querySelectorAll('.machine-list .machine-speed')].map(
      (speed) => speed.textContent,
    );
    expect(speeds).toContain('¾×');
    expect(speeds).toContain('1¼×');
    expect(
      screen.queryByRole('button', { name: /beacons? around the default assembler/ }),
    ).toBeNull();
  });

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

  it('previews additive beacons against the default assembler', async () => {
    const user = userEvent.setup();
    const recipe = staticData.recipes['iron-gear-wheel'];
    const machines = machinesFor(recipe);
    const defaultMatch = defaultMachine(machines, 0.5)!;
    const { container } = render(
      <RecipeCard
        match={{ id: 'iron-gear-wheel', recipe, name: recipe.human ?? 'Iron gear wheel' }}
        onPick={() => undefined}
        progress={0.5}
        chosen={{
          modules: { speed: 'speed-module' },
          beacon: staticData.beacons['beacon'],
          belt: staticData.belts['transport-belt'],
        }}
      />,
    );

    const beacons = screen.getAllByRole('button', {
      name: /beacons? around the default assembler/,
    });
    const baselineDuration = Number(
      container.querySelector('.recipe-duration')!.textContent!.slice(0, -1),
    );
    expect(beacons).toHaveLength(3);
    expect(container.querySelector('.machine-list .recipe-beacons')).not.toBeNull();
    expect(beacons.map((beacon) => beacon.getAttribute('aria-label'))).toEqual([
      '1 beacon around the default assembler',
      '2 beacons around the default assembler',
      '3 beacons around the default assembler',
    ]);

    fireEvent.mouseEnter(beacons[1]!);
    expect(container.querySelectorAll('.recipe-beacon.is-active')).toHaveLength(2);
    expect(
      Number(container.querySelector('.recipe-duration')!.textContent!.slice(0, -1)),
    ).toBeLessThan(baselineDuration);
    expect(
      container.querySelector(`.machine-list .machine.is-active[aria-label*="${defaultMatch.id}"]`),
    ).not.toBeNull();

    await user.click(beacons[1]!);
    fireEvent.mouseLeave(beacons[1]!.parentElement!);
    expect(container.querySelectorAll('.recipe-beacon.is-active')).toHaveLength(2);

    const hoveredMachine = machines.find(({ id }) => id !== defaultMatch.id)!;
    fireEvent.mouseEnter(
      screen.getByRole('button', { name: new RegExp(`\\(${hoveredMachine.id}\\)`) }),
    );
    expect(container.querySelectorAll('.recipe-beacon.is-active')).toHaveLength(0);
    expect(
      container.querySelector(
        `.machine-list .machine.is-active[aria-label*="${hoveredMachine.id}"]`,
      ),
    ).not.toBeNull();
  });
});
