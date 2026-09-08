import { buildBeltGraph } from '../../bp/belt.ts';
import {
  beltLaneKey,
  type BeltGraph,
  type BeltLane,
  type BeltLaneRef,
  type SplitterLine,
} from '../../bp/belt-model.ts';
import type { Entity, Position } from '../../bp/decode.ts';
import type {
  DesignAssembler,
  DesignColumn,
  DesignDirection,
  DesignEntity,
  DesignPosition,
} from '../../design.ts';
import type { Recipe, ResourceId } from '../../types.ts';

export interface LaneInjection {
  inserterIndex: number;
  assemblerIndex: number;
  item: ResourceId;
  target: BeltLaneRef;
}

/** Item ids available on a lane, with the inserters which introduced each one. */
export type LaneContents = ReadonlyMap<ResourceId, ReadonlySet<number>>;

export type DesignLaneIssue =
  | {
      kind: 'disconnected-inserter';
      inserterIndex: number;
      missing: 'assembler' | 'belt' | 'both';
    }
  | {
      kind: 'ambiguous-assembler';
      inserterIndex: number;
      assemblerIndexes: number[];
    }
  | {
      kind: 'ambiguous-assembler-result';
      inserterIndex: number;
      assemblerIndex: number;
      items: ResourceId[];
    }
  | { kind: 'mixed-lane'; lane: BeltLaneRef; items: ResourceId[] }
  | { kind: 'belt-cycle'; lanes: BeltLaneRef[] };

export interface DesignLaneAnalysis {
  graph: BeltGraph;
  injections: LaneInjection[];
  /** Contents are present for every lane which can be evaluated without passing through a cycle. */
  contents: ReadonlyMap<string, LaneContents>;
  issues: DesignLaneIssue[];
}

/** Return the one supported item on a lane, or undefined for an empty or mixed lane. */
export function singleLaneItem(contents: LaneContents | undefined): ResourceId | undefined {
  return contents?.size === 1 ? contents.keys().next().value : undefined;
}

type RecipeProducts = Readonly<Record<string, Pick<Recipe, 'products'>>>;

const beltLanes: BeltLane[] = ['left', 'right'];
const splitterLines: SplitterLine[] = ['left', 'right'];
const splitterSides = ['input', 'output'] as const;

/** Derive belt-lane contents from the geometry in one design column. */
export function analyzeDesignLanes(
  column: DesignColumn,
  recipes: RecipeProducts,
): DesignLaneAnalysis {
  const graph = buildBeltGraph(column.entities.flatMap(toBeltGraphEntity));
  const issues: DesignLaneIssue[] = [];
  const injections = findLaneInjections(column.entities, recipes, graph, issues);
  const { contents, unresolved } = propagateLaneContents(graph, injections);

  if (unresolved.length > 0) issues.push({ kind: 'belt-cycle', lanes: unresolved });
  const nodes = allLaneNodes(graph);
  for (const [key, laneContents] of contents) {
    if (laneContents.size < 2) continue;
    const lane = nodes.get(key);
    if (lane) issues.push({ kind: 'mixed-lane', lane, items: [...laneContents.keys()] });
  }

  return { graph, injections, contents, issues };
}

function toBeltGraphEntity(entity: DesignEntity, entityIndex: number): Entity[] {
  const base = { entity_number: entityIndex, position: entity.position };
  switch (entity.kind) {
    case 'belt':
      return [{ ...base, name: 'transport-belt', direction: factorioDirection(entity.direction) }];
    case 'underground-belt':
      return [
        {
          ...base,
          name: 'underground-belt',
          direction: factorioDirection(entity.direction),
          type: entity.end,
        },
      ];
    case 'splitter':
      return [
        {
          ...base,
          name: 'splitter',
          position: splitterCenter(entity.position, entity.direction),
          direction: factorioDirection(entity.direction),
        },
      ];
    case 'inserter': {
      const offset = directionVector(entity.direction);
      return [
        {
          ...base,
          name: 'inserter',
          direction: factorioDirection(entity.direction),
          pickup_position: [-offset.x, -offset.y],
          drop_position: [offset.x, offset.y],
        },
      ];
    }
    default:
      return [];
  }
}

