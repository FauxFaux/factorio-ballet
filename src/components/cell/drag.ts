import { useState } from 'preact/hooks';

/**
 * Everything one row needs to take part in reordering: whether it is the row being dragged, which
 * of its edges the drop line is on, and the four handlers. One object rather than seven props
 * because a row does not decide any of it — the list does, and the row only wires it up.
 */
export type RowDrag = {
  /** Whether this is the row currently being dragged, for the fade the rest of the list gets. */
  dragging: boolean;
  /** Whether the dragged row would land just above or below this one. */
  dropBefore: boolean;
  dropAfter: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
};

/**
 * Drag-to-reorder for a list of rows: holds which row is in the air and where it would land, and
 * hands each row its own `RowDrag`. `onMove` is called with the two indices once, on a drop which
 * actually moves something.
 */
export function useRowDrag(onMove: (from: number, to: number) => void): (i: number) => RowDrag {
  /** The row being dragged, by index; `null` when no drag is in progress. */
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  /** Which side of which row the dragged one would land on, for the drop-line indicator. */
  const [dropHint, setDropHint] = useState<{ index: number; before: boolean } | null>(null);
  const clear = () => {
    setDragIndex(null);
    setDropHint(null);
  };

  return (i: number) => ({
    dragging: dragIndex === i,
    dropBefore: dropHint?.index === i && dropHint.before,
    dropAfter: dropHint?.index === i && !dropHint.before,
    onDragStart: () => setDragIndex(i),
    onDragEnd: clear,
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      setDropHint({ index: i, before: dropBefore(i, e) });
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      if (dragIndex !== null) {
        const insertion = dropBefore(i, e) ? i : i + 1;
        const to = dragIndex < insertion ? insertion - 1 : insertion;
        if (to !== dragIndex) onMove(dragIndex, to);
      }
      clear();
    },
  });
}

/**
 * Whether dragging over row `i` means "drop before it" rather than "after it". Every position
 * between two rows is reachable as "after" the earlier one, so only row 0 needs the split — landing
 * before it is the one place with no earlier row to be "after" of. Every other row answers `false`
 * unconditionally, which is the point: a threshold splitting a single row's own height is what was
 * flickering (and occasionally swallowing the drop) right on the line between two rows, so no other
 * row gets one.
 */
function dropBefore(i: number, e: DragEvent): boolean {
  if (i !== 0) return false;
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  return e.clientY < rect.top + rect.height / 2;
}
