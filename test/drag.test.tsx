// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dropDestination,
  dropEdgeAt,
  rowDropTarget,
  useRowDrag,
  type RowDropTarget,
} from '../src/components/cell/drag.ts';

afterEach(cleanup);

describe('row drag targets', () => {
  it('uses the top and bottom halves of every row as its two edges', () => {
    expect(dropEdgeAt(109, 100, 20)).toBe('before');
    expect(dropEdgeAt(110, 100, 20)).toBe('after');
    expect(dropEdgeAt(119, 100, 20)).toBe('after');
  });

  it.each([
    { target: { insertion: 0 }, to: 0 },
    { target: { insertion: 1 }, to: 1 },
    { target: { insertion: 2 }, to: 2 },
    { target: { insertion: 5 }, to: 4 },
  ] satisfies { target: RowDropTarget; to: number }[])(
    'moves a later row to $to at insertion $target.insertion',
    ({ target, to }) => expect(dropDestination(3, target)).toBe(to),
  );

  it('represents both edges bordering a gap as one target', () => {
    expect(rowDropTarget(0, 'after')).toEqual(rowDropTarget(1, 'before'));
  });

  it('rejects both gaps bordering the dragged row as existing in place', () => {
    expect(dropDestination(1, { insertion: 1 })).toBeNull();
    expect(dropDestination(1, { insertion: 2 })).toBeNull();
  });

  it('adjusts destination indices after removing a row from earlier in the list', () => {
    expect(dropDestination(0, { insertion: 2 })).toBe(1);
    expect(dropDestination(0, { insertion: 3 })).toBe(2);
  });
});

function DragList() {
  const [rows, setRows] = useState(['A', 'B', 'C']);
  const dragFor = useRowDrag(rows.length, (from, to) =>
    setRows((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    }),
  );

  return (
    <div role="list">
      {rows.map((name, index) => {
        const drag = dragFor(index);
        const drop = drag.dropEdge ? `, drop ${drag.dropEdge}` : '';
        return (
          <div
            key={name}
            role="listitem"
            aria-label={`${name}${drop}`}
            draggable
            onDragStart={drag.onDragStart}
            onDragEnd={drag.onDragEnd}
            onDragOver={drag.onDragOver}
            onDrop={drag.onDrop}
          >
            {name}
          </div>
        );
      })}
    </div>
  );
}

function row(name: string, top: number): HTMLElement {
  const element = screen.getByRole('listitem', { name });
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
    top,
    bottom: top + 20,
    height: 20,
    left: 0,
    right: 100,
    width: 100,
    x: 0,
    y: top,
    toJSON: () => ({}),
  });
  return element;
}

describe('useRowDrag', () => {
  it('draws an interior gap only above the lower row', () => {
    render(<DragList />);

    fireEvent.dragStart(screen.getByRole('listitem', { name: 'C' }));
    /* happy-dom does not retain drag coordinates, so its events resolve to the lower half. */
    const a = row('A', -20);
    fireEvent.dragOver(a);
    expect(screen.getByRole('listitem', { name: 'B, drop before' })).toBeTruthy();
  });

  it('does not highlight or move at either gap bordering the dragged row', () => {
    render(<DragList />);

    fireEvent.dragStart(screen.getByRole('listitem', { name: 'B' }));
    const a = row('A', -20);
    fireEvent.dragOver(a);
    expect(screen.queryByRole('listitem', { name: /drop/ })).toBeNull();

    fireEvent.drop(row('A', -20));
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'A',
      'B',
      'C',
    ]);
  });

  it('drops into the highlighted interior gap', () => {
    render(<DragList />);

    fireEvent.dragStart(screen.getByRole('listitem', { name: 'C' }));
    const a = row('A', -20);
    fireEvent.dragOver(a);
    expect(screen.getByRole('listitem', { name: 'B, drop before' })).toBeTruthy();

    fireEvent.drop(row('A', -20));
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'A',
      'C',
      'B',
    ]);
  });
});