function findLaneInjections(
  entities: DesignEntity[],
  recipes: RecipeProducts,
  graph: BeltGraph,
  issues: DesignLaneIssue[],
): LaneInjection[] {
  const transferByInserter = new Map(
    graph.inserterTransfers.map((transfer) => [transfer.inserter.entity_number, transfer]),
  );
  const injections: LaneInjection[] = [];

  entities.forEach((entity, inserterIndex) => {
    if (entity.kind !== 'inserter') return;
    const offset = directionVector(entity.direction);
    const pickup = subtract(entity.position, offset);
    const drop = add(entity.position, offset);
    const assemblers = entities.flatMap((candidate, assemblerIndex) =>
      candidate.kind === 'assembler' && contains(candidate, pickup)
        ? [{ assembler: candidate, assemblerIndex }]
        : [],
    );
    const belts = entities.flatMap((candidate, beltIndex) =>
      isBeltAt(candidate, drop) ? [beltIndex] : [],
    );

    if (assemblers.length > 1) {
      issues.push({
        kind: 'ambiguous-assembler',
        inserterIndex,
        assemblerIndexes: assemblers.map(({ assemblerIndex }) => assemblerIndex),
      });
      return;
    }

    const assemblerMatch = assemblers[0];
    const beltIndex = belts.length === 1 ? belts[0] : undefined;
    const transfer = transferByInserter.get(inserterIndex);
    const target =
      transfer && transfer.target?.entity_number === beltIndex
        ? transfer.targetBeltLane
        : undefined;
    if (!assemblerMatch || !target) {
      issues.push({
        kind: 'disconnected-inserter',
        inserterIndex,
        missing: !assemblerMatch && !target ? 'both' : assemblerMatch ? 'belt' : 'assembler',
      });
      return;
    }

    const items = assemblerItemResults(assemblerMatch.assembler, recipes);
    if (items.length !== 1) {
      issues.push({
        kind: 'ambiguous-assembler-result',
        inserterIndex,
        assemblerIndex: assemblerMatch.assemblerIndex,
        items,
      });
      return;
    }
    injections.push({
      inserterIndex,
      assemblerIndex: assemblerMatch.assemblerIndex,
      item: items[0],
      target,
    });
  });
  return injections;
}

function assemblerItemResults(assembler: DesignAssembler, recipes: RecipeProducts): ResourceId[] {
  return [
    ...new Set(
      (recipes[assembler.recipe]?.products ?? [])
        .map(({ resource }) => resource)
        .filter((resource): resource is ResourceId => resource.startsWith('item:')),
    ),
  ];
}

function propagateLaneContents(
  graph: BeltGraph,
  injections: LaneInjection[],
): { contents: Map<string, LaneContents>; unresolved: BeltLaneRef[] } {
  const nodes = allLaneNodes(graph);
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  const indegrees = new Map([...nodes.keys()].map((key) => [key, 0]));

  for (const { from, to } of graph.connections) {
    const fromKey = beltLaneKey(from);
    const toKey = beltLaneKey(to);
    append(outgoing, fromKey, toKey);
    append(incoming, toKey, fromKey);
    indegrees.set(toKey, (indegrees.get(toKey) ?? 0) + 1);
  }

  const injectionsByLane = new Map<string, LaneInjection[]>();
  for (const injection of injections) {
    append(injectionsByLane, beltLaneKey(injection.target), injection);
  }

  const pending = [...indegrees].flatMap(([key, degree]) => (degree === 0 ? [key] : []));
  const contents = new Map<string, LaneContents>();
  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    const key = pending[cursor];
    const laneContents = new Map<ResourceId, Set<number>>();
    for (const predecessor of incoming.get(key) ?? []) {
      mergeContents(laneContents, contents.get(predecessor));
    }
    for (const injection of injectionsByLane.get(key) ?? []) {
      appendSet(laneContents, injection.item, injection.inserterIndex);
    }
    contents.set(key, laneContents);

    for (const successor of outgoing.get(key) ?? []) {
      const degree = (indegrees.get(successor) ?? 0) - 1;
      indegrees.set(successor, degree);
      if (degree === 0) pending.push(successor);
    }
  }

  return {
    contents,
    unresolved: [...indegrees].flatMap(([key, degree]) =>
      degree > 0 && nodes.has(key) ? [nodes.get(key)!] : [],
    ),
  };
}

