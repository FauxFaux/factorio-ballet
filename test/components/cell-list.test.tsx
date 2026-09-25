// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { useState } from 'preact/hooks';
import { afterEach, describe, expect, it } from 'vitest';
import { CellList } from '../../src/components/cell-list.tsx';
import { CellLayoutSurface } from '../../src/components/layout/layout.tsx';
import { newCell, type Cell } from '../../src/cell.ts';
import { NO_CHOICE } from '../../src/data';
import type { ResourceId } from '../../src/types.ts';

afterEach(cleanup);

function CellListExample({ cell = newCell() }: { cell?: Cell }) {
  const cells = useState<Cell[]>([cell]);
  const active = useState(0);
  return (
    <CellList
      cells={cells}
      active={active}
      progress={0}
      chosen={NO_CHOICE}
      setSearch={() => undefined}
    />
  );
}

const splitProposalEntries: Cell['entries'] = [
  'bob-processing-electronics',
  'bob-silicon-nitride',
  'bob-silicon-powder',
  'bob-silicon-wafer',
  'angels-mono-silicon',
  'angels-mono-silicon-seed',
  'angels-liquid-molten-silicon',
  'angels-chemical-void-angels-gas-oxygen',
  'angels-air-separation',
  'angels-gas-compressed-air',
].map((recipe, index) => ({ recipe, count: index === 0 ? 15 : undefined }));

