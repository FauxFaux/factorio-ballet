import { describe, expect, it } from 'vitest';
import { buildRailBrick, encodeBlueprintDocument } from '../src/bp/rail-blueprint.ts';
import { decodeDocument } from '../src/bp/decode.ts';
import { buildRailGraph } from '../src/bp/rail.ts';

describe('rail brick blueprint generation', () => {
  it.each([
    [0, 0],
    [1, 1],
    [2, 3],
    [4, 4],
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
    expect([27, 39, 51, 63].filter((x) => verticalXs.has(x))).toEqual(
      [27, 39, 51, 63].slice(0, inputs),
    );
    expect([197, 185, 173, 161].filter((x) => verticalXs.has(x))).toEqual(
      [197, 185, 173, 161].slice(0, outputs),
    );
    expect(new Set(entities.map((entity) => entity.entity_number)).size).toBe(entities.length);
    expect(
      document.blueprint.wires?.every(([left, , right]) =>
        [left, right].every((number) => entities.some((entity) => entity.entity_number === number)),
      ),
    ).toBe(true);
    expect(decodeDocument(encodeBlueprintDocument(document))).toEqual(document);
  });

  it('rejects more station paths than the regular brick supports', () => {
    expect(() => buildRailBrick(5, 2)).toThrow('integer from 0 to 4');
  });
});
