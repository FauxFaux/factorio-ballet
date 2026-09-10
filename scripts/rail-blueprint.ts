#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { strToU8, zlibSync } from 'fflate';
import type { Blueprint, BlueprintDocument, Entity, Position } from '../src/bp/decode.ts';
import {
  buildRailGraph,
  findRailAlignment,
  findStackedRailLayout,
  isRailEntity,
} from '../src/bp/rail.ts';

export interface BlueprintOverlay {
  rotation: 0 | 180;
  offset: Position;
  matchingRails: number;
  matchingEntities: number;
  sourceEntities: number;
}

export interface PathRemovalReport {
  pathX: number;
  removedEntities: number;
  removedRails: number;
  remainingEntities: number;
  openRailEnds: number;
}

export interface StackedRailReport {
  stations: number;
  pitch: number;
  addedSegments: number;
  entities: number;
  rails: number;
  openRailEnds: number;
}

export function inspectRailBlueprint(blueprint: Blueprint) {
  const entities = blueprint.entities ?? [];
  const graph = buildRailGraph(entities);
  const positions = entities.map((entity) => entity.position);
  const entityCounts = Object.fromEntries(
    [...new Set(entities.map((entity) => entity.name))]
      .sort()
      .map((name) => [name, entities.filter((entity) => entity.name === name).length]),
  );
  const nodeDegrees = Object.fromEntries(
    [...new Set(graph.nodes.map((node) => node.entityNumbers.length))]
      .sort((a, b) => a - b)
      .map((degree) => [
        degree,
        graph.nodes.filter((node) => node.entityNumbers.length === degree).length,
      ]),
  );

  return {
    label: blueprint.label,
    entities: entities.length,
    rails: graph.pieces.length,
    bounds:
      positions.length === 0
        ? undefined
        : {
            minX: Math.min(...positions.map(({ x }) => x)),
            maxX: Math.max(...positions.map(({ x }) => x)),
            minY: Math.min(...positions.map(({ y }) => y)),
            maxY: Math.max(...positions.map(({ y }) => y)),
          },
    entityCounts,
    nodeDegrees,
  };
}

export function findBlueprintOverlay(
  source: Blueprint,
  target: Blueprint,
  rotation: 0 | 180 = 0,
): BlueprintOverlay {
  const sourceEntities = source.entities ?? [];
  const targetEntities = target.entities ?? [];
  const transformed = rotation === 180 ? sourceEntities.map(rotateEntity180) : sourceEntities;
  const alignment = findRailAlignment(targetEntities, transformed);
  const targetCounts = countBy(targetEntities.map(entitySignature));
  let matchingEntities = 0;

  for (const entity of transformed) {
    const signature = entitySignature(translateEntity(entity, alignment.offset));
    const available = targetCounts.get(signature) ?? 0;
    if (available === 0) continue;
    matchingEntities += 1;
    targetCounts.set(signature, available - 1);
  }

  return {
    rotation,
    offset: alignment.offset,
    matchingRails: alignment.matchingRails,
    matchingEntities,
    sourceEntities: sourceEntities.length,
  };
}

/** Remove the rightmost branch from the 12-tile-pitch parallel-path fan used by the fixtures. */
export function removeRightmostTrainPath(document: BlueprintDocument): {
  document: BlueprintDocument;
  report: PathRemovalReport;
} {
  if (!('blueprint' in document)) throw new Error('expected a blueprint, not a blueprint book');
  const source = structuredClone(document);
  const blueprint = source.blueprint;
  const entities = blueprint.entities ?? [];
  const rails = entities.filter(isRailEntity);
  const verticalRails = rails.filter(
    (entity) => entity.name === 'straight-rail' && (entity.direction ?? 0) === 0,
  );
  if (verticalRails.length === 0) throw new Error('blueprint has no vertical straight rail');

  const pathX = Math.max(...verticalRails.map((entity) => entity.position.x));
  const pathVerticals = verticalRails.filter((entity) => entity.position.x === pathX);
  const minVerticalY = Math.min(...pathVerticals.map((entity) => entity.position.y));
  const maxVerticalY = Math.max(...pathVerticals.map((entity) => entity.position.y));
  const curveMinX = pathX - 11;
  const branchCurves = rails.filter(
    (entity) =>
      entity.name.startsWith('curved-rail-') &&
      entity.position.x >= curveMinX &&
      (entity.position.y < minVerticalY || entity.position.y > maxVerticalY),
  );
  if (branchCurves.length !== 8) {
    throw new Error(
      `expected eight curves around the rightmost path, found ${branchCurves.length}`,
    );
  }

  const topY = Math.min(...branchCurves.map((entity) => entity.position.y));
  const bottomY = Math.max(...branchCurves.map((entity) => entity.position.y));
  const throatMinX = pathX - 24;
  const removedNumbers = new Set(
    entities
      .filter(
        (entity) =>
          pathVerticals.includes(entity as (typeof pathVerticals)[number]) ||
          branchCurves.includes(entity as (typeof branchCurves)[number]) ||
          (entity.name === 'straight-rail' &&
            entity.direction === 4 &&
            entity.position.x >= throatMinX &&
            (entity.position.y === topY || entity.position.y === bottomY)) ||
          ((entity.name === 'rail-signal' || entity.name === 'rail-chain-signal') &&
            entity.position.x >= pathX - 7.5) ||
          (entity.name === 'big-electric-pole' && entity.position.x >= pathX - 2),
      )
      .map((entity) => entity.entity_number),
  );
  const kept = entities.filter((entity) => !removedNumbers.has(entity.entity_number));
  const oldToNew = new Map(kept.map((entity, index) => [entity.entity_number, index + 1]));
  const beforeOpenEnds = openRailEnds(entities);

  blueprint.label = blueprint.label?.replace(/^4x\b/i, '3x');
  blueprint.entities = kept.map((entity) => renumberEntity(entity, oldToNew));
  blueprint.wires = blueprint.wires
    ?.filter(
      ([sourceEntity, , targetEntity]) => oldToNew.has(sourceEntity) && oldToNew.has(targetEntity),
    )
    .map(([sourceEntity, sourceConnector, targetEntity, targetConnector]) => [
      requiredNumber(oldToNew, sourceEntity),
      sourceConnector,
      requiredNumber(oldToNew, targetEntity),
      targetConnector,
    ]);
  blueprint.schedules = blueprint.schedules?.map((schedule) => ({
    ...schedule,
    locomotives: schedule.locomotives
      .filter((entityNumber) => oldToNew.has(entityNumber))
      .map((entityNumber) => requiredNumber(oldToNew, entityNumber)),
  }));

  const openEnds = openRailEnds(blueprint.entities);
  if (openEnds !== beforeOpenEnds) {
    throw new Error(`path removal changed open rail ends from ${beforeOpenEnds} to ${openEnds}`);
  }

  const removedRails = rails.filter((entity) => removedNumbers.has(entity.entity_number)).length;
  return {
    document: source,
    report: {
      pathX,
      removedEntities: removedNumbers.size,
      removedRails,
      remainingEntities: kept.length,
      openRailEnds: openEnds,
    },
  };
}

