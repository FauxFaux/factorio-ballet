import { staticData } from '../../data/decode.ts';
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
  type AssemblerFluidboxConnection,
  Belt,
  entityPositionStatuses,
  Inserter,
  Pipe,
  type EntityPositionStatus,
  type ViewportPoint,
} from './design-entities.tsx';
import type { Machine, ResourceId } from '../../types.ts';

export interface DesignSceneItem {
  name: string;
  colour: string;
  rate: number;
}

export type DesignSceneItems = Readonly<Record<string, DesignSceneItem>>;
export type DesignSceneMachines = Readonly<Record<string, string | undefined>>;

export type DesignSceneRecipes = Readonly<
  Record<
    string,
    {
      ingredients: { resource: ResourceId }[];
      products: { resource: ResourceId }[];
    }
  >
>;

const ignoreEntity = (_entityIndex: number) => undefined;

/** Draw a design column's entities and their derived read-only status information. */
export function DesignScene({
  column,
  worldOrigin,
  recipes = staticData.recipes,
  machinesByRecipe = {},
  items,
  onEntityEnter = ignoreEntity,
  onEntityLeave = ignoreEntity,
}: {
  column: DesignColumn;
  worldOrigin: ViewportPoint;
  recipes?: DesignSceneRecipes;
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
    case 'assembler':
      return (
        <Assembler
          entityIndex={entityIndex}
          assembler={entity}
          status={status}
          inputStatus={assemblerInputStatus}
          fluidboxConnections={assemblerFluidboxConnections(
            entity,
            machinesByRecipe[entity.recipe],
          )}
          worldOrigin={worldOrigin}
          {...hoverHandlers}
        />
      );
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

/** Return the machine's north-facing fluid-box points transformed to this assembler's rotation. */
export function assemblerFluidboxConnections(
  assembler: DesignAssembler,
  fallbackMachine: string | undefined = undefined,
  machines: Readonly<Record<string, Machine>> = staticData.machines,
): AssemblerFluidboxConnection[] {
  const machineId = assembler.machine ?? fallbackMachine;
  if (!machineId) return [];
  const machine = machines[machineId];
  if (!machine?.fluidboxConnectionPoints) return [];
  const turns = directionTurns(assembler.direction ?? 'north');

  return machine.fluidboxConnectionPoints.map((position) => {
    const direction = rotateDirection(connectionDirection(position, machine.size), turns);
    return {
      position: rotatePosition(position, turns),
      direction,
    };
  });
}

function connectionDirection(
  position: DesignPosition,
  size: { width: number; height: number },
): DesignDirection {
  const horizontalExtent = Math.max((size.width - 1) / 2, Number.EPSILON);
  const verticalExtent = Math.max((size.height - 1) / 2, Number.EPSILON);
  // A north-facing prototype's corner ports face north/south. Prefer the vertical edge on a tie;
  // rotating that normal gives the lateral ports of an east- or west-facing machine.
  if (Math.abs(position.y) / verticalExtent >= Math.abs(position.x) / horizontalExtent) {
    return position.y < 0 ? 'north' : 'south';
  }
  return position.x < 0 ? 'west' : 'east';
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

function rotateDirection(direction: DesignDirection, turns: number): DesignDirection {
  const directions: DesignDirection[] = ['north', 'east', 'south', 'west'];
  return directions[(directions.indexOf(direction) + turns) % directions.length];
}
