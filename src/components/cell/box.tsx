import './box.css';
import { createPortal } from 'preact/compat';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  cellInterface,
  cellTitle,
  moveEntry,
  resetMachines,
  withDesign,
  withLayout,
  withEntry,
  withoutEntry,
  type Cell,
} from '../../cell.ts';
import type { Chosen } from '../../data/index.ts';
import { noteFor, solveCell } from '../../solve/index.ts';
import type { State } from '../../ts.ts';
import type { ResourceId } from '../../types.ts';
import type { KernelProblem } from '../../compute/kernel-problems.ts';
import { modulesForCell } from '../../compute/modules.ts';
import { allocateModuleFlows, connectStationFlows } from '../../compute/module-connections.ts';
import { assignModulePorts } from '../../compute/module-port-connections.ts';
import { proposedSplits } from '../../compute/split.ts';
import { useRowDrag } from './drag.ts';
import { InPlayRow } from './in-play.tsx';
import { SolveNotes, SolverFallbackNotice } from './notes.tsx';
import { CellRadar } from '../radar/radar.tsx';
import { stackedRailStations } from './rail-mode.ts';
import { CellRow } from './row.tsx';
import { CellSide } from './side.tsx';
import { CellDesign } from '../design/columns.tsx';
import { CellLayoutSurface } from '../layout/layout.tsx';
import { CellAsJson } from './as-json.tsx';
import { SplitProposals } from './split-proposals.tsx';
import { FoldIcon, UnfoldIcon } from '@primer/octicons-react';
import { useDataset } from '../../dataset/context.tsx';

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
  onDebugProblem = () => {},
}: {
  cell: State<Cell>;
  active: boolean;
  progress: number;
  /** What the header says a row has to spend: modules and a beacon; see `Chosen`. */
  chosen: Chosen;
  onActivate: () => void;
  onRemove: () => void;
  onSearch: (search: string) => void;
  onDebugProblem?: (problem: KernelProblem) => void;
}) {
  const { data } = useDataset();
  const iface = useMemo(() => cellInterface(data, cell), [data, cell]);
  const stackedStations = stackedRailStations(iface.inputs.length, iface.outputs.length);
  const solution = useMemo(
    () => solveCell(data, cell, progress, chosen),
    [data, cell, progress, chosen],
  );
  const modules = useMemo(
    () => (cell.layout ? modulesForCell(data, cell.entries, solution, chosen.belt, progress) : []),
    [data, cell.layout, cell.entries, solution, chosen.belt, progress],
  );
  const moduleFlows = useMemo(
    () =>
      connectStationFlows(allocateModuleFlows(modules, iface.inPlay), iface.inputs, iface.outputs),
    [modules, iface.inPlay, iface.inputs, iface.outputs],
  );
  const portFlows = useMemo(() => assignModulePorts(modules, moduleFlows), [modules, moduleFlows]);
  const zeroInputRegionRecipes = useMemo(() => {
    const groups = proposedSplits(cell.entries, solution, chosen.belt, data)[0]?.groups ?? [];
    return new Set(
      groups
        .filter((group) => group.inputs.resources === 0)
        .flatMap((group) => group.entries.map((index) => cell.entries[index]!.recipe)),
    );
  }, [cell.entries, solution, chosen.belt]);
  const recipeIds = useMemo(() => cell.entries.map(({ recipe }) => recipe), [cell.entries]);
  const rowDrag = useRowDrag(cell.entries.length, (from, to) =>
    setCell((prev) => moveEntry(prev, from, to)),
  );
  const [hoveredRecipe, setHoveredRecipe] = useState<string>();
  const [hoveredInterfaceResource, setHoveredInterfaceResource] = useState<ResourceId>();
  const [selectedResource, setSelectedResource] = useState<ResourceId>();
  const [expandedRecipes, setExpandedRecipes] = useState<ReadonlySet<string>>(() => new Set());
  const [recipesVertical, setRecipesVertical] = useState(true);
  const [resourcesVertical, setResourcesVertical] = useState(false);
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

  const toggleRecipeExpansion = (recipe: string) => {
    setExpandedRecipes((previous) => {
      const next = new Set(previous);
      if (next.has(recipe)) next.delete(recipe);
      else next.add(recipe);
      return next;
    });
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
          {cellTitle(data, cell)}
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
        <button
          type="button"
          class={cell.layout ? 'cell-btn cell-layout-remove' : 'cell-btn'}
          title={cell.layout ? 'Remove this cell’s layout' : 'Start a blank layout for this cell'}
          onClick={() =>
            setCell(cell.layout ? (previous) => ({ ...previous, layout: undefined }) : withLayout)
          }
        >
          {cell.layout ? 'remove layout' : '+ layout'}
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
          highlighted={hoveredInterfaceResource}
          imports={cell.imports}
        />
        <div class="cell-middle">
          <SolverFallbackNotice solution={solution} />
          <div class="cell-section-head">
            <button
              type="button"
              class="cell-btn cell-section-mode"
              aria-label={recipesVertical ? 'Show recipes horizontally' : 'Show recipes vertically'}
              title={recipesVertical ? 'Fold recipes into icons' : 'Unfold recipes into rows'}
              onClick={() => setRecipesVertical((vertical) => !vertical)}
            >
              {recipesVertical ? <FoldIcon /> : <UnfoldIcon />} by recipe
            </button>
          </div>
          {cell.entries.length === 0 ? (
            <p class="recipe-hint">Add a recipe from the search.</p>
          ) : (
            <div class={recipesVertical ? 'cell-recipes' : 'cell-recipes is-horizontal'}>
              {cell.entries.map((entry, i) => (
                <CellRow
                  key={entry.recipe}
                  entry={entry}
                  entryIndex={i}
                  recipeIds={recipeIds}
                  count={solution.counts[i]}
                  note={noteFor(solution, i)}
                  highlighted={hoveredRecipe === entry.recipe}
                  expanded={expandedRecipes.has(entry.recipe)}
                  vertical={recipesVertical}
                  solution={solution}
                  progress={progress}
                  chosen={chosen}
                  drag={rowDrag(i)}
                  onChange={(next) => setCell((prev) => withEntry(prev, i, next))}
                  onRemove={() => setCell((prev) => withoutEntry(prev, i))}
                  onSelectResource={selectResource}
                  onDebugProblem={onDebugProblem}
                  onToggleExpand={() => toggleRecipeExpansion(entry.recipe)}
                />
              ))}
            </div>
          )}
          {iface.inPlay.length ? (
            <>
              <div class="cell-section-head cell-resource-section-head">
                <button
                  type="button"
                  class="cell-btn cell-section-mode"
                  aria-label={
                    resourcesVertical ? 'Show resources horizontally' : 'Show resources vertically'
                  }
                  title={
                    resourcesVertical ? 'Fold resources into icons' : 'Unfold resources into rows'
                  }
                  onClick={() => setResourcesVertical((vertical) => !vertical)}
                >
                  {resourcesVertical ? <FoldIcon /> : <UnfoldIcon />} by resource
                </button>
              </div>
              <InPlayRow
                ids={iface.inPlay}
                entries={cell.entries}
                solution={solution}
                inputs={new Set(iface.inputs)}
                outputs={new Set(iface.outputs)}
                exports={cell.exports}
                imports={cell.imports}
                vertical={resourcesVertical}
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
                onToggleRecipe={toggleRecipeExpansion}
                onInterfaceHover={setHoveredInterfaceResource}
                selected={selectedResource}
                onSelect={selectResource}
              />
            </>
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
            highlighted={hoveredInterfaceResource}
          />
          <CellRadar
            title={cellTitle(data, cell)}
            inputs={iface.inputs}
            outputs={iface.outputs}
            entries={cell.entries}
            solution={solution}
            belt={chosen.belt}
            progress={progress}
            stackedStations={stackedStations}
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
                aria-label={`Rail brick for ${cellTitle(data, cell)}`}
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
                  title={cellTitle(data, cell)}
                  inputs={iface.inputs}
                  outputs={iface.outputs}
                  entries={cell.entries}
                  solution={solution}
                  belt={chosen.belt}
                  progress={progress}
                  stackedStations={stackedStations}
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
      {cell.layout ? (
        <div class="cell-layout-row">
          <CellLayoutSurface
            layout={cell.layout}
            inputs={iface.inputs}
            outputs={iface.outputs}
            modules={modules}
            connections={portFlows.connections}
            stationConnections={portFlows.stationConnections}
            zeroInputRegionRecipes={zeroInputRegionRecipes}
            stackedStations={stackedStations}
          />
          <SplitProposals entries={cell.entries} solution={solution} belt={chosen.belt} />
        </div>
      ) : null}
    </section>
  );
}
