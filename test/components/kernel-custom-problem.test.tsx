// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { useState } from 'preact/hooks';
import { afterEach, describe, expect, it } from 'vitest';
import type { KernelCustomState, UrlState } from '../../src/boot/url-handler.tsx';
import { KernelCustomProblem } from '../../src/components/kernel-custom-problem.tsx';
import { resourceIconStyle } from '../../src/components/icon.tsx';
import { field } from '../../src/ts.ts';

const throughput = {
  beltItemsPerSecond: 15,
  inserterItemsPerSecond: 2,
  longInserterItemsPerSecond: 1,
};

function CustomProblemExample({
  initial,
  currentThroughput = throughput,
}: {
  initial?: KernelCustomState;
  currentThroughput?: typeof throughput;
}) {
  const uss = useState<UrlState>({
    v: 1,
    cs: '',
    gp: 0,
    cl: [],
    ci: 0,
    mo: {},
    kd: {},
    kp: initial,
  });
  return (
    <>
      <KernelCustomProblem throughput={currentThroughput} custom={field(uss, 'kp')} />
      <output aria-label="Saved custom problem">{JSON.stringify(uss[0].kp)}</output>
    </>
  );
}

describe('KernelCustomProblem', () => {
  afterEach(cleanup);

  it('offers a chemical plant, flare stack, and powderiser as building choices', async () => {
    const user = userEvent.setup();
    render(<CustomProblemExample />);
    const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Building' });

    for (const [value, label] of [
      ['chemical-plant', 'Chemical plant'],
      ['flare-stack', 'Flare stack'],
      ['casting-machine', 'Casting machine'],
      ['powderiser', 'Powderiser'],
    ] as const) {
      await user.selectOptions(select, value);
      expect(
        within(screen.getByLabelText('Your problem result')).getByRole('heading', { name: label }),
      ).toBeTruthy();
      expect(JSON.parse(screen.getByLabelText('Saved custom problem').textContent!).building).toBe(
        value,
      );
    }
  });

  it('follows overall throughput until edited and resumes following after reset', async () => {
    const user = userEvent.setup();
    const view = render(<CustomProblemExample />);
    const group = screen.getByRole('group', { name: 'Throughputs' });
    const reset = within(group).getByRole('button', {
      name: 'Reset throughputs to overall game progress',
    });
    const belt = within(group).getByRole<HTMLInputElement>('slider', { name: 'Belt throughput' });

    expect(reset.hasAttribute('disabled')).toBe(true);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Building' }), 'air-filter');
    expect(
      JSON.parse(screen.getByLabelText('Saved custom problem').textContent!),
    ).not.toHaveProperty('rates');

    view.rerender(
      <CustomProblemExample currentThroughput={{ ...throughput, beltItemsPerSecond: 30 }} />,
    );
    expect(belt.value).toBe('30');

    fireEvent.input(belt, { target: { value: '40' } });
    expect(reset.hasAttribute('disabled')).toBe(false);
    view.rerender(
      <CustomProblemExample currentThroughput={{ ...throughput, beltItemsPerSecond: 45 }} />,
    );
    expect(belt.value).toBe('40');

    await user.click(reset);
    expect(belt.value).toBe('45');
    expect(reset.hasAttribute('disabled')).toBe(true);
    expect(JSON.parse(screen.getByLabelText('Saved custom problem').textContent!)).toEqual({
      building: 'air-filter',
      flows: { solidInputs: [5], fluidInputs: [], solidOutputs: [2], fluidOutputs: [] },
    });
  });

  it('restores its building, flows, and rates from saved URL state', async () => {
    const user = userEvent.setup();
    const view = render(<CustomProblemExample />);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Building' }), 'air-filter');
    fireEvent.input(screen.getByRole('slider', { name: 'Belt throughput' }), {
      target: { value: '30.1' },
    });
    fireEvent.input(screen.getByRole('slider', { name: 'Input items 1 rate' }), {
      target: { value: '12.5' },
    });
    await user.click(
      within(screen.getByRole('group', { name: 'Inputs' })).getByRole('button', {
        name: 'Add fluid',
      }),
    );
    await user.click(
      within(screen.getByRole('group', { name: 'Outputs' })).getByRole('button', {
        name: 'Remove item 1',
      }),
    );
    await user.click(
      within(screen.getByRole('group', { name: 'Outputs' })).getByRole('button', {
        name: 'Add fluid',
      }),
    );

    const saved = JSON.parse(
      screen.getByLabelText('Saved custom problem').textContent!,
    ) as KernelCustomState;
    expect(saved).toEqual({
      building: 'air-filter',
      flows: { solidInputs: [12.5], fluidInputs: [200], solidOutputs: [], fluidOutputs: [200] },
      rates: { ...throughput, beltItemsPerSecond: 30.1 },
    });

    view.unmount();
    render(<CustomProblemExample initial={saved} />);
    expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Building' }).value).toBe(
      'air-filter',
    );
    expect(screen.getByRole<HTMLInputElement>('slider', { name: 'Belt throughput' }).value).toBe(
      '30.1',
    );
    expect(screen.getByRole<HTMLInputElement>('slider', { name: 'Input items 1 rate' }).value).toBe(
      '12.5',
    );
    const result = screen.getByLabelText('Your problem result');
    expect(within(result).getByRole('heading', { name: 'Air filter 5×5' })).toBeTruthy();
    expect(within(result).getByLabelText('200 fluid:1')).toBeTruthy();
    expect(within(result).getByLabelText('200 fluid:2')).toBeTruthy();
  });

  it('previews the colour of each item and fluid that will be added', async () => {
    const user = userEvent.setup();
    render(<CustomProblemExample />);

    for (const [groupName, buttonName] of [
      ['Inputs', 'Add item'],
      ['Outputs', 'Add fluid'],
    ] as const) {
      const group = screen.getByRole('group', { name: groupName });
      expect(within(group).getByRole('button', { name: 'Add item' })).toBeTruthy();
      expect(within(group).getByRole('button', { name: 'Add fluid' })).toBeTruthy();
      const addButton = within(group).getByRole('button', { name: buttonName });
      const previewColour = addButton.querySelector('path')?.getAttribute('fill');
      expect(previewColour).toBeTruthy();
      await user.click(addButton);
      const addedIcons = group.querySelectorAll(
        '.kernel-custom-flow .kernel-custom-resource-icon path',
      );
      expect(addedIcons[addedIcons.length - 1]?.getAttribute('fill')).toBe(previewColour);
    }
  });

  it('groups inline throughput sliders with their transport icons', () => {
    render(<CustomProblemExample />);

    const group = screen.getByRole('group', { name: 'Throughputs' });
    expect(group.parentElement).toBe(screen.getByRole('group', { name: 'Inputs' }).parentElement);
    expect(group.parentElement).toBe(screen.getByRole('group', { name: 'Outputs' }).parentElement);
    for (const [label, item, title] of [
      ['Belt throughput', 'bob-ultimate-transport-belt', 'Belt throughput in items per second'],
      [
        'Inserter throughput',
        'bob-express-bulk-inserter',
        'Regular 180 degree bulk inserter throughput in items per second',
      ],
      [
        'Long inserter throughput',
        'bob-red-bulk-inserter',
        'Regular 180 degree 2-tile long inserter throughput in items per second',
      ],
    ] as const) {
      const slider = within(group).getByRole('slider', { name: label });
      expect(slider.closest('.kernel-custom-slider.is-inline')).toBeTruthy();
      expect(slider.closest('.kernel-custom-slider')?.getAttribute('title')).toBe(title);
      const icon = slider
        .closest('.kernel-custom-slider')
        ?.querySelector<HTMLElement>('.kernel-custom-transport-icon > span');
      const expected = document.createElement('span');
      expected.style.cssText = resourceIconStyle(`item:${item}`);
      expect(icon?.style.cssText).toBe(expected.style.cssText);
    }
  });

  it('updates the result card as flows, building, and rates change', async () => {
    const user = userEvent.setup();
    render(<CustomProblemExample />);

    const result = screen.getByLabelText('Your problem result');
    expect(within(result).getByRole('heading', { name: 'Assembler 2' })).toBeTruthy();
    expect(within(result).getByLabelText('5 item 1')).toBeTruthy();
    const inputItems = screen.getByRole('group', { name: 'Inputs' });
    expect(within(inputItems).queryByText('item 1')).toBeNull();
    expect(
      inputItems.querySelector('.kernel-custom-resource-icon path')?.getAttribute('fill'),
    ).toBe(within(result).getByLabelText('5 item 1').querySelector('path')?.getAttribute('fill'));

    await user.click(
      within(screen.getByRole('group', { name: 'Inputs' })).getByRole('button', {
        name: 'Add fluid',
      }),
    );
    expect(within(result).getByLabelText('200 fluid:1')).toBeTruthy();
    const inputFluids = screen.getByRole('group', { name: 'Inputs' });
    expect(within(inputFluids).queryByText('fluid:1')).toBeNull();
    expect(
      inputFluids
        .querySelector('.kernel-custom-fluid .kernel-custom-resource-icon path')
        ?.getAttribute('fill'),
    ).toBe(
      within(result).getByLabelText('200 fluid:1').querySelector('path')?.getAttribute('fill'),
    );

    await user.click(
      within(screen.getByRole('group', { name: 'Outputs' })).getByRole('button', {
        name: 'Remove item 1',
      }),
    );
    expect(within(result).queryByLabelText('2 item 2')).toBeNull();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Building' }), 'air-filter');
    expect(within(result).getByRole('heading', { name: 'Air filter 5×5' })).toBeTruthy();

    const itemRate = screen.getByRole('slider', { name: 'Input items 1 rate' });
    fireEvent.input(itemRate, { target: { value: '5.1' } });
    expect(within(result).getByLabelText('5.1 item 1')).toBeTruthy();

    const beltRate = screen.getByRole('slider', { name: 'Belt throughput' });
    fireEvent.input(beltRate, { target: { value: '15.1' } });
    expect(screen.getByText('15.1/s')).toBeTruthy();
  });
});
