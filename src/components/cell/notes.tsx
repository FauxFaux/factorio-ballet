import './notes.css';
import { AlertFillIcon } from '@primer/octicons-react';
import type { Cell } from '../../cell.ts';
import { isProblem, noteLine, type Solution } from '../../solve/index.ts';

/**
 * The glyph for a solver note, wherever one is shown: a row's own mark, or the sentence it points
 * at under the cell. `label` is what a screen reader says; omit it where the icon sits beside text
 * that already says as much, and the icon reads as decorative instead of announcing twice.
 */
export function WarnIcon({ label }: { label?: string }) {
  return <AlertFillIcon size={24} className="warn-icon" aria-label={label} />;
}

/**
 * Everything the solver assumed or could not do, in one place under the rows it happened to. The
 * ⚠ on a row points at the same sentence; this is the version you can read without hovering.
 */
export function SolveNotes({ cell, solution }: { cell: Cell; solution: Solution }) {
  if (solution.notes.length === 0) return null;
  return (
    <ul class="cell-notes">
      {solution.notes.map((note) => (
        <li
          key={`${note.entry}:${note.kind}`}
          class={isProblem(note) ? 'cell-note is-problem' : 'cell-note'}
        >
          {isProblem(note) ? <WarnIcon /> : null}
          {noteLine(cell, note)}
        </li>
      ))}
    </ul>
  );
}
