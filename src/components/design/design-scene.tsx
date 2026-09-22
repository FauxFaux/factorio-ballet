import type {
  DesignAssembler,
  DesignColumn,
  DesignDirection,
  DesignEntity,
  DesignPosition,
} from '../../compute/design.ts';
import {
  assemblerInputStatuses,
  beltInputItemTraces,
  beltItemTraces,
  type AssemblerInputStatus,
  type BeltItemTrace,
} from './design-belt-traces.ts';
import { beltLoopEntityIndexes } from './design-belts.ts';
import {
  Assembler,
  Belt,
  entityPositionStatuses,
  Inserter,
  Pipe,
  type EntityPositionStatus,
  type ViewportPoint,
  TILE_SIZE,
} from './design-entities.tsx';
import type { FluidFlowDirection, Machine, ResourceId } from '../../types.ts';

export interface DesignSceneItem {
  name: string;
  colour: string;
  rate: number;
}

export type DesignSceneItems = Readonly<Record<string, DesignSceneItem>>;
export type DesignSceneMachines = Readonly<Record<string, Pick<Machine, 'fluidBoxes'> | undefined>>;

export type DesignSceneRecipes = Readonly<
  Record<
    string,
    {
      ingredients: { resource: ResourceId; fluidboxIndex?: number }[];
      products: { resource: ResourceId; fluidboxIndex?: number }[];
    }
  >
>;

const ignoreEntity = (_entityIndex: number) => undefined;

/** Draw a design column's entities and their derived read-only status information. */
export function DesignScene({
  column,
  worldOrigin,
  recipes,
  machinesByRecipe = {},
  items,
  onEntityEnter = ignoreEntity,
  onEntityLeave = ignoreEntity,
}: {
  column: DesignColumn;
  worldOrigin: ViewportPoint;
  recipes: DesignSceneRecipes;
  machinesByRecipe?: DesignSceneMachines;
  items?: DesignSceneItems;
  onEntityEnter?: (entityIndex: number) => void;
  onEntityLeave?: (entityIndex: number) => void;
}) {
  const entityStatuses = entityPositionStatuses(column.entities);
  const assemblerStatuses = assemblerInputStatuses(column, recipes);
  const loopBeltIndexes = beltLoopEntityIndexes(column.entities);
  const itemTracesByBelt = beltItemTraces(column, recipes, items !== undefined);
  if (items) {
    for (const [beltIndex, inputTraces] of beltInputItemTraces(column, recipes)) {
      const outputTraces = itemTracesByBelt.get(beltIndex) ?? [];
      itemTracesByBelt.set(beltIndex, [
        ...outputTraces,
        ...inputTraces.filter(
          (input) => !outputTraces.some((output) => output.side === input.side),
        ),
      ]);
    }
  }

  return (
    <>
      {column.entities.map((entity, entityIndex) => (
        <DesignEntityView
          key={entityIndex}
          entity={entity}
          entityIndex={entityIndex}
          status={entityStatuses[entityIndex]}
          assemblerInputStatus={assemblerStatuses.get(entityIndex)}
          beltHasLoop={loopBeltIndexes.has(entityIndex)}
          beltItemTraces={itemTracesByBelt.get(entityIndex) ?? []}
          items={items}
          recipes={recipes}
          machinesByRecipe={machinesByRecipe}
          worldOrigin={worldOrigin}
          onPointerEnter={onEntityEnter}
          onPointerLeave={onEntityLeave}
        />
      ))}
    </>
  );
}

