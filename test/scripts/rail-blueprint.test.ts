import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildStackedTrain,
  encodeBlueprintDocument,
  findBlueprintOverlay,
  inspectRailBlueprint,
  removeRightmostTrainPath,
} from '../../scripts/rail-blueprint.ts';
import { decodeDocument, type Blueprint, type BlueprintDocument } from '../../src/bp/decode.ts';
import { findStackedRailLayout } from '../../src/bp/rail.ts';

const fixturePaths = {
  '3x-train-layout': 'docs/blueprints/3x-train-layout.json',
  '4x-train-layout': 'docs/blueprints/4x-train-layout.json',
  'empty-plus-left-four': 'docs/blueprints/empty-plus-left-four.json',
  'empty-plus-right-four': 'docs/blueprints/empty-plus-right-four.json',
  'stacked-segment': 'docs/blueprints/1x-stacked-train-s.json',
  'stacked-two': 'docs/blueprints/2x-stacked-train.json',
  'stacked-nine': 'docs/blueprints/9x-stacked-train.json',
} as const;
type FixtureName = keyof typeof fixturePaths;

const fixture = (name: FixtureName): BlueprintDocument =>
  JSON.parse(readFileSync(fixturePaths[name], 'utf8')) as BlueprintDocument;

const blueprint = (name: FixtureName): Blueprint => {
  const document = fixture(name);
  if (!('blueprint' in document)) throw new Error(`${name} is not a blueprint`);
  return document.blueprint;
};

describe('rail blueprint script', () => {
  it('reports the rail topology summary', () => {
    expect(inspectRailBlueprint(blueprint('4x-train-layout'))).toMatchObject({
      label: '4x train layout',
      entities: 215,
      rails: 198,
      nodeDegrees: { 1: 4, 2: 183, 3: 6, 4: 2 },
    });
  });

  it('finds the exact direct and half-turn overlays', () => {
    const layout = blueprint('4x-train-layout');

    expect(findBlueprintOverlay(layout, blueprint('empty-plus-left-four'))).toEqual({
      rotation: 0,
      offset: { x: -1152, y: 0 },
      matchingRails: 198,
      matchingEntities: 215,
      sourceEntities: 215,
    });
    expect(findBlueprintOverlay(layout, blueprint('empty-plus-right-four'), 180)).toEqual({
      rotation: 180,
      offset: { x: -1120, y: -1312 },
      matchingRails: 198,
      matchingEntities: 215,
      sourceEntities: 215,
    });
  });

  it('reproduces the importable three-path derivative', () => {
    const result = removeRightmostTrainPath(fixture('4x-train-layout'));

    expect(result.report).toEqual({
      pathX: -33,
      removedEntities: 44,
      removedRails: 41,
      remainingEntities: 171,
      openRailEnds: 4,
    });
    expect(result.document).toEqual(fixture('3x-train-layout'));
    expect(decodeDocument(encodeBlueprintDocument(result.document))).toEqual(result.document);
  });

  it.each([2, 3, 4, 5, 6, 7, 8, 9])(
    'builds a connected %i-row stacked station overlay',
    (stations) => {
      const result = buildStackedTrain(
        fixture('stacked-two'),
        fixture('stacked-segment'),
        stations,
      );
      const layout = findStackedRailLayout(blueprintFrom(result.document));

      expect(layout.rows).toHaveLength(stations);
      expect(layout.pitch).toBe(10);
      expect(result.report).toMatchObject({ stations, pitch: 10, openRailEnds: 8 });
      expect(decodeDocument(encodeBlueprintDocument(result.document))).toEqual(result.document);
    },
  );

  it('recognizes the hand-built nine-row reference', () => {
    const layout = findStackedRailLayout(blueprint('stacked-nine').entities ?? []);

    expect(layout.pitch).toBe(10);
    expect(layout.rows.map(({ y }) => y)).toEqual([
      -367, -357, -347, -337, -327, -317, -307, -297, -287,
    ]);
    expect(inspectRailBlueprint(blueprint('stacked-nine')).nodeDegrees).toMatchObject({ 1: 4 });
  });

  it('rejects unsupported stacked station counts', () => {
    expect(() => buildStackedTrain(fixture('stacked-two'), fixture('stacked-segment'), 10)).toThrow(
      'integer from 2 to 9',
    );
  });
});

function blueprintFrom(document: BlueprintDocument) {
  if (!('blueprint' in document)) throw new Error('expected blueprint');
  return document.blueprint.entities ?? [];
}
