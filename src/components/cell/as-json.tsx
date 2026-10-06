import './as-json.css';
import { useMenu } from '../menu.ts';
import { entryMachine, type Cell, type CellInterface } from '../../cell.ts';
import type { Solution } from '../../solve/index.ts';
import type { Belt, ResourceId } from '../../types.ts';
import { recipeConnections } from './connection-calc.ts';
import type { ConnectionFlow } from './connection-calc.ts';

import type { Dataset } from '../../dataset/index.ts';
import { useDataset } from '../../dataset/context.tsx';
import { recipeLayouts } from './recipe-layout.ts';

interface LayoutContext {
  ds: Dataset;
  belt: Belt;
  progress: number;
}

interface LayoutOption {
  /** Kernel width and vertical repeat pitch, in tiles. */
  size: { width: number; height: number };
  /** Maximum supported buildings per column. */
  capacity: number;
}

interface MaterialRate {
  material: ResourceId;
  rate: number;
}

interface RecipeCount {
  recipe: string;
  /** `null` means the solver could not settle this row's count. */
  count: number | null;
  layoutOptions: LayoutOption[];
  inputs: MaterialFlow[];
  outputs: MaterialFlow[];
}

interface MaterialFlow {
  material: ResourceId;
  rate: number;
  /** Connected machines per machine of this recipe, or `null` at the cell boundary. */
  ratio: number | null;
}

/** The cell's outside rates and its resolved recipe counts, in the order shown in the cell. */
export function cellSolutionJson(
  cell: Cell,
  iface: CellInterface,
  solution: Solution,
  layout?: LayoutContext,
): { inputs: MaterialRate[]; recipes: RecipeCount[]; outputs: MaterialRate[] } {
  const rates = (materials: ResourceId[], direction: 1 | -1) =>
    materials.map((material) => ({
      material,
      rate: direction * (solution.balance.get(material) ?? 0),
    }));

  return {
    inputs: rates(iface.inputs, -1),
    recipes: cell.entries.map((entry, index) => ({
      recipe: entry.recipe,
      count: solution.counts[index] ?? null,
      layoutOptions: layout ? layoutOptionsJson(cell, solution, index, layout) : [],
      ...connectionJson(
        index,
        solution,
        cell.entries.map(({ recipe }) => recipe),
      ),
    })),
    outputs: rates(iface.outputs, 1),
  };
}

function layoutOptionsJson(
  cell: Cell,
  solution: Solution,
  index: number,
  context: LayoutContext,
): LayoutOption[] {
  if (solution.counts[index] === undefined) return [];
  const { ds, belt, progress } = context;
  const entry = cell.entries[index]!;
  const recipe = ds.data.recipes[entry.recipe];
  const { options } = recipeLayouts(
    ds.data,
    entry.recipe,
    recipe ? entryMachine(entry, recipe, progress, ds) : undefined,
    solution.inputRates[index],
    solution.outputRates[index],
    solution.counts[index],
    belt,
    progress,
  );
  return options.map(({ result, maxBuildingsPerColumn }) => ({
    size: { width: result.candidate.width, height: result.candidate.pitch },
    capacity: maxBuildingsPerColumn,
  }));
}

/** The rate and machine-ratio columns from a recipe's expanded connections table. */
function connectionJson(entry: number, solution: Solution, recipes: string[]) {
  const connections = recipeConnections(entry, solution, recipes);
  return {
    inputs: connections.inputs.map(flowJson),
    outputs: connections.outputs.map(flowJson),
  };
}

function flowJson({
  resource,
  rate,
  connectedMachineCount,
  machineCount,
}: ConnectionFlow): MaterialFlow {
  return {
    material: resource,
    rate,
    ratio:
      connectedMachineCount === undefined || machineCount === undefined
        ? null
        : connectedMachineCount / machineCount,
  };
}

/** A read-only, copyable view of the cell's current solved rates. */
export function CellAsJson({
  cell,
  iface,
  solution,
  belt,
  progress,
}: {
  cell: Cell;
  iface: CellInterface;
  solution: Solution;
  belt: Belt;
  progress: number;
}) {
  const { open, setOpen, box } = useMenu();
  const ds = useDataset();
  const json = open
    ? JSON.stringify(cellSolutionJson(cell, iface, solution, { ds, belt, progress }), null, 2)
    : '';

  return (
    <div class="cell-as-json" ref={box}>
      <button
        type="button"
        class="cell-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Show cell solution as JSON"
        onClick={() => setOpen(!open)}
      >
        as json
      </button>
      {open ? (
        <div class="cell-as-json-menu" role="dialog" aria-label="Cell solution JSON">
          <textarea readOnly value={json} rows={20} cols={60} />
        </div>
      ) : null}
    </div>
  );
}
