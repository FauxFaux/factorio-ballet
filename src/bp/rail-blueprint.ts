import { strToU8, zlibSync } from 'fflate';
import threePathString from '../../docs/blueprints/3x-train-layout.base64?raw';
import emptyGridString from '../../docs/blueprints/empty-grid-v0.base64?raw';
import fourPathString from '../../docs/blueprints/4x-train-layout.base64?raw';
import {
  decodeDocument,
  type Blueprint,
  type BlueprintDocument,
  type Entity,
  type Position,
  type Wire,
} from './decode.ts';
import { buildRailGraph } from './rail.ts';

const emptyGrid = blueprintFrom(decodeDocument(emptyGridString));
const threePath = blueprintFrom(decodeDocument(threePathString));
const fourPath = blueprintFrom(decodeDocument(fourPathString));

export const RAIL_BRICK_MAX_STATIONS = 12;
export const RAIL_BRICK_STATION_PITCH = 12;

/** Build a regular rail brick with independently sized vertical station fans on its left and right. */
export function buildRailBrick(inputStations: number, outputStations: number): BlueprintDocument {
  validateStationCount(inputStations);
  validateStationCount(outputStations);

  const blueprint = structuredClone(emptyGrid);
  blueprint.label = `${inputStations} input, ${outputStations} output rail brick`;

  if (inputStations > 0) {
    mergeBlueprint(blueprint, stationFan(inputStations), (entity) =>
      translateEntity(entity, { x: 96, y: 736 }),
    );
  }
  if (outputStations > 0) {
    mergeBlueprint(blueprint, stationFan(outputStations), (entity) =>
      translateEntity(rotateEntity180(entity), { x: 128, y: -576 }),
    );
  }

  return { blueprint };
}

/** Encode a complete Factorio blueprint document for pasting into the game. */
export function encodeBlueprintDocument(document: BlueprintDocument): string {
  const compressed = zlibSync(strToU8(JSON.stringify(document)), { level: 9 });
  let binary = '';
  for (const byte of compressed) binary += String.fromCharCode(byte);
  return `0${btoa(binary)}`;
}

function stationFan(stationCount: number): Blueprint {
  if (stationCount === 4) return structuredClone(fourPath);
  if (stationCount > 4) return extendStationFan(stationCount);

  const sourceEntities = fourPath.entities ?? [];
  const externalEnds = new Set(
    buildRailGraph(sourceEntities)
      .nodes.filter((node) => node.entityNumbers.length === 1)
      .flatMap((node) => node.connectionPoints.map(connectionKey)),
  );
  const pathXs = [
    ...new Set(
      sourceEntities
        .filter(
          (entity) =>
            entity.name === 'straight-rail' &&
            (entity.direction ?? 0) === 0 &&
            entity.position.x > -77,
        )
        .map((entity) => entity.position.x),
    ),
  ].sort((left, right) => left - right);
  const lastPathX = pathXs[stationCount - 1];
  if (lastPathX === undefined) throw new Error(`station fan has no path ${stationCount}`);

  let entities = sourceEntities.filter(
    (entity) =>
      !(
        entity.name === 'straight-rail' &&
        (entity.direction ?? 0) === 0 &&
        entity.position.x > lastPathX
      ) &&
      !(entity.name === 'rail-signal' && entity.position.x >= lastPathX + 4.5) &&
      !(entity.name === 'big-electric-pole' && entity.position.x >= lastPathX + 10),
  );

  // Removing an unused vertical leaves its two curves and throat as internal dead ends. Peel those
  // leaves back to the preceding switch, while preserving the fan's four connections to the grid.
  for (;;) {
    const leaves = new Set(
      buildRailGraph(entities)
        .nodes.filter(
          (node) =>
            node.entityNumbers.length === 1 &&
            !node.connectionPoints.some((point) => externalEnds.has(connectionKey(point))),
        )
        .flatMap((node) => node.entityNumbers),
    );
    if (leaves.size === 0) break;
    entities = entities.filter((entity) => !leaves.has(entity.entity_number));
  }

  return compactBlueprint({ ...structuredClone(fourPath), entities });
}

/** Repeat the complete rightmost C branch isolated by the checked-in three-path derivative. */
function extendStationFan(stationCount: number): Blueprint {
  const blueprint = structuredClone(fourPath);
  const entities = blueprint.entities ?? [];
  const threePathSignatures = new Set((threePath.entities ?? []).map(entitySignature));
  const branch = entities.filter((entity) => !threePathSignatures.has(entitySignature(entity)));
  const branchPole = branch.find((entity) => entity.name === 'big-electric-pole');
  if (!branchPole) throw new Error('station fan extension has no electric pole');

  let nextEntityNumber = Math.max(0, ...entities.map(({ entity_number }) => entity_number)) + 1;
  let previousPole = branchPole;
  const wires = blueprint.wires ?? [];

  for (let pathIndex = 4; pathIndex < stationCount; pathIndex += 1) {
    const offset = { x: RAIL_BRICK_STATION_PITCH * (pathIndex - 3), y: 0 };
    let copiedPole: Entity | undefined;
    for (const source of branch) {
      const entity = {
        ...translateEntity(source, offset),
        entity_number: nextEntityNumber++,
      };
      entities.push(entity);
      if (entity.name === 'big-electric-pole') copiedPole = entity;
    }
    if (!copiedPole) throw new Error(`station fan extension path ${pathIndex + 1} has no pole`);
    wires.push([previousPole.entity_number, 5, copiedPole.entity_number, 5]);
    previousPole = copiedPole;
  }

  blueprint.entities = entities;
  blueprint.wires = wires;
  return blueprint;
}

