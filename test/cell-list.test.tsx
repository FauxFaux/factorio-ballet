// @vitest-environment happy-dom

import { render, screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { useState } from 'preact/hooks';
import { describe, expect, it } from 'vitest';
import { CellList } from '../src/components/cell-list.tsx';
import type { Cell } from '../src/cell.ts';
import { NO_CHOICE } from '../src/data/index.ts';

function CellListExample() {
  const cells = useState<Cell[]>([]);
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

    expect(screen.getByRole('region', { name: 'Design 1' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Column 1' })).toBeTruthy();
  });
});
