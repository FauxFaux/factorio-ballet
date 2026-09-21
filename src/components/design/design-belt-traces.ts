import { beltLaneKey, type BeltGraph, type BeltLaneRef } from '../../bp/belt-model.ts';
import type {
  DesignAssembler,
  DesignColumn,
  DesignDirection,
  DesignPosition,
} from '../../compute/design.ts';
import type { ResourceId } from '../../types.ts';
import { analyzeDesignLanes, singleLaneItem } from './design-lanes.ts';

/** One item which has been traced onto a particular side of a transport belt. */
export interface BeltItemTrace {
  item: ResourceId;
  side: 'left' | 'right';
}

type RecipeProducts = Readonly<
  Record<string, { products: ReadonlyArray<{ resource: ResourceId }> }>
>;
type RecipeIngredients = Readonly<
  Record<string, { ingredients: ReadonlyArray<{ resource: ResourceId }> }>
>;

export interface AssemblerInputStatus {
  satisfied: boolean;
  /** Item ingredients which cannot be taken from any connected belt. */
  missing: ResourceId[];
}

/**
 * Return whether each assembler can take all of its item ingredients from connected belts.
 *
 * An inserter can take either lane of its source belt, so one inserter may supply two ingredients.
 * Empty and mixed lanes do not provide a dependable item. Fluid ingredients are intentionally not
 * considered here because they are supplied by pipes rather than belts.
 */
export function assemblerInputStatuses(
  column: DesignColumn,
  recipes: RecipeIngredients & RecipeProducts,
): Map<number, AssemblerInputStatus> {
  const analysis = analyzeDesignLanes(column, recipes);
  const suppliedByAssembler = new Map<number, Set<ResourceId>>();
  const connectedAssemblers = new Set<number>();

  for (const transfer of analysis.graph.inserterTransfers) {
    if (transfer.sourceBeltLanes.length === 0) continue;
    const inserter = column.entities[transfer.inserter.entity_number];
    if (!inserter || inserter.kind !== 'inserter') continue;
    const drop = addPosition(
      inserter.position,
      scalePosition(directionVector(inserter.direction), inserter.reach ?? 1),
    );
    const assemblerIndexes = column.entities.flatMap((entity, entityIndex) =>
      entity.kind === 'assembler' && contains(entity, drop) ? [entityIndex] : [],
    );
    if (assemblerIndexes.length !== 1) continue;
    const assemblerIndex = assemblerIndexes[0];

    connectedAssemblers.add(assemblerIndex);
    const supplied = suppliedByAssembler.get(assemblerIndex) ?? new Set<ResourceId>();
    for (const lane of transfer.sourceBeltLanes) {
      const item = singleLaneItem(analysis.contents.get(beltLaneKey(lane)));
      if (item) supplied.add(item);
    }
    suppliedByAssembler.set(assemblerIndex, supplied);
  }

  const statuses = new Map<number, AssemblerInputStatus>();
  column.entities.forEach((entity, entityIndex) => {
    if (entity.kind !== 'assembler') return;
    const required = assemblerItemIngredients(entity, recipes);
    const supplied = suppliedByAssembler.get(entityIndex) ?? new Set<ResourceId>();
    const missing = required.filter((item) => !supplied.has(item));
    statuses.set(entityIndex, {
      satisfied: connectedAssemblers.has(entityIndex) && missing.length === 0,
      missing,
    });
  });
  return statuses;
}

function assemblerItemIngredients(
  assembler: DesignAssembler,
  recipes: RecipeIngredients,
): ResourceId[] {
  return [
    ...new Set(
      (recipes[assembler.recipe]?.ingredients ?? [])
        .map(({ resource }) => resource)
        .filter((resource): resource is ResourceId => resource.startsWith('item:')),
    ),
  ];
}

/**
 * Return the individually traceable items on each ordinary transport belt.
 *
 * An empty or mixed lane deliberately has no trace here because it has no single item to show.
 */
export function beltItemTraces(
  column: DesignColumn,
  recipes: RecipeProducts,
  wrapBoundary = false,
): Map<number, BeltItemTrace[]> {
  const { contents, graph } = analyzeDesignLanes(column, recipes);
  const traces = new Map<number, BeltItemTrace[]>();

  column.entities.forEach((entity, entityIndex) => {
    if (entity.kind !== 'belt') return;
    const beltTraces = (['left', 'right'] as const).flatMap((side) => {
      const item = singleLaneItem(
        contents.get(beltLaneKey({ entityNumber: entityIndex, line: 'left', lane: side })),
      );
      return item ? [{ item, side }] : [];
    });
    traces.set(entityIndex, beltTraces);
  });

  return wrapBoundary ? wrapBeltItemTraces(column, graph, traces) : traces;
}

