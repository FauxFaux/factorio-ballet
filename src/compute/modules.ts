import type { CellEntry } from '../cell.ts';
import { entryMachine } from '../cell.ts';
import { staticData } from '../data/decode.ts';
import { inserterItemsPerSecondForBeltAtProgress } from '../data/inserter-throughput.ts';
import type { Solution } from '../solve/index.ts';
import type { Belt, ResourceId } from '../types.ts';
import type { DesignDirection, DesignEntity } from './design.ts';
import type { TileDesignCandidate, TileBoundaryTrack } from './design-validation/types.ts';
import type { KernelFlows, KernelProblem } from './kernel-problems.ts';
import { solveKernelTileDesign } from './tile-design/kernel-result.ts';

export const MAX_MODULE_HEIGHT = 100;

export interface ModulePort {
  /** The exposed end of the repeated transport track. */
  edge: 'top' | 'bottom' | 'left' | 'right';
  x: number;
  /** Row of a side-facing fluid port within the module. */
  y?: number;
  transport: 'belt' | 'underground-belt' | 'pipe' | 'underground-pipe';
  /** Belt travel direction, or the exposed direction of an underground pipe end. */
  direction?: DesignDirection;
  /** Lane names are relative to the track's travel direction. */
  lanes?: {
    left?: { resource: string; side: 'input' | 'output'; rate: number };
    right?: { resource: string; side: 'input' | 'output'; rate: number };
  };
  fluid?: { resource: string; inputRate: number; outputRate: number };
}

/** One physical stack of a recipe's repeating tile. Rates are per second for this entire stack. */
export interface FactoryModule {
  id: string;
  recipe: string;
  machineCount: number;
  copies: number;
  size: { width: number; height: number };
  ports: ModulePort[];
  inputs: Record<ResourceId, number>;
  outputs: Record<ResourceId, number>;
}

function splitRates(rates: Map<ResourceId, number>): KernelFlows {
  const entries = [...rates].filter(([, rate]) => rate > 0);
  return {
    solids: Object.fromEntries(entries.filter(([resource]) => resource.startsWith('item:'))),
    fluids: Object.fromEntries(entries.filter(([resource]) => resource.startsWith('fluid:'))),
  };
}

/** Use the same one-row kernel input as the expanded recipe summary. */
export function recipeKernelProblem(
  recipe: string,
  machine: string | undefined,
  inputRates: Map<ResourceId, number>,
  outputRates: Map<ResourceId, number>,
): KernelProblem {
  const inputs = splitRates(inputRates);
  const outputs = splitRates(outputRates);
  const machineData = machine === undefined ? undefined : staticData.machines[machine];
  return {
    inputs,
    outputs,
    assemblers: [
      {
        name: recipe,
        size: machineData?.size,
        fluidBoxes: machineData?.fluidBoxes,
        fluidIngredients: staticData.recipes[recipe]?.ingredients.filter(({ resource }) =>
          resource.startsWith('fluid:'),
        ),
        fluidProducts: staticData.recipes[recipe]?.products.filter(({ resource }) =>
          resource.startsWith('fluid:'),
        ),
        inputPerSecond: { ...inputs.solids, ...inputs.fluids },
        outputPerSecond: { ...outputs.solids, ...outputs.fluids },
      },
    ],
    design: { columns: [{ entities: [] }] },
  };
}

function portEntity(
  candidate: TileDesignCandidate,
  track: TileBoundaryTrack,
  edge: 'top' | 'bottom',
): DesignEntity | undefined {
  const y = edge === 'top' ? 0 : candidate.pitch - 1;
  return candidate.column.entities.find(
    (entity) =>
      entity.position.x === track.x &&
      entity.position.y === y &&
      (entity.kind === 'belt' ||
        entity.kind === 'underground-belt' ||
        entity.kind === 'pipe' ||
        entity.kind === 'underground-pipe'),
  );
}

