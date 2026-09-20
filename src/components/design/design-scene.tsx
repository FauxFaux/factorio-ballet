import { staticData } from '../../data/decode.ts';
import type { DesignColumn, DesignEntity } from '../../design.ts';
import {
  assemblerInputStatuses,
  beltItemTraces,
  beltLoopEntityIndexes,
  type AssemblerInputStatus,
  type BeltItemTrace,
} from './design-belts.ts';
import {
  Assembler,
  Belt,
  entityPositionStatuses,
  Inserter,
  type EntityPositionStatus,
  type ViewportPoint,
} from './design-entities.tsx';

const ignoreEntity = (_entityIndex: number) => undefined;

/** Draw a design column's entities and their derived read-only status information. */
export function DesignScene({
  column,
  worldOrigin,
  onEntityEnter = ignoreEntity,
  onEntityLeave = ignoreEntity,
}: {
  column: DesignColumn;
  worldOrigin: ViewportPoint;
  onEntityEnter?: (entityIndex: number) => void;
  onEntityLeave?: (entityIndex: number) => void;
}) {
  const entityStatuses = entityPositionStatuses(column.entities);
  const assemblerStatuses = assemblerInputStatuses(column, staticData.recipes);
  const loopBeltIndexes = beltLoopEntityIndexes(column.entities);
  const itemTracesByBelt = beltItemTraces(column, staticData.recipes);

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
    default:
      return null;
  }
}
