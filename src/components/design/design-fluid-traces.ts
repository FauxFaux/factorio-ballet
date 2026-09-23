import { fluidBoxResources } from '../../compute/fluid-box-resources.ts';
export { fluidBoxResources } from '../../compute/fluid-box-resources.ts';
import type {
  DesignAssembler,
  DesignColumn,
  DesignDirection,
  DesignEntity,
  DesignPosition,
} from '../../compute/design.ts';
import type { FluidFlowDirection, Machine, ResourceId } from '../../types.ts';
import type { DesignSceneMachines, DesignSceneRecipes } from './design-scene.tsx';

export interface AssemblerFluidInputStatus {
  missing: ResourceId[];
}

export interface PipeFluidTrace {
  /** A valid pipe component has one entry; more than one means incompatible fluids meet. */
  fluids: ResourceId[];
}

export interface AssemblerFluidboxConnection {
  /** Centre-relative point after applying the assembler's rotation. */
  position: DesignPosition;
  direction: DesignDirection;
  flowDirection: FluidFlowDirection;
  resource?: ResourceId;
}

interface PipeComponents {
  componentByPipe: Map<number, number>;
  pipesByComponent: Map<number, number[]>;
}

const undergroundPipeReach = 10;

/** Trace the single fluid shared instantly by every tile in a connected pipe component. */
export function designFluidTraces(
  column: DesignColumn,
  recipes: DesignSceneRecipes,
  machinesByRecipe: DesignSceneMachines,
  wrapBoundary = false,
): {
  assemblerStatuses: Map<number, AssemblerFluidInputStatus>;
  pipeTraces: Map<number, PipeFluidTrace>;
} {
  const components = pipeComponents(column);
  const fluidsByComponent = new Map<number, Set<ResourceId>>();
  const inputComponentsByAssembler = new Map<number, Set<number>>();

  column.entities.forEach((entity, entityIndex) => {
    if (entity.kind !== 'assembler') return;
    const recipe = recipes[entity.recipe];
    const connections = connectedFluidboxes(
      column,
      entity,
      machinesByRecipe[entity.recipe],
      recipe,
      components.componentByPipe,
    );
    const inputComponents = new Set<number>();

    for (const connection of connections) {
      if (connection.flowDirection !== 'input') {
        const fluid = connection.resource ?? onlyRecipeFluid(recipe?.products);
        if (fluid) appendSet(fluidsByComponent, connection.component, fluid);
      }
      if (connection.flowDirection !== 'output') inputComponents.add(connection.component);
    }
    inputComponentsByAssembler.set(entityIndex, inputComponents);

    if (wrapBoundary) {
      for (const connection of connections) {
        if (connection.flowDirection !== 'output' && connection.resource) {
          appendSet(fluidsByComponent, connection.component, connection.resource);
        }
      }
    }
  });

  const assemblerStatuses = new Map<number, AssemblerFluidInputStatus>();
  column.entities.forEach((entity, entityIndex) => {
    if (entity.kind !== 'assembler') return;
    const inputs = recipeFluids(recipes[entity.recipe]?.ingredients);
    const supplied = new Set<ResourceId>();
    for (const component of inputComponentsByAssembler.get(entityIndex) ?? []) {
      const fluids = fluidsByComponent.get(component);
      if (fluids?.size === 1) supplied.add(fluids.values().next().value!);
    }
    // Any input fluidbox may accept any recipe fluid for now. This should become a per-fluidbox
    // check once recipe fluidbox assignments are available for every caller.
    assemblerStatuses.set(entityIndex, {
      missing: inputs.filter((fluid) => !supplied.has(fluid)),
    });
  });

  const pipeTraces = new Map<number, PipeFluidTrace>();
  for (const [component, pipeIndexes] of components.pipesByComponent) {
    const fluids = [...(fluidsByComponent.get(component) ?? [])];
    for (const pipeIndex of pipeIndexes) pipeTraces.set(pipeIndex, { fluids });
  }
  return { assemblerStatuses, pipeTraces };
}