function allLaneNodes(graph: BeltGraph): Map<string, BeltLaneRef> {
  const result = new Map<string, BeltLaneRef>();
  const addLane = (lane: BeltLaneRef) => result.set(beltLaneKey(lane), lane);
  for (const entity of graph.entities) {
    const isSplitter = entity.name === 'splitter' || entity.name.endsWith('-splitter');
    if (isSplitter) {
      for (const line of splitterLines) {
        for (const lane of beltLanes) {
          for (const splitterSide of splitterSides) {
            addLane({ entityNumber: entity.entity_number, line, lane, splitterSide });
          }
        }
      }
    } else {
      for (const lane of beltLanes)
        addLane({ entityNumber: entity.entity_number, line: 'left', lane });
    }
  }
  for (const connection of graph.connections) {
    addLane(connection.from);
    addLane(connection.to);
  }
  return result;
}

function mergeContents(target: Map<ResourceId, Set<number>>, source: LaneContents | undefined) {
  for (const [item, inserters] of source ?? []) {
    for (const inserter of inserters) appendSet(target, item, inserter);
  }
}

function append<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function appendSet<K, V>(map: Map<K, Set<V>>, key: K, value: V) {
  const values = map.get(key) ?? new Set<V>();
  values.add(value);
  map.set(key, values);
}

function contains(assembler: DesignAssembler, point: DesignPosition): boolean {
  return (
    point.x >= assembler.position.x &&
    point.x < assembler.position.x + assembler.size.width &&
    point.y >= assembler.position.y &&
    point.y < assembler.position.y + assembler.size.height
  );
}

function isBeltAt(entity: DesignEntity, point: DesignPosition): boolean {
  if (entity.kind === 'belt' || entity.kind === 'underground-belt') {
    return samePosition(entity.position, point);
  }
  if (entity.kind !== 'splitter') return false;
  const center = splitterCenter(entity.position, entity.direction);
  const lateral = leftVector(entity.direction);
  return [-0.5, 0.5].some((distance) => samePosition(add(center, scale(lateral, distance)), point));
}

function splitterCenter(position: DesignPosition, direction: DesignDirection): Position {
  return direction === 'north' || direction === 'south'
    ? { x: position.x + 0.5, y: position.y }
    : { x: position.x, y: position.y + 0.5 };
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

function directionVector(direction: DesignDirection): DesignPosition {
  switch (direction) {
    case 'north':
      return { x: 0, y: -1 };
    case 'east':
      return { x: 1, y: 0 };
    case 'south':
      return { x: 0, y: 1 };
    case 'west':
      return { x: -1, y: 0 };
  }
}

function leftVector(direction: DesignDirection): DesignPosition {
  const forward = directionVector(direction);
  return { x: forward.y, y: -forward.x };
}

function add(left: Position, right: Position): Position {
  return { x: left.x + right.x, y: left.y + right.y };
}

function subtract(left: Position, right: Position): Position {
  return { x: left.x - right.x, y: left.y - right.y };
}

function scale(position: Position, factor: number): Position {
  return { x: position.x * factor, y: position.y * factor };
}

function samePosition(left: Position, right: Position): boolean {
  return Math.abs(left.x - right.x) < 0.01 && Math.abs(left.y - right.y) < 0.01;
}
