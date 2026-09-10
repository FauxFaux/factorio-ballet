import './box.css';
import { createPortal } from 'preact/compat';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  cellInterface,
  cellTitle,
  moveEntry,
  resetMachines,
  withDesign,
  withEntry,
  withoutEntry,
  type Cell,
} from '../../cell.ts';
import type { Chosen } from '../../data/index.ts';
import { noteFor, solveCell } from '../../solve/index.ts';
import type { State } from '../../ts.ts';
import type { ResourceId } from '../../types.ts';
import { useRowDrag } from './drag.ts';
import { InPlayRow } from './in-play.tsx';
import { SolveNotes, SolverFallbackNotice } from './notes.tsx';
import { CellRadar } from './radar.tsx';
import { CellRow } from './row.tsx';
import { CellSide } from './side.tsx';
import { CellDesign } from '../design/columns.tsx';
import { CellAsJson } from './as-json.tsx';

/**
 * One cell: what it must be fed on the left, what it hands on on the right, and the recipes and
 * machines doing the work between them — a sankey diagram's shape, without the sankey.
 *
 * The solver runs on every keystroke, which it can afford to: a cell is a handful of rows. Its
 * answer is a display layer over the cell and never written back, exactly as the default machine
 * is — a count is the user's only when they typed it.
 */