interface ConnectedFluidbox extends AssemblerFluidboxConnection {
  component: number;
}

function connectedFluidboxes(
  column: DesignColumn,
  assembler: DesignAssembler,
  machine: Pick<Machine, 'fluidBoxes'> | undefined,
  recipe: DesignSceneRecipes[string] | undefined,
  componentByPipe: Map<number, number>,
): ConnectedFluidbox[] {
  const exact = assemblerFluidboxConnections(assembler, machine, recipe).flatMap((connection) => {
    const port = fluidboxWorldPosition(assembler, connection.position);
    const pipeIndex = pipeAt(
      column,
      addPosition(port, directionVector(connection.direction)),
      oppositeDirection(connection.direction),
    );
    const component = pipeIndex === undefined ? undefined : componentByPipe.get(pipeIndex);
    return component === undefined ? [] : [{ ...connection, component }];
  });
  return exact;
}

function pipeComponents(column: DesignColumn): PipeComponents {
  const pipeByPosition = new Map<string, number>();
  column.entities.forEach((entity, entityIndex) => {
    if (isPipe(entity)) pipeByPosition.set(positionKey(entity.position), entityIndex);
  });
  const undergroundPartners = pairUndergroundPipes(column);
  const componentByPipe = new Map<number, number>();
  const pipesByComponent = new Map<number, number[]>();

  for (const pipeIndex of pipeByPosition.values()) {
    if (componentByPipe.has(pipeIndex)) continue;
    const component = pipeIndex;
    const pending = [pipeIndex];
    const indexes: number[] = [];
    componentByPipe.set(pipeIndex, component);
    while (pending.length > 0) {
      const current = pending.pop()!;
      indexes.push(current);
      const pipe = column.entities[current];
      if (!pipe || !isPipe(pipe)) continue;
      for (const [direction, offset] of Object.entries(directionVectors) as [
        DesignDirection,
        DesignPosition,
      ][]) {
        if (pipe.kind === 'underground-pipe' && pipe.direction !== direction) continue;
        const adjacent = pipeByPosition.get(positionKey(addPosition(pipe.position, offset)));
        if (adjacent === undefined || componentByPipe.has(adjacent)) continue;
        const other = column.entities[adjacent];
        if (other.kind === 'underground-pipe' && other.direction !== oppositeDirection(direction)) {
          continue;
        }
        componentByPipe.set(adjacent, component);
        pending.push(adjacent);
      }
      const partner = undergroundPartners.get(current);
      if (partner !== undefined && !componentByPipe.has(partner)) {
        componentByPipe.set(partner, component);
        pending.push(partner);
      }
    }
    pipesByComponent.set(component, indexes);
  }
  return { componentByPipe, pipesByComponent };
}

function isPipe(
  entity: DesignEntity,
): entity is Extract<DesignEntity, { kind: 'pipe' | 'underground-pipe' }> {
  return entity.kind === 'pipe' || entity.kind === 'underground-pipe';
}

function pairUndergroundPipes(column: DesignColumn): Map<number, number> {
  const endpoints = column.entities.flatMap((entity, index) =>
    entity.kind === 'underground-pipe' ? [{ entity, index }] : [],
  );
  const candidates: { first: number; second: number; distance: number }[] = [];
  for (const { entity: first, index: firstIndex } of endpoints) {
    const underground = directionVector(oppositeDirection(first.direction));
    for (const { entity: second, index: secondIndex } of endpoints) {
      if (secondIndex <= firstIndex || second.direction !== oppositeDirection(first.direction)) {
        continue;
      }
      const delta = {
        x: second.position.x - first.position.x,
        y: second.position.y - first.position.y,
      };
      const distance = delta.x * underground.x + delta.y * underground.y;
      if (
        distance > 0 &&
        distance <= undergroundPipeReach &&
        delta.x * underground.y === delta.y * underground.x
      ) {
        candidates.push({ first: firstIndex, second: secondIndex, distance });
      }
    }
  }
  candidates.sort((left, right) => left.distance - right.distance);
  const partners = new Map<number, number>();
  for (const { first, second } of candidates) {
    if (partners.has(first) || partners.has(second)) continue;
    partners.set(first, second);
    partners.set(second, first);
  }
  return partners;
}

