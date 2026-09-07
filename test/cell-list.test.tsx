// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { useState } from 'preact/hooks';
import { afterEach, describe, expect, it } from 'vitest';
import { CellList } from '../src/components/cell-list.tsx';
import { newCell, type Cell } from '../src/cell.ts';
import { NO_CHOICE } from '../src/data/index.ts';

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

describe('CellList', () => {
  it('adds a blank design with numbered placeholder columns', async () => {
    const user = userEvent.setup();
    render(<CellListExample />);

    await user.click(screen.getByRole('button', { name: '+ design' }));

    expect(screen.getByRole('region', { name: 'Design' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Column 1' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '+ design' })).toBeNull();
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
