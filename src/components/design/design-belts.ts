import { beltLaneKey, buildBeltGraph, type BeltLaneRef } from '../../bp/belt.ts';
import type { DesignColumn, DesignDirection, DesignPosition } from '../../design.ts';

type BeltAxis = 'horizontal' | 'vertical';

export type BeltDrag = { pointerId: number; position: DesignPosition; axis?: BeltAxis };

/**
 * Return every design-belt index belonging to a logical belt which contains a directed loop.
 * A sideload joins its source and target into the same logical belt, so an upstream sideload is
 * also marked when another section of that belt loops.
 */
export function beltLoopEntityIndexes(entities: DesignColumn['entities']): Set<number> {
  const belts = entities.flatMap((entity, entityIndex) =>
    entity.kind === 'belt' ? [{ belt: entity, entityIndex }] : [],
  );
  if (belts.length === 0) return new Set();

  const graph = buildBeltGraph(
    belts.map(({ belt, entityIndex }) => ({
      entity_number: entityIndex,
      name: 'transport-belt',
      position: belt.position,
      direction: factorioDirection(belt.direction),
    })),
  );
  const connectedBelts = new Map<number, Set<number>>();
  for (const { entityIndex } of belts) connectedBelts.set(entityIndex, new Set([entityIndex]));
  for (const { from, to } of graph.connections) {
    connectedBelts.get(from.entityNumber)?.add(to.entityNumber);
    connectedBelts.get(to.entityNumber)?.add(from.entityNumber);
  }

  const invalid = new Set<number>();
  const visited = new Set<number>();
  for (const { entityIndex } of belts) {
    if (visited.has(entityIndex)) continue;
    const component = connectedBeltIndexes(entityIndex, connectedBelts, visited);
    if (componentHasBeltLoop(component, graph.connections)) {
      for (const index of component) invalid.add(index);
    }
  }
  return invalid;
}

function factorioDirection(direction: DesignDirection): 0 | 4 | 8 | 12 {
  switch (direction) {
    case 'north':
      return 0;
    case 'east':
      return 4;
    case 'south':
      return 8;
    case 'west':
      return 12;
  }
}

function connectedBeltIndexes(
  start: number,
  connections: Map<number, Set<number>>,
  visited: Set<number>,
): Set<number> {
  const component = new Set<number>();
  const pending = [start];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    component.add(current);
    for (const next of connections.get(current) ?? []) pending.push(next);
  }
  return component;
}

function componentHasBeltLoop(
  component: Set<number>,
  connections: ReturnType<typeof buildBeltGraph>['connections'],
): boolean {
  const outgoing = new Map<string, { lane: BeltLaneRef; next: BeltLaneRef[] }>();
  for (const { from, to } of connections) {
    if (!component.has(from.entityNumber) || !component.has(to.entityNumber)) continue;
    const key = beltLaneKey(from);
    const current = outgoing.get(key) ?? { lane: from, next: [] };
    current.next.push(to);
    outgoing.set(key, current);
  }

  const states = new Map<string, 'visiting' | 'complete'>();
  const visit = (lane: BeltLaneRef): boolean => {
    const key = beltLaneKey(lane);
    const state = states.get(key);
    if (state === 'visiting') return true;
    if (state === 'complete') return false;
    states.set(key, 'visiting');
    for (const next of outgoing.get(key)?.next ?? []) {
      if (visit(next)) return true;
    }
    states.set(key, 'complete');
    return false;
  };

  return [...outgoing.values()].some(({ lane }) => visit(lane));
}

/** Return an unbroken cardinal path, even when pointer events skip over tiles. */
function cardinalPath(from: DesignPosition, to: DesignPosition): DesignPosition[] {
  const path: DesignPosition[] = [];
  let current = from;
  while (current.x !== to.x || current.y !== to.y) {
    const dx = to.x - current.x;
    const dy = to.y - current.y;
    current =
      Math.abs(dx) >= Math.abs(dy)
        ? { x: current.x + Math.sign(dx), y: current.y }
        : { x: current.x, y: current.y + Math.sign(dy) };
    path.push(current);
  }
  return path;
}

/** Keep a belt run straight until the pointer has clearly moved away from it. */
export function straightBeltPath(
  drag: BeltDrag,
  to: DesignPosition,
): { axis: BeltAxis; position: DesignPosition; positions: DesignPosition[] } {
  const axis =
    drag.axis ??
    (Math.abs(to.x - drag.position.x) >= Math.abs(to.y - drag.position.y)
      ? 'horizontal'
      : 'vertical');
  const offTrack =
    axis === 'horizontal' ? Math.abs(to.y - drag.position.y) : Math.abs(to.x - drag.position.x);
  const onTrack =
    axis === 'horizontal' ? { x: to.x, y: drag.position.y } : { x: drag.position.x, y: to.y };

  if (offTrack < 3) {
    return { axis, position: onTrack, positions: cardinalPath(drag.position, onTrack) };
  }

  return {
    axis: axis === 'horizontal' ? 'vertical' : 'horizontal',
    position: to,
    positions: [...cardinalPath(drag.position, onTrack), ...cardinalPath(onTrack, to)],
  };
}

export function paintBelts(
  column: DesignColumn,
  start: DesignPosition,
  positions: DesignPosition[],
): DesignColumn {
  const entities = [...column.entities];
  let previous = start;

  for (const position of positions) {
    const direction = directionBetween(previous, position);
    setBelt(entities, previous, direction);
    setBelt(entities, position, direction);
    previous = position;
  }
  return { ...column, entities };
}

function directionBetween(first: DesignPosition, second: DesignPosition): DesignDirection {
  if (second.x > first.x) return 'east';
  if (second.x < first.x) return 'west';
  if (second.y > first.y) return 'south';
  return 'north';
}

function setBelt(
  entities: DesignColumn['entities'],
  position: DesignPosition,
  direction: DesignDirection,
) {
  const index = entities.findIndex(
    (entity) =>
      entity.kind === 'belt' &&
      entity.position.x === position.x &&
      entity.position.y === position.y,
  );
  const belt = { kind: 'belt' as const, position, direction };
  if (index === -1) entities.push(belt);
  else entities[index] = belt;
}