function mergeBlueprint(
  target: Blueprint,
  source: Blueprint,
  transform: (entity: Entity) => Entity,
) {
  const targetEntities = target.entities ?? [];
  const sourceEntities = source.entities ?? [];
  const existing = new Map(targetEntities.map((entity) => [entitySignature(entity), entity]));
  const numberBySignature = new Map(
    targetEntities.map((entity) => [entitySignature(entity), entity.entity_number]),
  );
  const oldToNew = new Map<number, number>();
  let nextEntityNumber =
    Math.max(0, ...targetEntities.map(({ entity_number }) => entity_number)) + 1;

  for (const sourceEntity of sourceEntities) {
    const transformed = transform(sourceEntity);
    const signature = entitySignature(transformed);
    const entityNumber = numberBySignature.get(signature) ?? nextEntityNumber++;
    oldToNew.set(sourceEntity.entity_number, entityNumber);
    numberBySignature.set(signature, entityNumber);
  }

  for (const sourceEntity of sourceEntities) {
    const transformed = transform(sourceEntity);
    if (existing.has(entitySignature(transformed))) continue;
    const entity = renumberEntity(transformed, oldToNew);
    targetEntities.push(entity);
    existing.set(entitySignature(entity), entity);
  }

  target.entities = targetEntities;
  target.wires = mergeWires(
    target.wires ?? [],
    (source.wires ?? []).map(([left, leftConnector, right, rightConnector]) => [
      requiredNumber(oldToNew, left),
      leftConnector,
      requiredNumber(oldToNew, right),
      rightConnector,
    ]),
  );
}

function compactBlueprint(blueprint: Blueprint): Blueprint {
  const entities = blueprint.entities ?? [];
  const oldToNew = new Map(entities.map((entity, index) => [entity.entity_number, index + 1]));
  return {
    ...blueprint,
    entities: entities.map((entity) => renumberEntity(entity, oldToNew)),
    wires: blueprint.wires
      ?.filter(([left, , right]) => oldToNew.has(left) && oldToNew.has(right))
      .map(([left, leftConnector, right, rightConnector]) => [
        requiredNumber(oldToNew, left),
        leftConnector,
        requiredNumber(oldToNew, right),
        rightConnector,
      ]),
  };
}

function renumberEntity(entity: Entity, oldToNew: Map<number, number>): Entity {
  const result = structuredClone(entity);
  result.entity_number = requiredNumber(oldToNew, entity.entity_number);
  result.neighbours = result.neighbours
    ?.filter((number) => oldToNew.has(number))
    .map((number) => requiredNumber(oldToNew, number));
  if (result.connections) {
    for (const point of Object.values(result.connections)) {
      for (const color of ['red', 'green'] as const) {
        point[color] = point[color]
          ?.filter(({ entity_id }) => oldToNew.has(entity_id))
          .map((connection) => ({
            ...connection,
            entity_id: requiredNumber(oldToNew, connection.entity_id),
          }));
      }
    }
  }
  return result;
}

function mergeWires(target: Wire[], additions: Wire[]): Wire[] {
  const wires = [...target];
  const keys = new Set(wires.map(wireKey));
  for (const wire of additions) {
    const key = wireKey(wire);
    if (keys.has(key)) continue;
    wires.push(wire);
    keys.add(key);
  }
  return wires;
}

function wireKey([left, leftConnector, right, rightConnector]: Wire): string {
  return left < right
    ? `${left}|${leftConnector}|${right}|${rightConnector}`
    : `${right}|${rightConnector}|${left}|${leftConnector}`;
}

function rotateEntity180(entity: Entity): Entity {
  const direction = entity.direction;
  const keepsCanonicalDirection =
    entity.name === 'straight-rail' || entity.name === 'half-diagonal-rail';
  const hasImplicitNorth =
    entity.name.startsWith('curved-rail-') ||
    entity.name === 'rail-signal' ||
    entity.name === 'rail-chain-signal';
  return {
    ...entity,
    position: { x: -entity.position.x, y: -entity.position.y },
    ...(direction === undefined && !hasImplicitNorth
      ? {}
      : { direction: keepsCanonicalDirection ? direction : ((direction ?? 0) + 8) % 16 }),
  };
}

function translateEntity(entity: Entity, offset: Position): Entity {
  return {
    ...entity,
    position: { x: entity.position.x + offset.x, y: entity.position.y + offset.y },
  };
}

function entitySignature(entity: Entity): string {
  return [entity.name, entity.position.x, entity.position.y, entity.direction ?? 0].join('|');
}

function connectionKey({ x2, y2 }: { x2: number; y2: number }): string {
  return `${x2},${y2}`;
}

function requiredNumber(numbers: Map<number, number>, oldNumber: number): number {
  const result = numbers.get(oldNumber);
  if (result === undefined) throw new Error(`missing replacement for entity ${oldNumber}`);
  return result;
}

function validateStationCount(count: number) {
  if (!Number.isInteger(count) || count < 0 || count > RAIL_BRICK_MAX_STATIONS) {
    throw new Error(
      `vertical station count must be an integer from 0 to ${RAIL_BRICK_MAX_STATIONS}, got ${count}`,
    );
  }
}

function blueprintFrom(document: BlueprintDocument): Blueprint {
  if (!('blueprint' in document)) throw new Error('expected a blueprint, not a blueprint book');
  return document.blueprint;
}