function oppositeDirection(direction: DesignDirection): DesignDirection {
  return rotateDirection(direction, 2);
}

/** Return the machine's north-facing fluid-box points transformed to this assembler's rotation. */
export function assemblerFluidboxConnections(
  assembler: DesignAssembler,
  machine: Pick<Machine, 'fluidBoxes'> | undefined,
  recipe: DesignSceneRecipes[string] | undefined = undefined,
): AssemblerFluidboxConnection[] {
  if (!machine?.fluidBoxes) return [];
  const turns = directionTurns(assembler.direction ?? 'north');
  const resources = fluidBoxResources(machine, recipe);

  return machine.fluidBoxes.flatMap((box, boxIndex) =>
    box.connections.map((connection) => ({
      position: rotatePosition(connection.position, turns),
      direction: rotateDirection(connection.direction, turns),
      flowDirection: connection.flowDirection,
      resource: resources.get(boxIndex),
    })),
  );
}

function recipeFluids(flows: ReadonlyArray<{ resource: ResourceId }> | undefined): ResourceId[] {
  return [...new Set((flows ?? []).map(({ resource }) => resource).filter(isFluid))];
}

function onlyRecipeFluid(
  flows: ReadonlyArray<{ resource: ResourceId }> | undefined,
): ResourceId | undefined {
  const fluids = recipeFluids(flows);
  return fluids.length === 1 ? fluids[0] : undefined;
}

function isFluid(resource: ResourceId): resource is `fluid:${string}` {
  return resource.startsWith('fluid:');
}

function fluidboxWorldPosition(
  assembler: DesignAssembler,
  position: DesignPosition,
): DesignPosition {
  return {
    x: assembler.position.x + assembler.size.width / 2 + position.x - 0.5,
    y: assembler.position.y + assembler.size.height / 2 + position.y - 0.5,
  };
}

function pipeAt(
  column: DesignColumn,
  position: DesignPosition,
  opening: DesignDirection,
): number | undefined {
  const index = column.entities.findIndex(
    (entity) =>
      isPipe(entity) &&
      entity.position.x === position.x &&
      entity.position.y === position.y &&
      (entity.kind === 'pipe' || entity.direction === opening),
  );
  return index < 0 ? undefined : index;
}

const directionVectors: Record<DesignDirection, DesignPosition> = {
  north: { x: 0, y: -1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  west: { x: -1, y: 0 },
};

function directionVector(direction: DesignDirection): DesignPosition {
  return directionVectors[direction];
}

function addPosition(first: DesignPosition, second: DesignPosition): DesignPosition {
  return { x: first.x + second.x, y: first.y + second.y };
}

function positionKey(position: DesignPosition): string {
  return `${position.x},${position.y}`;
}

function appendSet<K, V>(map: Map<K, Set<V>>, key: K, value: V) {
  const values = map.get(key) ?? new Set<V>();
  values.add(value);
  map.set(key, values);
}

function rotateDirection(direction: DesignDirection, turns: number): DesignDirection {
  const directions: DesignDirection[] = ['north', 'east', 'south', 'west'];
  return directions[(directions.indexOf(direction) + turns) % directions.length];
}

function directionTurns(direction: DesignDirection): number {
  return ['north', 'east', 'south', 'west'].indexOf(direction);
}

function rotatePosition(position: DesignPosition, turns: number): DesignPosition {
  let rotated = position;
  for (let turn = 0; turn < turns; turn += 1) {
    rotated = { x: -rotated.y, y: rotated.x };
  }
  return rotated;
}
