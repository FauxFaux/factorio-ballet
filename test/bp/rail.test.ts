import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { decode, type Entity } from '../../src/bp/decode.ts';
import { buildRailGraph, findRailAlignment, isRailEntity } from '../../src/bp/rail.ts';

const fixturePath = (name: string) =>
  new URL(`../../docs/bluprints/${name}.base64`, import.meta.url);
const fixture = (name: string) => decode(readFileSync(fixturePath(name), 'utf8'));

const entityKey = (entity: Entity, x: number, y: number, direction: number) =>
  [entity.name, x, y, direction].join(':');

const overlayCount = (
  source: Entity[],
  target: Entity[],
  transform: (entity: Entity) => { x: number; y: number; direction: number },
) => {
  const targetEntities = new Set(
    target.map((entity) =>
      entityKey(entity, entity.position.x, entity.position.y, entity.direction ?? 0),
    ),
  );
  return source.filter((entity) => {
    const { x, y, direction } = transform(entity);
    return targetEntities.has(entityKey(entity, x, y, direction));
  }).length;
};

describe('blueprint rail geometry', () => {
  test('closes the smallest curved-rail circle at every end', () => {
    const graph = buildRailGraph(fixture('rail-circle').entities ?? []);

    expect(graph.pieces).toHaveLength(16);
    expect(graph.nodes).toHaveLength(16);
    expect(graph.nodes.every((node) => node.entityNumbers.length === 2)).toBe(true);
  });

  test('joins the straight, half-diagonal, and curved pieces in the r-shaped rail', () => {
    const graph = buildRailGraph(fixture('rail-r').entities ?? []);

    expect(graph.pieces).toHaveLength(12);
    expect(graph.nodes.filter((node) => node.entityNumbers.length === 1)).toHaveLength(2);
    expect(graph.nodes.filter((node) => node.entityNumbers.length === 2)).toHaveLength(11);
  });

  test('represents the brick switches and its twelve external connections', () => {
    const graph = buildRailGraph(fixture('empty-grid-v0').entities ?? []);

    expect(graph.pieces).toHaveLength(784);
    expect(graph.nodes.filter((node) => node.entityNumbers.length === 1)).toHaveLength(12);
    expect(graph.nodes.filter((node) => node.entityNumbers.length === 2)).toHaveLength(724);
    expect(graph.nodes.filter((node) => node.entityNumbers.length === 3)).toHaveLength(36);
  });

  test.each(['empty-plus-left-four', 'empty-plus-right-four'])(
    'aligns %s with the base brick',
    (name) => {
      const base = fixture('empty-grid-v0').entities ?? [];
      const extraTracks = fixture(name).entities ?? [];

      expect(findRailAlignment(base, extraTracks)).toEqual({
        offset: { x: 1248, y: 736 },
        matchingRails: 686,
      });
    },
  );

  test('places the four added vertical tracks on the expected side of the brick', () => {
    const verticalXs = (name: string) => {
      const baseKeys = new Set(
        (fixture('empty-grid-v0').entities ?? [])
          .filter(isRailEntity)
          .map((entity) =>
            [entity.name, entity.position.x, entity.position.y, entity.direction ?? 0].join(':'),
          ),
      );

      return [
        ...new Set(
          (fixture(name).entities ?? [])
            .filter(isRailEntity)
            .filter((entity) => entity.name === 'straight-rail' && (entity.direction ?? 0) === 0)
            .map((entity) => ({ x: entity.position.x + 1248, y: entity.position.y + 736 }))
            .filter(({ x, y }) => !baseKeys.has(`straight-rail:${x}:${y}:0`))
            .map(({ x }) => x),
        ),
      ].sort((a, b) => a - b);
    };

    expect(verticalXs('empty-plus-left-four')).toEqual([27, 39, 51, 63]);
    expect(verticalXs('empty-plus-right-four')).toEqual([161, 173, 185, 197]);
  });

  test('overlays the four-path layout on both plus-four brick variants', () => {
    const layout = fixture('4x-train-layout').entities ?? [];
    const left = fixture('empty-plus-left-four').entities ?? [];
    const right = fixture('empty-plus-right-four').entities ?? [];

    expect(
      overlayCount(layout, left, (entity) => ({
        x: entity.position.x - 1152,
        y: entity.position.y,
        direction: entity.direction ?? 0,
      })),
    ).toBe(layout.length);
    expect(
      overlayCount(layout, right, (entity) => ({
        x: -entity.position.x - 1120,
        y: -entity.position.y - 1312,
        direction:
          entity.name.startsWith('curved-rail-') ||
          entity.name === 'rail-signal' ||
          entity.name === 'rail-chain-signal'
            ? ((entity.direction ?? 0) + 8) % 16
            : (entity.direction ?? 0),
      })),
    ).toBe(layout.length);
  });

  test('removes the complete rightmost path from the three-path derivative', () => {
    const layout = fixture('3x-train-layout').entities ?? [];
    const rails = layout.filter(isRailEntity);
    const graph = buildRailGraph(layout);

    expect(layout).toHaveLength(171);
    expect(rails).toHaveLength(157);
    expect(
      rails.some((entity) => entity.name === 'straight-rail' && entity.position.x === -33),
    ).toBe(false);
    expect(
      [
        ...new Set(
          rails
            .filter((entity) => entity.name === 'straight-rail' && entity.direction === undefined)
            .map((entity) => entity.position.x),
        ),
      ].filter((x) => x > -77),
    ).toEqual([-69, -57, -45]);
    expect(graph.nodes.filter((node) => node.entityNumbers.length === 1)).toHaveLength(4);
  });
});
