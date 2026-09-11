import type { Blueprint, BlueprintDocument, Entity, Position } from './decode.ts';
import { buildRailGraph, findRailAlignment, findStackedRailLayout } from './rail.ts';

export interface StackedRailReport {
  stations: number;
  pitch: number;
  addedSegments: number;
  entities: number;
  rails: number;
  openRailEnds: number;
}

/** Extend the two-station stacked fixture with translated copies of its one-station segment. */
export function buildStackedTrain(
  baseDocument: BlueprintDocument,
  segmentDocument: BlueprintDocument,
  stationCount: number,
): { document: BlueprintDocument; report: StackedRailReport } {
  if (!Number.isInteger(stationCount) || stationCount < 2 || stationCount > 9) {
    throw new Error(`stacked station count must be an integer from 2 to 9, got ${stationCount}`);
  }
  if (!('blueprint' in baseDocument) || !('blueprint' in segmentDocument)) {
    throw new Error('stacked rail inputs must be blueprints, not blueprint books');
  }

  const document = structuredClone(baseDocument);
  const blueprint = document.blueprint;
  const baseEntities = blueprint.entities ?? [];
  const segment = segmentDocument.blueprint;
  const segmentEntities = segment.entities ?? [];
  if (segment.wires?.length || segment.schedules?.length) {
    throw new Error('stacked rail segment must not contain wires or schedules');
  }
  if (segmentEntities.some((entity) => entity.connections || entity.neighbours)) {
    throw new Error('stacked rail segment must not contain entity-number references');
  }

  const baseLayout = findStackedRailLayout(baseEntities);
  const segmentLayout = findStackedRailLayout(segmentEntities);
  if (baseLayout.rows.length !== 2 || segmentLayout.rows.length !== 1) {
    throw new Error(
      `expected a two-row base and one-row segment, found ${baseLayout.rows.length} and ${segmentLayout.rows.length}`,
    );
  }
  const pitch = baseLayout.pitch;
  if (pitch === undefined) throw new Error('two-row stacked base has no pitch');

  const alignment = findRailAlignment(baseEntities, segmentEntities);
  const firstAddedOffset = { x: alignment.offset.x, y: alignment.offset.y - pitch };
  const entities = [...baseEntities];
  const signatures = new Set(entities.map(entitySignature));
  let nextEntityNumber = Math.max(0, ...entities.map(({ entity_number }) => entity_number)) + 1;
  const copiedOffsets: Position[] = [];
  const segmentVerticals = segmentEntities.filter(
    (entity) => entity.name === 'straight-rail' && (entity.direction ?? 0) === 0,
  );
  const leftTrunkX = Math.min(...segmentVerticals.map(({ position }) => position.x));
  const rightTrunkX = Math.max(...segmentVerticals.map(({ position }) => position.x));
  const segmentTopLeftY = Math.min(
    ...segmentVerticals
      .filter(({ position }) => position.x === leftTrunkX)
      .map(({ position }) => position.y),
  );
  const baseLeftTopY = Math.min(
    ...baseEntities
      .filter(
        (entity) =>
          entity.name === 'straight-rail' &&
          (entity.direction ?? 0) === 0 &&
          entity.position.x === leftTrunkX + alignment.offset.x,
      )
      .map(({ position }) => position.y),
  );
  const segmentRightBottomY = Math.max(
    ...segmentVerticals
      .filter(({ position }) => position.x === rightTrunkX)
      .map(({ position }) => position.y),
  );

  for (let index = 0; index < stationCount - 2; index += 1) {
    const offset = { x: firstAddedOffset.x, y: firstAddedOffset.y - index * pitch };
    const topNineRow = stationCount === 9 && index === stationCount - 3;
    copiedOffsets.push(offset);
    for (const source of segmentEntities) {
      if (
        (source.name === 'straight-rail' &&
          (source.direction ?? 0) === 0 &&
          source.position.x === leftTrunkX &&
          source.position.y === segmentTopLeftY &&
          source.position.y + offset.y < baseLeftTopY) ||
        (index === 0 &&
          source.name === 'straight-rail' &&
          (source.direction ?? 0) === 0 &&
          source.position.x === rightTrunkX &&
          source.position.y === segmentRightBottomY) ||
        (topNineRow &&
          source.name.startsWith('curved-rail-') &&
          source.position.x < segmentLayout.rows[0].minX)
      ) {
        continue;
      }
      const entity = translateEntity(source, offset);
      const signature = entitySignature(entity);
      if (signatures.has(signature)) continue;
      entities.push({ ...entity, entity_number: nextEntityNumber });
      nextEntityNumber += 1;
      signatures.add(signature);
    }
  }

  if (copiedOffsets.length > 0) {
    const bottomOffset = copiedOffsets[0];
    addEntity({
      name: 'curved-rail-a',
      position: {
        x: rightTrunkX + bottomOffset.x,
        y: segmentRightBottomY + bottomOffset.y + 1,
      },
      direction: 8,
    });
  }

  if (stationCount === 9) {
    const topOffset = copiedOffsets.at(-1)!;
    const rowY = segmentLayout.rows[0].y + topOffset.y;
    const x = leftTrunkX + topOffset.x;
    addEntity({ name: 'curved-rail-a', position: { x: x - 4, y: rowY - 15 }, direction: 8 });
    addEntity({ name: 'curved-rail-b', position: { x, y: rowY - 6 }, direction: 8 });
    addEntity({ name: 'curved-rail-b', position: { x: x + 4, y: rowY - 2 }, direction: 14 });
    addEntity({ name: 'curved-rail-a', position: { x: x + 9, y: rowY }, direction: 14 });
    addEntity({ name: 'straight-rail', position: { x: x + 12, y: rowY }, direction: 4 });
  }

  const segmentRightTrunk = segmentEntities.filter(
    (entity) =>
      entity.name === 'straight-rail' &&
      (entity.direction ?? 0) === 0 &&
      entity.position.x === rightTrunkX,
  );
  const trunkBottomY = Math.max(...segmentRightTrunk.map(({ position }) => position.y));
  for (const offset of copiedOffsets.slice(1)) {
    for (const dy of [2, 4]) {
      addEntity({
        name: 'straight-rail',
        position: {
          x: segmentRightTrunk[0].position.x + offset.x,
          y: trunkBottomY + offset.y + dy,
        },
      });
    }
  }

  blueprint.entities = entities;
  connectStackedPoles(blueprint, segmentEntities, copiedOffsets, firstAddedOffset.x);
  const finalLayout = findStackedRailLayout(entities);
  if (finalLayout.rows.length !== stationCount || finalLayout.pitch !== pitch) {
    throw new Error(
      `generated ${finalLayout.rows.length} rows at pitch ${finalLayout.pitch ?? 'unknown'}`,
    );
  }
  const graph = buildRailGraph(entities);
  return {
    document,
    report: {
      stations: stationCount,
      pitch,
      addedSegments: stationCount - 2,
      entities: entities.length,
      rails: graph.pieces.length,
      openRailEnds: graph.nodes.filter((node) => node.entityNumbers.length === 1).length,
    },
  };

  function addEntity(entity: Omit<Entity, 'entity_number'>) {
    const complete = { ...entity, entity_number: nextEntityNumber };
    const signature = entitySignature(complete);
    if (signatures.has(signature)) return;
    entities.push(complete);
    nextEntityNumber += 1;
    signatures.add(signature);
  }
}

function connectStackedPoles(
  blueprint: Blueprint,
  segmentEntities: Entity[],
  copiedOffsets: Position[],
  offsetX: number,
) {
  if (copiedOffsets.length === 0) return;
  const segmentPole = segmentEntities.find((entity) => entity.name === 'big-electric-pole');
  if (!segmentPole) throw new Error('stacked rail segment has no electric pole');
  const poleX = segmentPole.position.x + offsetX;
  const poles = (blueprint.entities ?? [])
    .filter((entity) => entity.name === 'big-electric-pole' && entity.position.x === poleX)
    .sort((a, b) => a.position.y - b.position.y);
  const wires = blueprint.wires ?? [];
  const wireKeys = new Set(
    wires.map(([left, leftConnector, right, rightConnector]) =>
      [Math.min(left, right), leftConnector, Math.max(left, right), rightConnector].join('|'),
    ),
  );
  for (let index = 1; index < poles.length; index += 1) {
    const left = poles[index - 1].entity_number;
    const right = poles[index].entity_number;
    const key = [Math.min(left, right), 5, Math.max(left, right), 5].join('|');
    if (wireKeys.has(key)) continue;
    wires.push([left, 5, right, 5]);
    wireKeys.add(key);
  }
  blueprint.wires = wires;
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