/**
 * Extend the two-station stacked fixture with translated copies of its one-station segment.
 *
 * The base owns the special bottom junction and its pieces of the surrounding rail grid. The
 * segment owns one ordinary station bay. Its hand-cut right trunk ends two straight pieces short
 * of the next translated copy, so those joins are supplied here rather than hidden in a fixture.
 */
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
      // The cut includes one tile of each adjoining trunk. Do not leave a dangling left-trunk rail
      // above the base's shared trunk, or a right-trunk rail inside the special bottom junction.
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

  // Nine rows reach the top approach. Its ordinary S-curve is replaced by the compact junction
  // seen in the full 9x fixture, which enters directly from the grid-owned outer vertical.
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

  // Two vertical straights bridge each pair of ordinary copied bays. The lowest copied bay joins
  // the exceptional bottom geometry already present in the two-row base and needs no such fill.
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

export function encodeBlueprintDocument(document: BlueprintDocument): string {
  const compressed = zlibSync(strToU8(JSON.stringify(document)), { level: 9 });
  return `0${Buffer.from(compressed).toString('base64')}`;
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
      : {
          direction: keepsCanonicalDirection ? direction : ((direction ?? 0) + 8) % 16,
        }),
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

function countBy(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
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

function openRailEnds(entities: Entity[]): number {
  return buildRailGraph(entities).nodes.filter((node) => node.entityNumbers.length === 1).length;
}

function renumberEntity(entity: Entity, oldToNew: Map<number, number>): Entity {
  const result = structuredClone(entity);
  result.entity_number = requiredNumber(oldToNew, entity.entity_number);
  result.neighbours = result.neighbours
    ?.filter((entityNumber) => oldToNew.has(entityNumber))
    .map((entityNumber) => requiredNumber(oldToNew, entityNumber));
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

function requiredNumber(numbers: Map<number, number>, oldNumber: number): number {
  const result = numbers.get(oldNumber);
  if (result === undefined) throw new Error(`missing replacement for entity ${oldNumber}`);
  return result;
}

async function readBlueprint(path: string): Promise<BlueprintDocument> {
  return JSON.parse(await readFile(path, 'utf8')) as BlueprintDocument;
}

function unwrap(document: BlueprintDocument): Blueprint {
  if (!('blueprint' in document)) throw new Error('expected a blueprint, not a blueprint book');
  return document.blueprint;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'inspect' && args.length === 1) {
    console.log(
      JSON.stringify(inspectRailBlueprint(unwrap(await readBlueprint(args[0]))), null, 2),
    );
    return;
  }
  if (command === 'overlay' && (args.length === 2 || args.length === 3)) {
    const rotation = args[2] === '--rotate-180' ? 180 : 0;
    if (args[2] !== undefined && rotation === 0) throw new Error(`unknown option ${args[2]}`);
    const source = unwrap(await readBlueprint(args[0]));
    const target = unwrap(await readBlueprint(args[1]));
    console.log(JSON.stringify(findBlueprintOverlay(source, target, rotation), null, 2));
    return;
  }
  if (command === 'remove-rightmost' && args.length === 3) {
    const result = removeRightmostTrainPath(await readBlueprint(args[0]));
    await writeFile(args[1], `${JSON.stringify(result.document, null, 2)}\n`);
    await writeFile(args[2], `${encodeBlueprintDocument(result.document)}\n`);
    console.log(JSON.stringify(result.report, null, 2));
    return;
  }
  if (command === 'stack' && args.length === 5) {
    const stationCount = Number(args[2]);
    const result = buildStackedTrain(
      await readBlueprint(args[0]),
      await readBlueprint(args[1]),
      stationCount,
    );
    await writeFile(args[3], `${JSON.stringify(result.document, null, 2)}\n`);
    await writeFile(args[4], `${encodeBlueprintDocument(result.document)}\n`);
    console.log(JSON.stringify(result.report, null, 2));
    return;
  }

  console.error(`usage:
  ${process.argv[1]} inspect BLUEPRINT.json
  ${process.argv[1]} overlay SOURCE.json TARGET.json [--rotate-180]
  ${process.argv[1]} remove-rightmost INPUT.json OUTPUT.json OUTPUT.base64
  ${process.argv[1]} stack BASE.json SEGMENT.json COUNT OUTPUT.json OUTPUT.base64`);
  process.exitCode = 2;
}

if (import.meta.main) await main();
