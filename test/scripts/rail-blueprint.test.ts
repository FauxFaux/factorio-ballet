import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  encodeBlueprintDocument,
  findBlueprintOverlay,
  inspectRailBlueprint,
  removeRightmostTrainPath,
} from '../../scripts/rail-blueprint.ts';
import { decodeDocument, type Blueprint, type BlueprintDocument } from '../../src/bp/decode.ts';

const fixturePaths = {
  '3x-train-layout': 'docs/blueprints/3x-train-layout.json',
  '4x-train-layout': 'docs/blueprints/4x-train-layout.json',
  'empty-plus-left-four': 'docs/blueprints/empty-plus-left-four.json',
  'empty-plus-right-four': 'docs/blueprints/empty-plus-right-four.json',
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
});