/** Extend known output items upstream as if each belt wraps across the design boundary. */
function wrapBeltItemTraces(
  column: DesignColumn,
  graph: BeltGraph,
  traces: Map<number, BeltItemTrace[]>,
): Map<number, BeltItemTrace[]> {
  const { adjacent, lanes } = beltLaneTopology(graph);
  const itemsByLane = new Map<string, Set<ResourceId>>();
  for (const [entityNumber, beltTraces] of traces) {
    for (const { item, side } of beltTraces) {
      markLaneComponent(itemsByLane, adjacent, { entityNumber, line: 'left', lane: side }, item);
    }
  }

  return tracesFromLaneItems(column, lanes, itemsByLane);
}

/**
 * Resolve recipe inputs onto the belt lanes from which inserters collect them.
 *
 * Unlike produced items, an input entering a design has no upstream assembler to inject it into
 * the lane graph. A caller which knows the boundary flows can use this to seed those lanes: one
 * input may occupy both lanes, while two inputs use one lane each.
 */
export function beltInputItemTraces(
  column: DesignColumn,
  recipes: RecipeIngredients & RecipeProducts,
): Map<number, BeltItemTrace[]> {
  const analysis = analyzeDesignLanes(column, recipes);
  const { adjacent, lanes } = beltLaneTopology(analysis.graph);
  const itemsByLane = new Map<string, Set<ResourceId>>();

  const inputGroupsByAssembler = new Map<
    number,
    Map<string, { lanes: BeltLaneRef[]; assembler: DesignAssembler }>
  >();
  for (const transfer of analysis.graph.inserterTransfers) {
    if (transfer.sourceBeltLanes.length === 0) continue;
    const inserter = column.entities[transfer.inserter.entity_number];
    if (!inserter || inserter.kind !== 'inserter') continue;
    const drop = addPosition(
      inserter.position,
      scalePosition(directionVector(inserter.direction), inserter.reach ?? 1),
    );
    const assemblers = column.entities.flatMap((entity, entityIndex) =>
      entity.kind === 'assembler' && contains(entity, drop)
        ? [{ assembler: entity, entityIndex }]
        : [],
    );
    if (assemblers.length !== 1) continue;
    const { assembler, entityIndex } = assemblers[0];
    const groupKey = transfer.sourceBeltLanes
      .map((lane) => laneComponentKey(beltLaneKey(lane), adjacent))
      .sort()
      .join('|');
    const inputGroups =
      inputGroupsByAssembler.get(entityIndex) ??
      new Map<string, { lanes: BeltLaneRef[]; assembler: DesignAssembler }>();
    if (!inputGroups.has(groupKey)) inputGroups.set(groupKey, { lanes: [], assembler });
    const group = inputGroups.get(groupKey)!;
    for (const lane of transfer.sourceBeltLanes) {
      const componentKey = laneComponentKey(beltLaneKey(lane), adjacent);
      if (
        !group.lanes.some(
          (candidate) => laneComponentKey(beltLaneKey(candidate), adjacent) === componentKey,
        )
      ) {
        group.lanes.push(lane);
      }
    }
    inputGroupsByAssembler.set(entityIndex, inputGroups);
  }

  for (const inputGroups of inputGroupsByAssembler.values()) {
    const groups = [...inputGroups.values()];
    const items = assemblerItemIngredients(groups[0].assembler, recipes);
    if (items.length === 0) continue;

    if (items.length === 1) {
      for (const group of groups) {
        for (const lane of group.lanes) markLaneComponent(itemsByLane, adjacent, lane, items[0]);
      }
      continue;
    }

    if (groups.length === 1) {
      if (items.length > groups[0].lanes.length) continue;
      groups[0].lanes.forEach((lane, index) => {
        markLaneComponent(itemsByLane, adjacent, lane, items[index]);
      });
      continue;
    }

    let itemIndex = 0;
    groups.forEach((group, groupIndex) => {
      const groupsAfterThis = groups.length - groupIndex - 1;
      const itemCount = Math.min(group.lanes.length, items.length - itemIndex - groupsAfterThis);
      const groupItems = items.slice(itemIndex, itemIndex + itemCount);
      itemIndex += itemCount;

      group.lanes.forEach((lane, laneIndex) => {
        const item = groupItems.length === 1 ? groupItems[0] : groupItems[laneIndex];
        if (item) markLaneComponent(itemsByLane, adjacent, lane, item);
      });
    });
  }

  return tracesFromLaneItems(column, lanes, itemsByLane);
}

