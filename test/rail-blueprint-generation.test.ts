import { describe, expect, it } from 'vitest';
import { buildRailBrick, encodeBlueprintDocument } from '../src/bp/rail-blueprint.ts';
import { decodeDocument } from '../src/bp/decode.ts';
import { buildRailGraph, findStackedRailLayout } from '../src/bp/rail.ts';

describe('rail brick blueprint generation', () => {
  it.each([
    [0, 0],
    [1, 1],
    [2, 3],
    [4, 4],
    [5, 7],
    [16, 16],
  ])('builds a connected regular brick with %i input and %i output stations', (inputs, outputs) => {
    const document = buildRailBrick(inputs, outputs);
    if (!('blueprint' in document)) throw new Error('expected blueprint');

    const entities = document.blueprint.entities ?? [];
    const graph = buildRailGraph(entities);
    const verticalXs = new Set(
      entities
        .filter((entity) => entity.name === 'straight-rail' && (entity.direction ?? 0) === 0)
        .map((entity) => entity.position.x),
    );
    expect(graph.nodes.filter((node) => node.entityNumbers.length === 1)).toHaveLength(12);
    const inputXs = Array.from({ length: inputs }, (_, index) => 27 + index * 12);
    const outputXs = Array.from({ length: outputs }, (_, index) => 197 - index * 12);
    expect(inputXs.filter((x) => verticalXs.has(x))).toEqual(inputXs);
    expect(outputXs.filter((x) => verticalXs.has(x))).toEqual(outputXs);
    expect(new Set(entities.map((entity) => entity.entity_number)).size).toBe(entities.length);
    expect(
      document.blueprint.wires?.every(([left, , right]) =>
        [left, right].every((number) => entities.some((entity) => entity.entity_number === number)),
      ),
    ).toBe(true);
    expect(decodeDocument(encodeBlueprintDocument(document))).toEqual(document);
  });

  it('rejects more station paths than the regular brick supports', () => {
    expect(() => buildRailBrick(17, 2)).toThrow('integer from 0 to 16');
  });

  it.each([2, 3, 4, 5, 6, 7, 8, 9])(
    'builds a %i-row stacked input fan alongside regular outputs',
    (inputs) => {
      const document = buildRailBrick(-inputs, 2);
      if (!('blueprint' in document)) throw new Error('expected blueprint');

      const entities = document.blueprint.entities ?? [];
      const layout = findStackedRailLayout(entities.filter((entity) => entity.position.x < 100));
      expect(layout.rows).toHaveLength(inputs);
      expect(layout.pitch).toBe(10);
      expect(
        entities.some(
          (entity) =>
            entity.name === 'straight-rail' &&
            (entity.direction ?? 0) === 0 &&
            entity.position.x === 197,
        ),
      ).toBe(true);
      expect(decodeDocument(encodeBlueprintDocument(document))).toEqual(document);
    },
  );

  it('rejects unsupported stacked input counts', () => {
    expect(() => buildRailBrick(-1, 2)).toThrow('integer from 2 to 9');
    expect(() => buildRailBrick(-10, 2)).toThrow('integer from 2 to 9');
  });
});
