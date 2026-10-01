import { describe, expect, it } from 'vitest';
import type { RoutingDebugState } from '../../../src/boot/url-handler.tsx';
import { solveRoutingDebug } from '../../../src/compute/routing/debug.ts';
import { solveConflictRouting } from '../../../src/compute/routing/conflict-search.ts';
import { packEnvelope, parseEnvelope } from '../../../src/boot/url-envelope.ts';

const state: RoutingDebugState = {
  width: 9,
  height: 9,
  entities: [
    { kind: 'source', x: 1, y: 4, direction: 'east', item: 'iron', rate: 5 },
    { kind: 'sink', x: 7, y: 4, direction: 'east', item: 'iron', rate: 3 },
    { kind: 'source', x: 4, y: 1, direction: 'south', item: 'copper', rate: 5 },
    { kind: 'sink', x: 4, y: 7, direction: 'south', item: 'copper', rate: 3 },
  ],
  rectangles: [{ x: 8, y: 8, width: 1, height: 1 }],
};

describe('solveRoutingDebug', () => {
  it('loads persisted strategy and budgets while allowing an explicit solver override', () => {
    const saved: RoutingDebugState = {
      ...state,
      routingOptions: {
        reservationFirst: false,
        maxPathStates: 0,
        maxNodes: 12,
        maxReservationStates: 30,
      },
    };
    expect(solveRoutingDebug(saved)).toMatchObject({
      kind: 'budget-exhausted',
      diagnostics: { pathStates: 0, reservationPasses: 0 },
    });
    expect(solveRoutingDebug(saved, {})).toEqual(solveRoutingDebug(state));
    const packed = { v: 1 as const, cs: '', gp: 0, cl: [], ci: 0, mo: {}, rd: saved };
    const parsed = parseEnvelope(`#${packEnvelope(packed)}`);
    expect(parsed.kind).toBe('ok');
    if (parsed.kind === 'ok')
      expect(solveRoutingDebug(parsed.packed.rd!)).toEqual(solveRoutingDebug(saved));
  });

  it('routes three pairs around a shared obstacle and reproduces their detours from the URL', () => {
    const detours: RoutingDebugState = {
      width: 64,
      height: 32,
      entities: [10, 15, 5].flatMap((y, index) => [
        {
          kind: 'source' as const,
          x: 23,
          y,
          direction: 'east' as const,
          item: String(index + 1),
          rate: 5,
        },
        {
          kind: 'sink' as const,
          x: 36,
          y,
          direction: 'east' as const,
          item: String(index + 1),
          rate: 5,
        },
      ]),
      rectangles: [{ x: 28, y: 0, width: 4, height: 19 }],
    };
    const result = solveRoutingDebug(detours);
    expect(result.kind).toBe('found');
    if (result.kind !== 'found') return;
    expect(result.routes).toHaveLength(3);
    expect(result.steps).toBe(101);
    expect(result.diagnostics.pathStates).toBeLessThan(25_000);
    expect(solveRoutingDebug({ ...detours, entities: [...detours.entities!].reverse() })).toEqual(
      result,
    );
    const packed = { v: 1 as const, cs: '', gp: 0, cl: [], ci: 0, mo: {}, rd: detours };
    const parsed = parseEnvelope(`#${packEnvelope(packed)}`);
    expect(parsed.kind).toBe('ok');
    if (parsed.kind === 'ok') expect(solveRoutingDebug(parsed.packed.rd!)).toEqual(result);
  });

  it('routes adjacent connection tiles globally and reproduces the layout after URL packing', () => {
    const result = solveRoutingDebug(state);
    expect(result.kind).toBe('found');
    if (result.kind !== 'found') return;
    expect(result.routes.map(({ id }) => id)).toEqual(['copper', 'iron']);
    expect(result.routes[0].cells[0]).toEqual({ x: 4, y: 2 });
    expect(result.routes[0].cells.at(-1)).toEqual({ x: 4, y: 6 });
    expect(result.routes[1].cells[0]).toEqual({ x: 2, y: 4 });
    expect(result.routes[1].cells.at(-1)).toEqual({ x: 6, y: 4 });
    const cells = result.routes.flatMap((route) => route.cells.map(({ x, y }) => `${x},${y}`));
    expect(new Set(cells).size).toBe(cells.length);
    expect(solveRoutingDebug({ ...state, entities: [...state.entities!].reverse() })).toEqual(
      result,
    );
    const packed = { v: 1 as const, cs: '', gp: 0, cl: [], ci: 0, mo: {}, rd: state };
    const parsed = parseEnvelope(`#${packEnvelope(packed)}`);
    expect(parsed.kind).toBe('ok');
    if (parsed.kind === 'ok') expect(solveRoutingDebug(parsed.packed.rd!)).toEqual(result);
  });

  it('does not route ambiguous or incomplete item pairs, but retains their entity obstacles', () => {
    const result = solveRoutingDebug({
      ...state,
      entities: [
        ...state.entities!,
        { ...state.entities![0], x: 0, y: 0 },
        { ...state.entities![0], x: 0, y: 1, item: 'tin' },
      ],
    });
    expect(result.kind).toBe('found');
    if (result.kind === 'found') expect(result.routes.map(({ id }) => id)).toEqual(['copper']);
  });

  it('allows swapping the global solver at the normalized grid boundary', () => {
    const result = solveRoutingDebug(state, {}, (input, options) => {
      expect(input.blocked[4 * 9 + 1]).toBe(1);
      expect(input.blocked[8 * 9 + 8]).toBe(1);
      expect(input.routes).toContainEqual({
        id: 'iron',
        start: { x: 2, y: 4 },
        goal: { x: 6, y: 4 },
      });
      return solveConflictRouting(input, options);
    });
    expect(result).toEqual(solveRoutingDebug(state));
  });

  it('validates all geometry even when there are no complete pairs', () => {
    expect(solveRoutingDebug({ width: 0 })).toMatchObject({ kind: 'invalid' });
    expect(solveRoutingDebug({ entities: [state.entities![0], state.entities![0]] })).toMatchObject(
      { kind: 'invalid' },
    );
    expect(
      solveRoutingDebug({ ...state, rectangles: [{ x: 2, y: 4, width: 1, height: 1 }] }),
    ).toMatchObject({ kind: 'invalid' });
  });
});