/** Count the distinct connected belt lanes allocated to each traced item. */
export function beltItemLaneCounts(
  column: DesignColumn,
  recipes: RecipeProducts,
  traces: ReadonlyMap<number, BeltItemTrace[]>,
): Map<ResourceId, number> {
  const { graph } = analyzeDesignLanes(column, recipes);
  const { adjacent } = beltLaneTopology(graph);
  const componentsByItem = new Map<ResourceId, Set<string>>();

  for (const [entityNumber, beltTraces] of traces) {
    for (const { item, side } of beltTraces) {
      appendSet(
        componentsByItem,
        item,
        laneComponentKey(beltLaneKey({ entityNumber, line: 'left', lane: side }), adjacent),
      );
    }
  }

  return new Map(
    [...componentsByItem].map(([item, components]) => [item, components.size] as const),
  );
}

function tracesFromLaneItems(
  column: DesignColumn,
  lanes: Map<string, BeltLaneRef>,
  itemsByLane: Map<string, Set<ResourceId>>,
): Map<number, BeltItemTrace[]> {
  const traces = new Map<number, BeltItemTrace[]>();
  for (const [key, items] of itemsByLane) {
    const lane = lanes.get(key);
    if (!lane || items.size !== 1 || column.entities[lane.entityNumber]?.kind !== 'belt') continue;
    const beltTraces = traces.get(lane.entityNumber) ?? [];
    if (!beltTraces.some(({ side }) => side === lane.lane)) {
      beltTraces.push({ item: items.values().next().value!, side: lane.lane });
      traces.set(lane.entityNumber, beltTraces);
    }
  }
  return traces;
}

function beltLaneTopology(graph: BeltGraph): {
  adjacent: Map<string, Set<string>>;
  lanes: Map<string, BeltLaneRef>;
} {
  const adjacent = new Map<string, Set<string>>();
  const lanes = new Map<string, BeltLaneRef>();
  for (const { from, to } of graph.connections) {
    const fromKey = beltLaneKey(from);
    const toKey = beltLaneKey(to);
    appendSet(adjacent, fromKey, toKey);
    appendSet(adjacent, toKey, fromKey);
    lanes.set(fromKey, from);
    lanes.set(toKey, to);
  }
  for (const entity of graph.entities) {
    if (entity.name === 'splitter' || entity.name.endsWith('-splitter')) continue;
    for (const lane of ['left', 'right'] as const) {
      const ref: BeltLaneRef = { entityNumber: entity.entity_number, line: 'left', lane };
      lanes.set(beltLaneKey(ref), ref);
    }
  }
  return { adjacent, lanes };
}

function laneComponentKey(start: string, adjacent: Map<string, Set<string>>): string {
  return [...laneComponent(start, adjacent)].sort()[0] ?? start;
}

function markLaneComponent(
  itemsByLane: Map<string, Set<ResourceId>>,
  adjacent: Map<string, Set<string>>,
  lane: BeltLaneRef,
  item: ResourceId,
) {
  for (const key of laneComponent(beltLaneKey(lane), adjacent)) appendSet(itemsByLane, key, item);
}

function laneComponent(start: string, adjacent: Map<string, Set<string>>): Set<string> {
  const pending = [start];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const key = pending.pop()!;
    if (visited.has(key)) continue;
    visited.add(key);
    for (const next of adjacent.get(key) ?? []) pending.push(next);
  }
  return visited;
}

function appendSet<Key, Value>(map: Map<Key, Set<Value>>, key: Key, value: Value) {
  const values = map.get(key) ?? new Set<Value>();
  values.add(value);
  map.set(key, values);
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

function addPosition(left: DesignPosition, right: DesignPosition): DesignPosition {
  return { x: left.x + right.x, y: left.y + right.y };
}

function scalePosition(position: DesignPosition, factor: number): DesignPosition {
  return { x: position.x * factor, y: position.y * factor };
}

function contains(assembler: DesignAssembler, point: DesignPosition): boolean {
  return (
    point.x >= assembler.position.x &&
    point.x < assembler.position.x + assembler.size.width &&
    point.y >= assembler.position.y &&
    point.y < assembler.position.y + assembler.size.height
  );
}
