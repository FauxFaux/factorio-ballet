import type { DesignAssembler, DesignColumn, DesignEntity } from '../../compute/design.ts';
import {
  assemblerInputStatuses,
  beltInputItemTraces,
  beltItemTraces,
  type AssemblerInputStatus,
  type BeltItemTrace,
} from './design-belt-traces.ts';
import {
  assemblerFluidboxConnections,
  designFluidTraces,
  type AssemblerFluidboxConnection,
} from './design-fluid-traces.ts';
import { beltLoopEntityIndexes } from './design-belts.ts';
import {
  Assembler,
  Belt,
  entityPositionStatuses,
  Inserter,
  Pipe,
  UndergroundPipe,
  type EntityPositionStatus,
  type ViewportPoint,
  TILE_SIZE,
} from './design-entities.tsx';
import type { Machine, ResourceId } from '../../types.ts';

export { fluidBoxResources } from './design-fluid-traces.ts';

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
  const boundaryItemTraces = items ? beltInputItemTraces(column, recipes) : undefined;
  const assemblerStatuses = assemblerInputStatuses(column, recipes, boundaryItemTraces);
  const fluidTraces = designFluidTraces(column, recipes, machinesByRecipe, items !== undefined);
  for (const [assemblerIndex, fluidStatus] of fluidTraces.assemblerStatuses) {
    const itemStatus = assemblerStatuses.get(assemblerIndex);
    const missing = [...(itemStatus?.missing ?? []), ...fluidStatus.missing];
    assemblerStatuses.set(assemblerIndex, {
      satisfied: missing.length === 0,
      missing,
    });
  }
  const loopBeltIndexes = beltLoopEntityIndexes(column.entities);
  const itemTracesByBelt = beltItemTraces(column, recipes, items !== undefined);
  if (boundaryItemTraces) {
    for (const [beltIndex, inputTraces] of boundaryItemTraces) {
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
          pipeFluids={fluidTraces.pipeTraces.get(entityIndex)?.fluids ?? []}
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
  pipeFluids,
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
  pipeFluids: ResourceId[];
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
            ingredientCount={
              new Set((recipes[entity.recipe]?.ingredients ?? []).map(({ resource }) => resource))
                .size
            }
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
          fluids={pipeFluids}
          resources={items}
          worldOrigin={worldOrigin}
          {...hoverHandlers}
        />
      );
    case 'underground-pipe':
      return (
        <UndergroundPipe
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
