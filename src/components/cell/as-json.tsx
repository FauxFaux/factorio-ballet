import './as-json.css';
import { useMenu } from '../menu.ts';
import type { Cell, CellInterface } from '../../cell.ts';
import type { Solution } from '../../solve/index.ts';
import type { ResourceId } from '../../types.ts';
import { recipeConnections } from './connection-calc.ts';
import type { ConnectionFlow } from './connection-calc.ts';

interface MaterialRate {
  material: ResourceId;
  rate: number;
}

interface RecipeCount {
  recipe: string;
  /** `null` means the solver could not settle this row's count. */
  count: number | null;
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
      ...connectionJson(
        index,
        solution,
        cell.entries.map(({ recipe }) => recipe),
      ),
    })),
    outputs: rates(iface.outputs, 1),
  };
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
}: {
  cell: Cell;
  iface: CellInterface;
  solution: Solution;
}) {
  const { open, setOpen, box } = useMenu();
  const json = JSON.stringify(cellSolutionJson(cell, iface, solution), null, 2);

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
