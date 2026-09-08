import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { buildBeltGraph } from '../../src/bp/belt.ts';
import { isBeltEntity, type BeltLaneRef } from '../../src/bp/belt-model.ts';
import { traceBeltPaths, traceBeltToSplitter } from '../../src/bp/belt-trace.ts';
import { decode } from '../../src/bp/decode.ts';

const fixture = decode(
  readFileSync(new URL('../../docs/blueprints/belt-loop.base64', import.meta.url), 'utf8'),
);

const ref = (entityNumber: number, lane: 'left' | 'right'): BeltLaneRef => ({
  entityNumber,
  line: 'left',
  lane,
});

describe('blueprint belt geometry', () => {
  test('recognizes every tier of transport entity in the fixture', () => {
    const belts = (fixture.entities ?? []).filter(isBeltEntity);

    expect(belts).toHaveLength(50);
    expect(belts.map((entity) => entity.entity_number)).toContain(9);
    expect(belts.map((entity) => entity.entity_number)).toContain(33);
  });

  test('pairs underground endpoints without connecting the crossing belt', () => {
    const graph = buildBeltGraph(fixture.entities ?? []);

    expect(graph.undergroundPairs).toEqual([
      { inputEntityNumber: 19, outputEntityNumber: 23, span: 6 },
      { inputEntityNumber: 26, outputEntityNumber: 30, span: 7 },
    ]);
    expect(
      graph.connections.some(({ from, to }) => from.entityNumber === 20 && to.entityNumber === 23),
    ).toBe(false);
  });

  test('traces both lanes through an underground belt to a splitter', () => {
    const graph = buildBeltGraph(fixture.entities ?? []);

    for (const lane of ['left', 'right'] as const) {
      const trace = traceBeltToSplitter(graph, ref(16, lane));
      expect(trace.stop).toBe('splitter');
      expect(trace.lanes.map(({ entityNumber }) => entityNumber)).toEqual([16, 17, 18, 19, 23, 24]);
      expect(trace.lanes.every((step) => step.lane === lane)).toBe(true);
    }
  });

  test('preserves both lanes around turns and sideloads only the exposed underground lane', () => {
    const graph = buildBeltGraph(fixture.entities ?? []);

    expect(graph.connections).toContainEqual({
      from: ref(6, 'left'),
      to: ref(5, 'left'),
      kind: 'turn',
    });
    expect(graph.connections).toContainEqual({
      from: ref(6, 'right'),
      to: ref(5, 'right'),
      kind: 'turn',
    });
    expect(
      graph.connections.filter(
        ({ from, to, kind }) =>
          from.entityNumber === 27 && to.entityNumber === 28 && kind === 'sideload',
      ),
    ).toEqual([
      { from: ref(27, 'left'), to: ref(28, 'right'), kind: 'sideload' },
      { from: ref(27, 'right'), to: ref(28, 'right'), kind: 'sideload' },
    ]);
    expect(
      graph.connections.filter(
        ({ from, to, kind }) =>
          from.entityNumber === 15 && to.entityNumber === 30 && kind === 'sideload',
      ),
    ).toEqual([
      {
        from: ref(15, 'left'),
        to: ref(30, 'left'),
        kind: 'sideload',
      },
    ]);
  });

  test('models splitter choices without changing item lanes', () => {
    const graph = buildBeltGraph(fixture.entities ?? []);
    const splitterConnections = graph.connections.filter(
      ({ from, kind }) => from.entityNumber === 24 && kind === 'splitter',
    );

    expect(splitterConnections).toHaveLength(8);
    expect(splitterConnections.every(({ from, to }) => from.lane === to.lane)).toBe(true);
    expect(
      splitterConnections.filter(
        ({ from }) => from.line === 'left' && from.lane === 'left' && from.splitterSide === 'input',
      ),
    ).toHaveLength(2);
  });

  test('finds the two eventual cycles after branching at the top splitter', () => {
    const graph = buildBeltGraph(fixture.entities ?? []);
    const traces = traceBeltPaths(graph, {
      entityNumber: 24,
      line: 'right',
      lane: 'right',
      splitterSide: 'input',
    });

    expect(traces.some(({ stop }) => stop === 'cycle')).toBe(true);
    expect(traces.some(({ lanes }) => lanes.some(({ entityNumber }) => entityNumber === 54))).toBe(
      true,
    );
  });

  test('associates chest-to-belt and belt-to-chest inserters with lanes', () => {
    const graph = buildBeltGraph(fixture.entities ?? []);
    const transfers = new Map(
      graph.inserterTransfers.map((transfer) => [transfer.inserter.entity_number, transfer]),
    );

    expect(transfers.get(2)).toMatchObject({
      source: { entity_number: 1 },
      target: { entity_number: 3 },
      targetBeltLane: { entityNumber: 3, lane: 'right' },
    });
    expect(transfers.get(35)).toMatchObject({
      source: { entity_number: 34 },
      target: { entity_number: 37 },
      targetBeltLane: { entityNumber: 37, lane: 'left' },
    });
    expect(transfers.get(42)).toMatchObject({
      source: { entity_number: 40 },
      target: { entity_number: 41 },
      sourceBeltLanes: [
        { entityNumber: 40, line: 'left', lane: 'left' },
        { entityNumber: 40, line: 'left', lane: 'right' },
      ],
    });
  });
});
