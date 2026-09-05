import { useState } from 'preact/hooks';

/**
 * Everything one row needs to take part in reordering: whether it is the row being dragged, which
 * of its edges the drop line is on, and the four handlers. One object rather than seven props
 * because a row does not decide any of it — the list does, and the row only wires it up.
 */
export type RowDrag = {
  /** Whether this is the row currently being dragged, for the fade the rest of the list gets. */
  dragging: boolean;
  /** Which edge the dragged row would land at; absent when that position cannot move it. */
  dropEdge: DropEdge | null;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
};

export type DropEdge = 'before' | 'after';

/** A canonical location between rows: zero is before the first row, `rowCount` is after the last. */
export type RowDropTarget = {
  insertion: number;
};

/**
 * Drag-to-reorder for a list of rows: holds which row is in the air and where it would land, and
 * hands each row its own `RowDrag`. `onMove` is called with the two indices once, on a drop which
 * actually moves something.
 */
export function useRowDrag(
  rowCount: number,
  onMove: (from: number, to: number) => void,
): (i: number) => RowDrag {
  /** The row being dragged, by index; `null` when no drag is in progress. */
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  /** Which side of which row the dragged one would land on, for the drop-line indicator. */
  const [dropHint, setDropHint] = useState<RowDropTarget | null>(null);
  const clear = () => {
    setDragIndex(null);
    setDropHint(null);
  };

  return (i: number) => ({
    dragging: dragIndex === i,
    dropEdge:
      dropHint?.insertion === i
        ? 'before'
        : i === rowCount - 1 && dropHint?.insertion === rowCount
          ? 'after'
          : null,
    onDragStart: () => setDragIndex(i),
    onDragEnd: clear,
    onDragOver: (e: DragEvent) => {
      if (dragIndex === null) return;
      e.preventDefault();
      const target = eventTarget(i, e);
      const valid = dropDestination(dragIndex, target) === null ? null : target;
      if (e.dataTransfer) e.dataTransfer.dropEffect = valid ? 'move' : 'none';
      setDropHint(valid);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      if (dragIndex !== null) {
        const to = dropDestination(dragIndex, eventTarget(i, e));
        if (to !== null) onMove(dragIndex, to);
      }
      clear();
    },
  });
}

/**
 * Resolve a visible drop location to the index the moved row will have. `null` is deliberately a
 * first-class result: several edges describe the row's existing location and must not look active.
 * Keeping this independent of DOM events also gives future cell drop targets one shared rule for
 * deciding whether accepting a dragged row would do anything.
 */
export function dropDestination(from: number, target: RowDropTarget): number | null {
  const to = from < target.insertion ? target.insertion - 1 : target.insertion;
  return to === from ? null : to;
}

/** Both row edges bordering one gap resolve to the same target, so its highlight cannot jump. */
export function rowDropTarget(index: number, edge: DropEdge): RowDropTarget {
  return { insertion: edge === 'before' ? index : index + 1 };
}

/** Which half of a target contains the pointer. The midpoint belongs to the lower half. */
export function dropEdgeAt(clientY: number, top: number, height: number): DropEdge {
  return clientY < top + height / 2 ? 'before' : 'after';
}

function eventTarget(index: number, e: DragEvent): RowDropTarget {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  return rowDropTarget(index, dropEdgeAt(e.clientY, rect.top, rect.height));
}