function DesignEntityView({
  entity,
  entityIndex,
  status,
  assemblerInputStatus,
  beltHasLoop,
  beltItemTraces,
  items,
  recipes,
  machinesByRecipe,
  worldOrigin,
  onPointerEnter,
  onPointerLeave,
}: {
  entity: DesignEntity;
  entityIndex: number;
  status: EntityPositionStatus;
  assemblerInputStatus: AssemblerInputStatus | undefined;
  beltHasLoop: boolean;
  beltItemTraces: BeltItemTrace[];
  items: DesignSceneItems | undefined;
  recipes: DesignSceneRecipes;
  machinesByRecipe: DesignSceneMachines;
  worldOrigin: ViewportPoint;
  onPointerEnter: (entityIndex: number) => void;
  onPointerLeave: (entityIndex: number) => void;
}) {
  const hoverHandlers = {
    onPointerEnter: () => onPointerEnter(entityIndex),
    onPointerLeave: () => onPointerLeave(entityIndex),
  };
  switch (entity.kind) {
    case 'assembler': {
      const fluidboxConnections = assemblerFluidboxConnections(
        entity,
        machinesByRecipe[entity.recipe],
        recipes[entity.recipe],
      );
      return (
        <>
          <Assembler
            entityIndex={entityIndex}
            assembler={entity}
            status={status}
            inputStatus={assemblerInputStatus}
            worldOrigin={worldOrigin}
            {...hoverHandlers}
          />
          {fluidboxConnections.map((connection, index) => (
            <FluidboxConnectionArrow
              key={`${connection.position.x},${connection.position.y},${index}`}
              assembler={entity}
              connection={connection}
              worldOrigin={worldOrigin}
            />
          ))}
        </>
      );
    }
    case 'belt':
      return (
        <Belt
          entityIndex={entityIndex}
          belt={entity}
          status={status}
          hasLoop={beltHasLoop}
          itemTraces={beltItemTraces}
          items={items}
          worldOrigin={worldOrigin}
          {...hoverHandlers}
        />
      );
    case 'inserter':
      return (
        <Inserter
          entityIndex={entityIndex}
          inserter={entity}
          status={status}
          worldOrigin={worldOrigin}
          {...hoverHandlers}
        />
      );
    case 'pipe':
      return (
        <Pipe
          entityIndex={entityIndex}
          pipe={entity}
          status={status}
          worldOrigin={worldOrigin}
          {...hoverHandlers}
        />
      );
    default:
      return null;
  }
}

interface AssemblerFluidboxConnection {
  /** Centre-relative point after applying the assembler's rotation. */
  position: DesignPosition;
  direction: DesignDirection;
  flowDirection: FluidFlowDirection;
  resource?: ResourceId;
}

function FluidboxConnectionArrow({
  assembler,
  connection,
  worldOrigin,
}: {
  assembler: DesignAssembler;
  connection: AssemblerFluidboxConnection;
  worldOrigin: ViewportPoint;
}) {
  const left =
    worldOrigin.x +
    (assembler.position.x + assembler.size.width / 2 + connection.position.x - 0.5) * TILE_SIZE;
  const top =
    worldOrigin.y +
    (assembler.position.y + assembler.size.height / 2 + connection.position.y - 0.5) * TILE_SIZE;

  return (
    <svg
      class="cell-design-fluidbox-arrow"
      aria-hidden="true"
      data-direction={connection.direction}
      data-flow-direction={connection.flowDirection}
      data-resource={connection.resource}
      data-fluidbox-position={`${connection.position.x},${connection.position.y}`}
      style={{ left: `${left}px`, top: `${top}px` }}
      viewBox="0 0 12 12"
    >
      <path d="M 10.5 6 L 2.5 1.5 L 2.5 10.5 Z" />
      {connection.flowDirection === 'input-output' && <path d="M 1.5 6 L 5.5 3.75 L 5.5 8.25 Z" />}
    </svg>
  );
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

/** Match recipe fluids to the machine's ordered, side-specific fluid-box indexes. */
export function fluidBoxResources(
  machine: Pick<Machine, 'fluidBoxes'>,
  recipe: DesignSceneRecipes[string] | undefined,
): ReadonlyMap<number, ResourceId> {
  const result = new Map<number, ResourceId>();
  if (!machine.fluidBoxes || !recipe) return result;

  const assign = (
    side: 'input' | 'output',
    fluids: Array<{ resource: ResourceId; fluidboxIndex?: number }>,
  ) => {
    const boxes = machine.fluidBoxes!.flatMap((box, index) =>
      box.productionType === side || box.productionType === 'input-output' ? [index] : [],
    );
    const fluidResources = fluids.filter(({ resource }) => resource.startsWith('fluid:'));
    for (const fluid of fluidResources) {
      if (!fluid.fluidboxIndex) continue;
      const boxIndex = boxes[fluid.fluidboxIndex - 1];
      if (boxIndex !== undefined) result.set(boxIndex, fluid.resource);
    }
    const unclaimed = boxes.filter((boxIndex) => !result.has(boxIndex));
    for (const fluid of fluidResources.filter(({ fluidboxIndex }) => !fluidboxIndex)) {
      const boxIndex = unclaimed.shift();
      if (boxIndex !== undefined) result.set(boxIndex, fluid.resource);
    }
  };

  assign('input', recipe.ingredients);
  assign('output', recipe.products);
  return result;
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