describe('CellList', () => {
  it('adds a blank design with numbered placeholder columns', async () => {
    const user = userEvent.setup();
    render(<CellListExample />);

    await user.click(screen.getByRole('button', { name: '+ design' }));

    expect(screen.getByRole('region', { name: 'Design' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Column 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'remove design' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'remove design' }));

    expect(screen.queryByRole('region', { name: 'Design' })).toBeNull();
    expect(screen.getByRole('button', { name: '+ design' })).toBeTruthy();
  });

  it('adds a layout surface with its rail blueprint centred in the grid', async () => {
    const user = userEvent.setup();
    render(<CellListExample cell={newCell('copper-cable')} />);

    await user.click(screen.getByRole('button', { name: '+ layout' }));

    expect(screen.getByRole('region', { name: 'Layout' }).classList.contains('cell-layout')).toBe(
      true,
    );
    const blueprint = screen.getByRole('img', {
      name: 'Rail blueprint entities: 1 input, 1 output rail brick',
    });
    expect(blueprint.classList.contains('cell-layout-blueprint-entities')).toBe(true);
    expect(blueprint.getAttribute('viewBox')).toBe('0 0 192 128');
    expect(screen.getByRole('button', { name: 'remove layout' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'remove layout' }));

    expect(screen.queryByRole('region', { name: 'Layout' })).toBeNull();
    expect(screen.getByRole('button', { name: '+ layout' })).toBeTruthy();
  });

  it('places split proposals beside an existing layout', () => {
    render(
      <CellListExample
        cell={{
          entries: splitProposalEntries,
          layout: {},
        }}
      />,
    );

    const layout = screen.getByRole('region', { name: 'Layout' });
    const proposals = screen.getByRole('region', { name: 'Proposed splits' });
    expect(layout.parentElement).toBe(proposals.parentElement);
    expect(layout.parentElement?.classList.contains('cell-layout-row')).toBe(true);
  });

  it('does not display split proposals without a layout', () => {
    render(<CellListExample cell={{ entries: splitProposalEntries }} />);

    expect(screen.queryByRole('region', { name: 'Proposed splits' })).toBeNull();
  });

  it('uses the radar’s automatic stacked-input mode for a layout rail blueprint', () => {
    const inputs = Array.from({ length: 6 }, () => 'item:iron-plate' as ResourceId);
    const { container } = render(<CellLayoutSurface layout={{}} inputs={inputs} outputs={[]} />);

    expect(
      screen.getByRole('img', {
        name: 'Rail blueprint entities: 6 stacked input, 0 output rail brick',
      }),
    ).toBeTruthy();
    expect(container.querySelector('[data-layout-station="1"]')?.getAttribute('transform')).toBe(
      'translate(48 112)',
    );
  });

  it('places solid-request footprints on the rendered input rails', () => {
    const inputs: ResourceId[] = ['item:iron-plate', 'item:copper-plate'];
    const { container } = render(<CellLayoutSurface layout={{}} inputs={inputs} outputs={[]} />);

    expect(screen.getByLabelText('2 input station footprints')).toBeTruthy();
    expect(container.querySelector('[data-layout-station="1"]')?.getAttribute('transform')).toBe(
      'translate(9 89)',
    );
    expect(container.querySelector('[data-layout-station="2"]')?.getAttribute('transform')).toBe(
      'translate(21 81)',
    );
    expect(
      container
        .querySelector('[data-layout-station="1"] [data-layout-resource]')
        ?.getAttribute('data-layout-resource'),
    ).toBe('item:iron-plate');
    expect(
      container
        .querySelector('[data-layout-station="2"] [data-layout-resource]')
        ?.getAttribute('data-layout-resource'),
    ).toBe('item:copper-plate');
    expect(container.querySelectorAll('[data-layout-building]')).toHaveLength(8);
    expect(container.querySelector('[data-layout-building="-2,-17"]')?.getAttribute('x')).toBe(
      '-4',
    );
    expect(container.querySelector('[data-layout-building="6,-17"]')?.getAttribute('x')).toBe('3');
    expect(container.querySelector('[data-layout-building="-2,-17"]')?.getAttribute('width')).toBe(
      '5',
    );
    expect(container.querySelector('[data-layout-building="6,-17"]')?.getAttribute('width')).toBe(
      '5',
    );
    expect(container.querySelector('[data-layout-building="-2,-17"]')?.getAttribute('y')).toBe(
      '-20.5',
    );
    expect(container.querySelector('[data-layout-building="-2,-17"]')?.getAttribute('height')).toBe(
      '7',
    );
    expect(container.querySelector('[data-layout-splitter="5,4.5"]')?.getAttribute('x')).toBe('4');
    expect(container.querySelector('[data-layout-splitter="7,4.5"]')?.getAttribute('x')).toBe('6');
  });

  it('places solid-provide footprints on the rendered output rails', () => {
    const outputs: ResourceId[] = ['item:iron-plate', 'item:copper-plate'];
    const { container } = render(<CellLayoutSurface layout={{}} inputs={[]} outputs={outputs} />);

    expect(screen.getByLabelText('2 output station footprints')).toBeTruthy();
    expect(
      container.querySelector('[data-layout-output-station="1"]')?.getAttribute('transform'),
    ).toBe('translate(183 39)');
    expect(
      container.querySelector('[data-layout-output-station="2"]')?.getAttribute('transform'),
    ).toBe('translate(171 47)');
    expect(
      container
        .querySelector('[data-layout-output-station="1"] [data-layout-resource]')
        ?.getAttribute('data-layout-resource'),
    ).toBe('item:iron-plate');
    expect(
      container
        .querySelector('[data-layout-output-station="2"] [data-layout-resource]')
        ?.getAttribute('data-layout-resource'),
    ).toBe('item:copper-plate');
    expect(container.querySelectorAll('[data-layout-output-building]')).toHaveLength(4);
    expect(
      container.querySelector('[data-layout-output-building="-6,10"]')?.getAttribute('x'),
    ).toBe('-8');
    expect(
      container.querySelector('[data-layout-output-building="-6,10"]')?.getAttribute('y'),
    ).toBe('6.5');
    expect(
      container.querySelector('[data-layout-output-belt="north"]')?.getAttribute('width'),
    ).toBe('4');
  });

  it('fills a design column with the solved number of a recipe’s assemblers', async () => {
    const user = userEvent.setup();
    render(<CellListExample cell={newCell('copper-cable')} />);

    await user.click(screen.getByRole('button', { name: '+ design' }));

    const recipe = screen.getByRole('button', { name: 'Set Copper wire assemblers to 1' });
    expect((recipe as HTMLButtonElement).disabled).toBe(false);

    await user.click(recipe);

    expect((recipe as HTMLButtonElement).disabled).toBe(true);
    expect(recipe.closest('section')?.dataset.entityCount).toBe('1');
  });

  it('places added assemblers at the nearest free position to the design origin', async () => {
    const user = userEvent.setup();
    render(
      <CellListExample
        cell={{
          ...newCell('copper-cable'),
          design: {
            columns: [
              { entities: [{ kind: 'belt', position: { x: 0, y: 0 }, direction: 'east' }] },
            ],
          },
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Set Copper wire assemblers to 1' }));

    expect(screen.getByRole('img', { name: 'Copper wire assembler at 0, -1' })).toBeTruthy();
  });
});