export function CellBox({
  cell: [cell, setCell],
  active,
  progress,
  chosen,
  onActivate,
  onRemove,
  onSearch,
}: {
  cell: State<Cell>;
  active: boolean;
  progress: number;
  /** What the header says a row has to spend: modules and a beacon; see `Chosen`. */
  chosen: Chosen;
  onActivate: () => void;
  onRemove: () => void;
  onSearch: (search: string) => void;
}) {
  const iface = useMemo(() => cellInterface(cell), [cell]);
  const solution = useMemo(() => solveCell(cell, progress, chosen), [cell, progress, chosen]);
  const recipeIds = useMemo(() => cell.entries.map(({ recipe }) => recipe), [cell.entries]);
  const rowDrag = useRowDrag(cell.entries.length, (from, to) =>
    setCell((prev) => moveEntry(prev, from, to)),
  );
  const [hoveredRecipe, setHoveredRecipe] = useState<string>();
  const [selectedResource, setSelectedResource] = useState<ResourceId>();
  const [radarOpen, setRadarOpen] = useState(false);
  const radarTrigger = useRef<HTMLButtonElement>(null);
  const radarClose = useRef<HTMLButtonElement>(null);

  const closeRadar = () => {
    setRadarOpen(false);
    radarTrigger.current?.focus();
  };

  useEffect(() => {
    if (!radarOpen) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRadar();
    };
    document.addEventListener('keydown', escape);
    radarClose.current?.focus();
    return () => document.removeEventListener('keydown', escape);
  }, [radarOpen]);

  const selectResource = (id: ResourceId | undefined) => {
    setSelectedResource(id);
    setHoveredRecipe(undefined);
  };

  return (
    <section class={active ? 'cell is-active' : 'cell'}>
      <header class="cell-head">
        <button
          type="button"
          class="cell-title"
          aria-pressed={active}
          title={active ? 'The cell being worked on' : 'Work on this cell'}
          onClick={onActivate}
        >
          {cellTitle(cell)}
        </button>
        <span class="cell-size">
          {cell.entries.length} {cell.entries.length === 1 ? 'recipe' : 'recipes'}
        </span>
        {cell.entries.some((entry) => entry.machine !== undefined) ? (
          <button
            type="button"
            class="cell-btn cell-reset-machines"
            title="Reset all machines to auto"
            aria-label="Reset all machines to auto"
            onClick={() => setCell(resetMachines)}
          >
            ↺ auto
          </button>
        ) : null}
        <button
          type="button"
          class={cell.design ? 'cell-btn cell-design-remove' : 'cell-btn'}
          title={cell.design ? 'Remove this cell’s design' : 'Start a blank design for this cell'}
          onClick={() =>
            setCell(cell.design ? (previous) => ({ ...previous, design: undefined }) : withDesign)
          }
        >
          {cell.design ? 'remove design' : '+ design'}
        </button>
        <CellAsJson cell={cell} iface={iface} solution={solution} />
        <button
          type="button"
          class="cell-btn cell-remove"
          title="Remove this cell"
          aria-label="Remove this cell"
          onClick={onRemove}
        >
          ×
        </button>
      </header>
      <div class="cell-body">
        <CellSide
          dir="in"
          ids={iface.inputs}
          solution={solution}
          belt={chosen.belt}
          onSearch={onSearch}
          onSelect={selectResource}
          imports={cell.imports}
        />
        <div class="cell-middle">
          <SolverFallbackNotice solution={solution} />
          {cell.entries.length === 0 ? (
            <p class="recipe-hint">Add a recipe from the search.</p>
          ) : (
            cell.entries.map((entry, i) => (
              <CellRow
                key={entry.recipe}
                entry={entry}
                entryIndex={i}
                recipeIds={recipeIds}
                count={solution.counts[i]}
                note={noteFor(solution, i)}
                highlighted={hoveredRecipe === entry.recipe}
                solution={solution}
                progress={progress}
                chosen={chosen}
                drag={rowDrag(i)}
                onChange={(next) => setCell((prev) => withEntry(prev, i, next))}
                onRemove={() => setCell((prev) => withoutEntry(prev, i))}
              />
            ))
          )}
          {iface.inPlay.length ? (
            <InPlayRow
              ids={iface.inPlay}
              entries={cell.entries}
              solution={solution}
              inputs={new Set(iface.inputs)}
              outputs={new Set(iface.outputs)}
              exports={cell.exports}
              imports={cell.imports}
              onToggleImport={(id) =>
                setCell((previous) => ({
                  ...previous,
                  imports: previous.imports?.includes(id)
                    ? previous.imports.filter((resource) => resource !== id)
                    : [...(previous.imports ?? []), id],
                  exports: previous.exports?.filter((resource) => resource !== id),
                }))
              }
              onToggleExport={(id) =>
                setCell((previous) => ({
                  ...previous,
                  imports: previous.imports?.filter((resource) => resource !== id),
                  exports: previous.exports?.includes(id)
                    ? previous.exports.filter((resource) => resource !== id)
                    : [...(previous.exports ?? []), id],
                }))
              }
              onRecipeHover={setHoveredRecipe}
              onSearch={onSearch}
              selected={selectedResource}
              onSelect={selectResource}
            />
          ) : null}
          <SolveNotes cell={cell} solution={solution} />
        </div>
        <div class="cell-out-stack">
          <CellSide
            dir="out"
            ids={iface.outputs}
            solution={solution}
            belt={chosen.belt}
            onSearch={onSearch}
            onSelect={selectResource}
            exports={cell.exports}
          />
          <CellRadar
            title={cellTitle(cell)}
            inputs={iface.inputs}
            outputs={iface.outputs}
            entries={cell.entries}
            solution={solution}
            belt={chosen.belt}
            progress={progress}
            onExpand={() => setRadarOpen(true)}
            expandButtonRef={radarTrigger}
          />
        </div>
      </div>
      {radarOpen
        ? createPortal(
            <div class="cell-radar-backdrop" onClick={closeRadar}>
              <section
                class="cell-radar-dialog"
                role="dialog"
                aria-modal="true"
                aria-label={`Rail brick for ${cellTitle(cell)}`}
                onClick={(event) => event.stopPropagation()}
              >
                <header class="cell-radar-dialog-head">
                  <span>Rail brick</span>
                  <button
                    ref={radarClose}
                    type="button"
                    class="cell-btn"
                    aria-label="Close rail brick"
                    onClick={closeRadar}
                  >
                    × close
                  </button>
                </header>
                <CellRadar
                  title={cellTitle(cell)}
                  inputs={iface.inputs}
                  outputs={iface.outputs}
                  entries={cell.entries}
                  solution={solution}
                  belt={chosen.belt}
                  progress={progress}
                />
              </section>
            </div>,
            document.body,
          )
        : null}
      {cell.design ? (
        <CellDesign
          design={cell.design}
          entries={cell.entries}
          counts={solution.counts}
          progress={progress}
          setDesign={(update) =>
            setCell((previous) => ({
              ...previous,
              design:
                typeof update === 'function' ? update(previous.design ?? cell.design!) : update,
            }))
          }
        />
      ) : null}
    </section>
  );
}
