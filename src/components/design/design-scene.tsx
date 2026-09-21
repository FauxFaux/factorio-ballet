import { staticData } from '../../data/decode.ts';
import type { DesignColumn, DesignEntity } from '../../compute/design.ts';
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
} from './design-entities.tsx';
import type { ResourceId } from '../../types.ts';

export interface DesignSceneItem {
  name: string;
  colour: string;
  rate: number;
}

export type DesignSceneItems = Readonly<Record<string, DesignSceneItem>>;

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
  items,
  onEntityEnter = ignoreEntity,
  onEntityLeave = ignoreEntity,
}: {
  column: DesignColumn;
  worldOrigin: ViewportPoint;
  recipes?: DesignSceneRecipes;
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