function modulePorts(
  candidate: TileDesignCandidate,
  problem: KernelProblem,
  copies: number,
  machinesPerCopy: number,
): ModulePort[] {
  const endPorts = candidate.boundary.flatMap((track) =>
    (['top', 'bottom'] as const).flatMap((edge): ModulePort[] => {
      const entity = portEntity(candidate, track, edge);
      if (!entity) return [];
      if (
        entity.kind !== 'belt' &&
        entity.kind !== 'underground-belt' &&
        entity.kind !== 'pipe' &&
        entity.kind !== 'underground-pipe'
      )
        return [];
      const base = {
        edge,
        x: track.x,
        transport: entity.kind,
        ...('direction' in entity ? { direction: entity.direction } : {}),
      };
      if (track.kind === 'belt') {
        const lanes: NonNullable<ModulePort['lanes']> = {};
        for (const lane of ['left', 'right'] as const) {
          const resource = track.lanes?.[lane];
          const flow = track.laneFlows?.[lane];
          if (resource && flow)
            lanes[lane] = { resource, side: flow.side, rate: flow.rate * copies };
        }
        return [{ ...base, lanes }];
      }
      const resource = track.resource;
      if (!resource) return [];
      return [
        {
          ...base,
          fluid: {
            resource,
            inputRate:
              (problem.inputs.fluids[resource as ResourceId] ?? 0) * copies * machinesPerCopy,
            outputRate:
              (problem.outputs.fluids[resource as ResourceId] ?? 0) * copies * machinesPerCopy,
          },
        },
      ];
    }),
  );
  // An interleaved mirrored pair can keep one fluid inside each repeat instead of
  // carrying it through the top and bottom seams. Expose its surface pipe on the
  // module's side once per copy so every repeat can be connected externally.
  const sidePorts = candidate.boundary.flatMap((track): ModulePort[] => {
    if (track.kind !== 'pipe' || !track.resource) return [];
    if (endPorts.some((port) => port.fluid?.resource === track.resource)) return [];
    const edge = track.x === 0 ? 'left' : track.x === candidate.width - 1 ? 'right' : undefined;
    if (!edge) return [];
    const pipe = candidate.fluids
      .filter(({ resource }) => resource === track.resource)
      .map(({ pipeIndex }) => candidate.column.entities[pipeIndex])
      .find(
        (entity) =>
          entity?.kind === 'pipe' &&
          entity.position.x === track.x &&
          entity.position.y > 0 &&
          entity.position.y < candidate.pitch - 1,
      );
    if (!pipe) return [];
    return Array.from({ length: copies }, (_, copy) => ({
      edge,
      x: track.x,
      y: pipe.position.y + copy * candidate.pitch,
      transport: 'pipe' as const,
      fluid: {
        resource: track.resource!,
        inputRate: (problem.inputs.fluids[track.resource as ResourceId] ?? 0) * machinesPerCopy,
        outputRate: (problem.outputs.fluids[track.resource as ResourceId] ?? 0) * machinesPerCopy,
      },
    }));
  });
  return [...endPorts, ...sidePorts];
}

/** Divide the required integer machines evenly across the fewest supported stacks. */
export function modulesForTile(
  recipe: string,
  machineCount: number,
  problem: KernelProblem,
  candidate: TileDesignCandidate,
  maxCopies: number,
): FactoryModule[] {
  const machinesPerCopy = Object.keys(candidate.machineIds).length;
  const stackLimit = Math.min(maxCopies, Math.floor(MAX_MODULE_HEIGHT / candidate.pitch));
  if (!Number.isFinite(machineCount) || machineCount <= 0 || machinesPerCopy < 1 || stackLimit < 1)
    return [];
  const neededCopies = Math.ceil(machineCount / machinesPerCopy);
  const moduleCount = Math.ceil(neededCopies / stackLimit);
  return Array.from({ length: moduleCount }, (_, index) => {
    const copies =
      Math.floor(neededCopies / moduleCount) + (index < neededCopies % moduleCount ? 1 : 0);
    const installedMachines = copies * machinesPerCopy;
    const inputs = Object.fromEntries(
      Object.entries({ ...problem.inputs.solids, ...problem.inputs.fluids }).map(
        ([resource, rate]) => [resource, rate * installedMachines],
      ),
    );
    const outputs = Object.fromEntries(
      Object.entries({ ...problem.outputs.solids, ...problem.outputs.fluids }).map(
        ([resource, rate]) => [resource, rate * installedMachines],
      ),
    );
    return {
      id: `${recipe}:${index}`,
      recipe,
      machineCount: installedMachines,
      copies,
      size: { width: candidate.width, height: candidate.pitch * copies },
      ports: modulePorts(candidate, problem, copies, machinesPerCopy),
      inputs,
      outputs,
    };
  });
}

/** Derive every recipe module from the current solved cell. */
export function modulesForCell(
  entries: CellEntry[],
  solution: Solution,
  belt: Belt,
  progress: number,
): FactoryModule[] {
  return entries.flatMap((entry, index) => {
    const recipe = staticData.recipes[entry.recipe];
    const count = solution.counts[index];
    if (!recipe || count === undefined || count <= 0) return [];
    const machine = entryMachine(entry, recipe, progress);
    const problem = recipeKernelProblem(
      entry.recipe,
      machine,
      solution.inputRates[index] ?? new Map(),
      solution.outputRates[index] ?? new Map(),
    );
    const result = solveKernelTileDesign(problem, {
      beltItemsPerSecond: belt.itemsPerSecond,
      inserterItemsPerSecond: inserterItemsPerSecondForBeltAtProgress(progress, belt),
      longInserterItemsPerSecond: inserterItemsPerSecondForBeltAtProgress(progress, belt, 2),
    });
    return 'status' in result && result.status === 'found'
      ? modulesForTile(
          entry.recipe,
          count,
          problem,
          result.candidate,
          result.validation.supportedCopies,
        )
      : [];
  });
}
