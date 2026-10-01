// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { useState } from 'preact/hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoutingDebug } from '../../src/components/routing-debug.tsx';
import * as routingSolver from '../../src/compute/routing/debug.ts';
import type { RoutingDebugEntity, RoutingDebugState } from '../../src/boot/url-handler.tsx';
import { packEnvelope, parseEnvelope } from '../../src/boot/url-envelope.ts';

function Example({ initial = {} }: { initial?: RoutingDebugState }) {
  const state = useState<RoutingDebugState | undefined>(initial);
  return (
    <>
      <RoutingDebug state={state} />
      <output>{JSON.stringify(state[0])}</output>
    </>
  );
}

describe('RoutingDebug', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('applies the contention strategy, draws maximum counts, and switches back to routes', async () => {
    const user = userEvent.setup();
    render(
      <Example
        initial={{
          width: 9,
          height: 9,
          entities: [
            { kind: 'source', x: 1, y: 4, direction: 'east', item: 'iron', rate: 5 },
            { kind: 'sink', x: 7, y: 4, direction: 'east', item: 'iron', rate: 5 },
            { kind: 'source', x: 4, y: 1, direction: 'south', item: 'copper', rate: 5 },
            { kind: 'sink', x: 4, y: 7, direction: 'south', item: 'copper', rate: 5 },
          ],
        }}
      />,
    );
    const strategy = screen.getByRole('combobox', { name: 'Routing strategy' });
    await user.selectOptions(strategy, 'contention');
    await user.click(screen.getByRole('button', { name: 'Apply routing settings' }));
    expect(screen.getByRole('group', { name: 'Maximum routing contention' })).toBeTruthy();
    expect(screen.getByRole('img', { name: '2 competing paths at (4, 4)' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: /Computed path/ })).toBeNull();
    expect(screen.getByLabelText('Routing result').textContent).toContain('3 completed passes');
    const rd = JSON.parse(screen.getByRole('status').textContent!);
    expect(rd.routingOptions.strategy).toBe('contention');
    const packed = { v: 1 as const, cs: '', gp: 0, cl: [], ci: 0, mo: {}, rd };
    expect(parseEnvelope(`#${packEnvelope(packed)}`)).toEqual({ kind: 'ok', packed });
    await user.selectOptions(strategy, 'conflict-only');
    await user.click(screen.getByRole('button', { name: 'Apply routing settings' }));
    expect(screen.queryByRole('group', { name: 'Maximum routing contention' })).toBeNull();
    expect(screen.getByRole('img', { name: 'Computed path for iron' })).toBeTruthy();
    expect(
      JSON.parse(screen.getByRole('status').textContent!).routingOptions.strategy,
    ).toBeUndefined();
  });

  it('applies strategy and all search budgets together, persists them, and resets the defaults', async () => {
    const user = userEvent.setup();
    const initial: RoutingDebugState = {
      width: 9,
      height: 9,
      entities: [
        { kind: 'source', x: 1, y: 4, direction: 'east', item: 'iron', rate: 5 },
        { kind: 'sink', x: 7, y: 4, direction: 'east', item: 'iron', rate: 3 },
      ],
    };
    const solver = vi.spyOn(routingSolver, 'solveRoutingDebug');
    render(<Example initial={initial} />);
    const strategy = screen.getByRole('combobox', { name: 'Routing strategy' });
    const total = screen.getByRole('spinbutton', { name: 'Total A* states' });
    const conflicts = screen.getByRole('spinbutton', { name: 'Conflict search nodes' });
    const reservations = screen.getByRole('spinbutton', { name: 'Reservation A* states' });
    expect((strategy as HTMLSelectElement).value).toBe('reservation-first');
    expect((total as HTMLInputElement).value).toBe('2000000');
    expect((conflicts as HTMLInputElement).value).toBe('4096');
    expect((reservations as HTMLInputElement).value).toBe('50000');
    const calls = solver.mock.calls.length;
    await user.selectOptions(strategy, 'conflict-only');
    for (const [field, value] of [
      [total, '0'],
      [conflicts, '100'],
      [reservations, '1000'],
    ] as const) {
      await user.clear(field);
      await user.type(field, value);
    }
    expect(solver.mock.calls).toHaveLength(calls);
    expect(screen.getByRole('img', { name: 'Computed path for iron' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Apply routing settings' }));
    expect(screen.queryByRole('img', { name: /Computed path/ })).toBeNull();
    expect(screen.getByLabelText('Routing result').textContent).toContain(
      'Routing search limit reached',
    );
    const rd = JSON.parse(screen.getByRole('status').textContent!);
    expect(rd).toEqual({
      ...initial,
      routingOptions: {
        reservationFirst: false,
        maxPathStates: 0,
        maxNodes: 100,
        maxReservationStates: 1000,
      },
    });
    const packed = { v: 1 as const, cs: '', gp: 0, cl: [], ci: 0, mo: {}, rd };
    expect(parseEnvelope(`#${packEnvelope(packed)}`)).toEqual({ kind: 'ok', packed });
    await user.click(screen.getByRole('button', { name: 'Reset routing defaults' }));
    expect((strategy as HTMLSelectElement).value).toBe('reservation-first');
    expect((total as HTMLInputElement).value).toBe('2000000');
    expect((conflicts as HTMLInputElement).value).toBe('4096');
    expect((reservations as HTMLInputElement).value).toBe('50000');
    expect(screen.getByRole('img', { name: 'Computed path for iron' })).toBeTruthy();
    expect(JSON.parse(screen.getByRole('status').textContent!)).toEqual(initial);
  });

  it('enables underground belts, applies their reach, and persists and disables the setting', async () => {
    const user = userEvent.setup();
    const initial: RoutingDebugState = {
      width: 9,
      height: 1,
      entities: [
        { kind: 'source', x: 0, y: 0, direction: 'east', item: 'iron', rate: 5 },
        { kind: 'sink', x: 8, y: 0, direction: 'east', item: 'iron', rate: 5 },
      ],
      rectangles: [{ x: 4, y: 0, width: 2, height: 1 }],
    };
    const solver = vi.spyOn(routingSolver, 'solveRoutingDebug');
    render(<Example initial={initial} />);
    const toggle = screen.getByRole('combobox', { name: 'Underground belts' });
    const reach = screen.getByRole('spinbutton', {
      name: 'Belt reach (hidden tiles)',
    }) as HTMLInputElement;
    expect((toggle as HTMLSelectElement).value).toBe('disabled');
    expect(reach.disabled).toBe(true);
    expect(screen.queryByRole('img', { name: /Computed path/ })).toBeNull();
    const calls = solver.mock.calls.length;
    await user.selectOptions(toggle, 'enabled');
    expect(reach.disabled).toBe(false);
    await user.clear(reach);
    await user.type(reach, '3');
    expect(solver.mock.calls).toHaveLength(calls);
    await user.click(screen.getByRole('button', { name: 'Apply routing settings' }));
    expect(screen.getByRole('img', { name: 'Computed path for iron' })).toBeTruthy();
    expect(screen.getByLabelText('Routing result').textContent).toBe('1 route, 4 path tiles.');
    const rd = JSON.parse(screen.getByRole('status').textContent!);
    expect(rd.routingOptions.undergroundBeltReach).toBe(3);
    expect(rd.rectangles).toEqual(initial.rectangles);
    const packed = { v: 1 as const, cs: '', gp: 0, cl: [], ci: 0, mo: {}, rd };
    expect(parseEnvelope(`#${packEnvelope(packed)}`)).toEqual({ kind: 'ok', packed });
    await user.selectOptions(toggle, 'disabled');
    expect(reach.disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Apply routing settings' }));
    expect(screen.queryByRole('img', { name: /Computed path/ })).toBeNull();
    expect(
      JSON.parse(screen.getByRole('status').textContent!).routingOptions.undergroundBeltReach,
    ).toBeUndefined();
  });

  it('darkens only underground spans, including pairs with no hidden tiles', () => {
    const cell = (x: number) => ({ x, y: 0 });
    vi.spyOn(routingSolver, 'solveRoutingDebug').mockReturnValue({
      kind: 'found',
      routes: [
        {
          id: 'iron',
          kind: 'found',
          cells: [1, 2, 3, 4, 5, 9, 10].map(cell),
          undergroundBelts: [
            { entry: cell(2), exit: cell(3) },
            { entry: cell(5), exit: cell(9) },
          ],
          steps: 9,
          cost: 9,
          turns: 0,
        },
      ],
      steps: 9,
      cost: 9,
      turns: 0,
      diagnostics: { pathSearches: 1, pathStates: 1, expandedNodes: 0, generatedNodes: 1 },
    });
    render(
      <Example
        initial={{
          width: 12,
          height: 1,
          entities: [
            { kind: 'source', x: 0, y: 0, direction: 'east', item: 'iron', rate: 5 },
            { kind: 'sink', x: 11, y: 0, direction: 'east', item: 'iron', rate: 5 },
          ],
        }}
      />,
    );
    expect(screen.getAllByRole('img', { name: /Computed path/ })).toHaveLength(1);
    for (const [entry, exit] of [
      [2, 3],
      [5, 9],
    ]) {
      const tunnel = screen.getByLabelText(
        `Underground path for iron from (${entry}, 0) to (${exit}, 0)`,
      );
      expect(tunnel.getAttribute('points')).toBe(`${entry + 0.5},0.5 ${exit + 0.5},0.5`);
      expect(tunnel.getAttribute('stroke')).toBe('#594300');
    }
    for (const [start, end, points] of [
      [0, 2, '0.5,0.5 1.5,0.5 2.5,0.5'],
      [3, 5, '3.5,0.5 4.5,0.5 5.5,0.5'],
      [9, 11, '9.5,0.5 10.5,0.5 11.5,0.5'],
    ] as const) {
      const surface = screen.getByLabelText(
        `Surface path for iron from (${start}, 0) to (${end}, 0)`,
      );
      expect(surface.getAttribute('points')).toBe(points);
      expect(surface.getAttribute('stroke')).toBe('#b28600');
    }
  });

  it('loads saved reach, rejects invalid reach, allows zero, and resets underground routing', async () => {
    const user = userEvent.setup();
    const initial: RoutingDebugState = { routingOptions: { undergroundBeltReach: 12 } };
    const solver = vi.spyOn(routingSolver, 'solveRoutingDebug');
    render(<Example initial={initial} />);
    const toggle = screen.getByRole('combobox', { name: 'Underground belts' }) as HTMLSelectElement;
    const reach = screen.getByRole('spinbutton', {
      name: 'Belt reach (hidden tiles)',
    }) as HTMLInputElement;
    expect(toggle.value).toBe('enabled');
    expect(reach.value).toBe('12');
    const calls = solver.mock.calls.length;
    for (const value of ['', '-1', '1.5', '9007199254740992']) {
      await user.clear(reach);
      if (value) await user.type(reach, value);
      await user.click(screen.getByRole('button', { name: 'Apply routing settings' }));
      expect(solver.mock.calls).toHaveLength(calls);
      expect(JSON.parse(screen.getByRole('status').textContent!)).toEqual(initial);
    }
    await user.clear(reach);
    await user.type(reach, '0');
    await user.click(screen.getByRole('button', { name: 'Apply routing settings' }));
    expect(
      JSON.parse(screen.getByRole('status').textContent!).routingOptions.undergroundBeltReach,
    ).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Reset routing defaults' }));
    expect(toggle.value).toBe('disabled');
    expect(reach.disabled).toBe(true);
    expect(JSON.parse(screen.getByRole('status').textContent!).routingOptions).toBeUndefined();
  });

  it('loads saved routing settings and rejects invalid budgets without running the solver', async () => {
    const user = userEvent.setup();
    const initial: RoutingDebugState = {
      routingOptions: {
        reservationFirst: false,
        maxPathStates: 10_000,
        maxNodes: 10,
        maxReservationStates: 50,
      },
    };
    const solver = vi.spyOn(routingSolver, 'solveRoutingDebug');
    render(<Example initial={initial} />);
    expect(
      (screen.getByRole('combobox', { name: 'Routing strategy' }) as HTMLSelectElement).value,
    ).toBe('conflict-only');
    const input = screen.getByRole('spinbutton', { name: 'Reservation A* states' });
    expect((input as HTMLInputElement).value).toBe('50');
    const calls = solver.mock.calls.length;
    for (const value of ['', '-1', '1.5', '9007199254740992']) {
      await user.clear(input);
      if (value) await user.type(input, value);
      await user.click(screen.getByRole('button', { name: 'Apply routing settings' }));
      expect(solver.mock.calls).toHaveLength(calls);
      expect(JSON.parse(screen.getByRole('status').textContent!)).toEqual(initial);
    }
  });

  it('draws all paired paths without shared cells and leaves derived routes out of URL state', () => {
    const initial: RoutingDebugState = {
      width: 9,
      height: 9,
      entities: [
        { kind: 'source', x: 1, y: 4, direction: 'east', item: 'iron', rate: 5 },
        { kind: 'sink', x: 7, y: 4, direction: 'east', item: 'iron', rate: 3 },
        { kind: 'source', x: 4, y: 1, direction: 'south', item: 'copper', rate: 5 },
        { kind: 'sink', x: 4, y: 7, direction: 'south', item: 'copper', rate: 3 },
      ],
    };
    render(<Example initial={initial} />);
    const paths = screen.getAllByRole('img', { name: /Computed path/ });
    expect(paths).toHaveLength(2);
    const cells = paths.flatMap((path) => path.getAttribute('points')!.split(' '));
    expect(new Set(cells).size).toBe(cells.length);
    expect(screen.queryByRole('img', { name: /Routing conflict/ })).toBeNull();
    expect(screen.getByLabelText('Routing result').textContent).toMatch(
      /^2 routes, \d+ path tiles\.$/,
    );
    expect(JSON.parse(screen.getByRole('status').textContent!)).toEqual(initial);
  });

  it('explains an impossible global layout and omits its overlapping provisional paths', () => {
    render(
      <Example
        initial={{
          width: 5,
          height: 5,
          entities: [
            { kind: 'source', x: 0, y: 2, direction: 'east', item: 'iron', rate: 5 },
            { kind: 'sink', x: 4, y: 2, direction: 'east', item: 'iron', rate: 5 },
            { kind: 'source', x: 2, y: 0, direction: 'south', item: 'copper', rate: 5 },
            { kind: 'sink', x: 2, y: 4, direction: 'south', item: 'copper', rate: 5 },
          ],
          rectangles: [
            { x: 0, y: 0, width: 2, height: 2 },
            { x: 3, y: 0, width: 2, height: 2 },
            { x: 0, y: 3, width: 2, height: 2 },
            { x: 3, y: 3, width: 2, height: 2 },
          ],
        }}
      />,
    );
    expect(screen.queryByRole('img', { name: /Computed path/ })).toBeNull();
    expect(screen.getByLabelText('Routing result').textContent).toMatch(
      /No layout can connect all paired items/,
    );
    expect(screen.getByRole('img', { name: /Routing conflict.*at \(2, 2\)/ })).toBeTruthy();
  });

  it('describes a search limit without claiming that no layout exists', () => {
    vi.spyOn(routingSolver, 'solveRoutingDebug').mockReturnValue({
      kind: 'budget-exhausted',
      diagnostics: { pathSearches: 1, pathStates: 1, expandedNodes: 0, generatedNodes: 0 },
    });
    render(<Example />);
    expect(screen.queryByRole('img', { name: /Computed path/ })).toBeNull();
    expect(screen.getByLabelText('Routing result').textContent).toBe(
      'Routing search limit reached before finding non-overlapping paths. A valid layout may still exist. Try moving sources, sinks, or reserved space to give the routes more room.',
    );
  });

  it.each([1, 3])(
    'explains the %i remaining overlaps and identifies an example competing pair',
    (remainingConflicts) => {
      vi.spyOn(routingSolver, 'solveRoutingDebug').mockReturnValue({
        kind: 'budget-exhausted',
        diagnostics: {
          pathSearches: 10,
          pathStates: 100,
          expandedNodes: 5,
          generatedNodes: 11,
          remainingConflicts,
          conflict: { first: 'iron', second: 'copper', cell: { x: 16, y: 13 } },
        },
      });
      render(<Example />);
      const message = screen.getByLabelText('Routing result').textContent!;
      expect(message).toContain('A valid layout may still exist.');
      expect(message).toContain(
        `The best attempt still has ${remainingConflicts} overlapping path ${remainingConflicts === 1 ? 'tile.' : 'tiles.'}`,
      );
      expect(message).toContain('“iron” and “copper” overlap at (16, 13).');
      expect(message).toContain('Try moving their sources or sinks, or nearby reserved space');
      expect(screen.queryByRole('img', { name: /Computed path/ })).toBeNull();
      const marker = screen.getByRole('img', {
        name: 'Routing conflict between iron and copper at (16, 13)',
      });
      expect(marker.getAttribute('transform')).toBe('translate(16 13)');
      expect(marker.getAttribute('pointer-events')).toBe('none');
    },
  );

  it('draws a dark yellow path around reserved space and other entities, respecting endpoint arrows', () => {
    const initial: RoutingDebugState = {
      width: 6,
      height: 5,
      entities: [
        { kind: 'source', x: 0, y: 1, direction: 'east', item: 'iron', rate: 5 },
        { kind: 'sink', x: 5, y: 1, direction: 'east', item: 'iron', rate: 3 },
        { kind: 'source', x: 3, y: 3, direction: 'south', item: 'copper', rate: 1 },
      ],
      rectangles: [{ x: 2, y: 0, width: 2, height: 3 }],
    };
    render(<Example initial={initial} />);
    const path = screen.getByRole('img', { name: 'Computed path for iron' });
    expect(path.getAttribute('stroke')).toBe('#b28600');
    expect(path.getAttribute('pointer-events')).toBe('none');
    const cells = path
      .getAttribute('points')!
      .split(' ')
      .map((point) => point.split(',').map(Number));
    expect(cells[0]).toEqual([0.5, 1.5]);
    expect(cells[1]).toEqual([1.5, 1.5]);
    expect(cells.at(-2)).toEqual([4.5, 1.5]);
    expect(cells.at(-1)).toEqual([5.5, 1.5]);
    expect(cells.some(([, y]) => y >= 3.5)).toBe(true);
    for (const [x, y] of cells) {
      expect(x >= 2 && x < 4 && y < 3).toBe(false);
      expect(x === 3.5 && y === 3.5).toBe(false);
    }
    expect(JSON.parse(screen.getByRole('status').textContent!)).toEqual(initial);
  });

  it('extends paths outside buildings to the source and sink centres', () => {
    render(
      <Example
        initial={{
          width: 10,
          height: 6,
          entities: [
            { kind: 'source', x: 4, y: 3, direction: 'east', item: 'iron', rate: 5 },
            { kind: 'sink', x: 8, y: 3, direction: 'east', item: 'iron', rate: 5 },
            { kind: 'source', x: 2, y: 4, direction: 'south', item: 'copper', rate: 5 },
          ],
          rectangles: [
            { x: 2, y: 2, width: 3, height: 3 },
            { x: 8, y: 2, width: 2, height: 3 },
          ],
        }}
      />,
    );
    expect(screen.getByRole('img', { name: 'Computed path for iron' }).getAttribute('points')).toBe(
      '4.5,3.5 5.5,3.5 6.5,3.5 7.5,3.5 8.5,3.5',
    );
  });

  it('draws a shared connection tile when source and sink face the same intervening tile', () => {
    render(
      <Example
        initial={{
          entities: [
            { kind: 'source', x: 2, y: 3, direction: 'east', item: 'iron', rate: 5 },
            { kind: 'sink', x: 4, y: 3, direction: 'east', item: 'iron', rate: 5 },
          ],
        }}
      />,
    );
    expect(screen.getByRole('img', { name: 'Computed path for iron' }).getAttribute('points')).toBe(
      '2.5,3.5 3.5,3.5 4.5,3.5',
    );
  });

  it('routes each item only when it has exactly one source and one sink', () => {
    const entity = (
      kind: RoutingDebugEntity['kind'],
      item: string,
      x: number,
      y: number,
    ): RoutingDebugEntity => ({ kind, item, x, y, direction: 'east', rate: 5 });
    render(
      <Example
        initial={{
          width: 5,
          height: 6,
          entities: [
            entity('source', 'iron', 0, 0),
            entity('sink', 'iron', 4, 0),
            entity('source', 'copper', 0, 1),
            entity('sink', 'copper', 4, 1),
            entity('source', 'tin', 0, 2),
            entity('source', 'tin', 1, 2),
            entity('sink', 'tin', 4, 2),
            entity('source', 'lead', 0, 3),
            entity('sink', 'lead', 3, 3),
            entity('sink', 'lead', 4, 3),
            entity('source', 'gold', 0, 4),
            entity('sink', 'coal', 4, 5),
          ],
        }}
      />,
    );
    expect(screen.getAllByRole('img', { name: /Computed path/ })).toHaveLength(2);
    expect(screen.getByRole('img', { name: 'Computed path for iron' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Computed path for copper' })).toBeTruthy();
  });

  it.each([
    { width: 5, height: 3, rectangles: [{ x: 2, y: 0, width: 1, height: 3 }] },
    { width: 262_145, height: 3 },
  ])('omits paths when the search cannot route the grid %#', (geometry) => {
    render(
      <Example
        initial={{
          ...geometry,
          entities: [
            { kind: 'source', x: 0, y: 1, direction: 'east', item: 'iron', rate: 5 },
            { kind: 'sink', x: 4, y: 1, direction: 'east', item: 'iron', rate: 5 },
          ],
        }}
      />,
    );
    expect(screen.queryByRole('img', { name: /Computed path/ })).toBeNull();
  });

  it('recomputes paths when endpoint directions and items change and removes them after deletion', async () => {
    const user = userEvent.setup();
    render(
      <Example
        initial={{
          width: 5,
          height: 4,
          entities: [
            { kind: 'source', x: 0, y: 1, direction: 'east', item: 'iron', rate: 5 },
            { kind: 'sink', x: 4, y: 1, direction: 'east', item: 'iron', rate: 5 },
          ],
        }}
      />,
    );
    expect(screen.getByRole('img', { name: 'Computed path for iron' }).getAttribute('points')).toBe(
      '0.5,1.5 1.5,1.5 2.5,1.5 3.5,1.5 4.5,1.5',
    );
    await user.click(screen.getByRole('button', { name: /Source at/ }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Direction' }), 'south');
    expect(
      screen.getByRole('img', { name: 'Computed path for iron' }).getAttribute('points'),
    ).toMatch(/^0\.5,1\.5 0\.5,2\.5 /);
    const item = screen.getByRole('combobox', { name: 'Provided item' });
    await user.clear(item);
    await user.type(item, 'copper');
    expect(screen.queryByRole('img', { name: /Computed path/ })).toBeNull();
    await user.clear(item);
    await user.type(item, 'iron');
    expect(screen.getByRole('img', { name: 'Computed path for iron' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: /Sink at/ }));
    expect(screen.queryByRole('img', { name: /Computed path/ })).toBeNull();
  });

  it('starts at 96 by 64 tiles and saves resized dimensions in URL state', async () => {
    const user = userEvent.setup();
    render(<Example />);
    expect(screen.getByRole('group', { name: /Routing grid/ }).getAttribute('viewBox')).toBe(
      '0 0 96 64',
    );
    await user.clear(screen.getByRole('spinbutton', { name: 'Width' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Width' }), '48');
    await user.clear(screen.getByRole('spinbutton', { name: 'Height' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Height' }), '32');
    await user.click(screen.getByRole('button', { name: 'Resize grid' }));
    const grid = screen.getByRole('group', { name: 'Routing grid, 48 by 32 tiles' });
    expect(grid.getAttribute('viewBox')).toBe('0 0 48 32');
    const rd = JSON.parse(screen.getByRole('status').textContent!);
    expect(rd).toEqual({ width: 48, height: 32 });
    const packed = { v: 1 as const, cs: '', gp: 0, cl: [], ci: 0, mo: {}, rd };
    expect(parseEnvelope(`#${packEnvelope(packed)}`)).toEqual({ kind: 'ok', packed });
  });

  it('loads saved dimensions and rejects empty, zero, and fractional sizes', async () => {
    const user = userEvent.setup();
    render(<Example initial={{ width: 120, height: 80 }} />);
    const width = screen.getByRole('spinbutton', { name: 'Width' });
    const resize = screen.getByRole('button', { name: 'Resize grid' });
    for (const value of ['', '0', '1.5']) {
      await user.clear(width);
      if (value) await user.type(width, value);
      await user.click(resize);
      expect(screen.getByRole('group', { name: /Routing grid/ }).getAttribute('viewBox')).toBe(
        '0 0 120 80',
      );
    }
    expect(JSON.parse(screen.getByRole('status').textContent!)).toEqual({ width: 120, height: 80 });
  });

  it('places sources and sinks on scaled tiles, prevents overlaps, and persists their properties', async () => {
    const user = userEvent.setup();
    render(<Example />);
    const grid = screen.getByRole('group', { name: /Routing grid/ });
    vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 200, 960, 640));
    // Normal mode never creates an entity.
    fireEvent.click(grid, { clientX: 135, clientY: 245 });
    expect(JSON.parse(screen.getByRole('status').textContent!)).toEqual({});
    await user.click(screen.getByRole('button', { name: 'Add source' }));
    expect(screen.getByRole('button', { name: 'Add source' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    await user.clear(screen.getByRole('combobox', { name: 'Provided item' }));
    await user.type(screen.getByRole('combobox', { name: 'Provided item' }), 'iron');
    await user.clear(screen.getByRole('spinbutton', { name: 'Rate (items/s)' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Rate (items/s)' }), '12.5');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Direction' }), 'south');
    fireEvent.click(grid, { clientX: 135, clientY: 245 });
    const source = screen.getByRole('button', {
      name: 'Source at (3, 4), iron, 12.5 items/s, south',
    });
    expect(source.getAttribute('transform')).toBe('translate(3 4)');
    await user.click(source);
    // Also reject clicks on the far boundary or outside the grid.
    fireEvent.click(grid, { clientX: 1060, clientY: 840 });
    fireEvent.click(grid, { clientX: 99, clientY: 200 });
    await user.click(screen.getByRole('button', { name: 'Add sink' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Direction' }), 'west');
    fireEvent.click(grid, { clientX: 1055, clientY: 835 });
    expect(
      screen.getByRole('button', { name: 'Sink at (95, 63), iron, 12.5 items/s, west' }),
    ).toBeTruthy();
    const rd = JSON.parse(screen.getByRole('status').textContent!);
    expect(rd.entities).toEqual([
      { kind: 'source', x: 3, y: 4, item: 'iron', rate: 12.5, direction: 'south' },
      { kind: 'sink', x: 95, y: 63, item: 'iron', rate: 12.5, direction: 'west' },
    ]);
    const packed = { v: 1 as const, cs: '', gp: 0, cl: [], ci: 0, mo: {}, rd };
    expect(parseEnvelope(`#${packEnvelope(packed)}`)).toEqual({ kind: 'ok', packed });
  });

  it('autosaves selected entities’ item, rate, and direction, then deletes by tile', async () => {
    const user = userEvent.setup();
    const entities: RoutingDebugEntity[] = [
      { kind: 'source', x: 2, y: 3, item: 'iron', rate: 5, direction: 'east' },
      { kind: 'sink', x: 8, y: 9, item: 'iron', rate: 5, direction: 'north' },
    ];
    render(<Example initial={{ entities }} />);
    await user.click(screen.getByRole('button', { name: /Source at/ }));
    expect(
      (screen.getByRole('combobox', { name: 'Provided item' }) as HTMLInputElement).value,
    ).toBe('iron');
    await user.clear(screen.getByRole('combobox', { name: 'Provided item' }));
    await user.type(screen.getByRole('combobox', { name: 'Provided item' }), 'copper');
    await user.clear(screen.getByRole('spinbutton', { name: 'Rate (items/s)' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Rate (items/s)' }), '7.25');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Direction' }), 'north');
    expect(
      screen.getByRole('button', { name: 'Source at (2, 3), copper, 7.25 items/s, north' }),
    ).toBeTruthy();
    const sink = screen.getByRole('button', { name: /Sink at/ });
    sink.focus();
    await user.keyboard('{Enter}');
    expect(
      (screen.getByRole('combobox', { name: 'Consumed item' }) as HTMLInputElement).value,
    ).toBe('iron');
    await user.clear(screen.getByRole('spinbutton', { name: 'Rate (items/s)' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Rate (items/s)' }), '0');
    expect(JSON.parse(screen.getByRole('status').textContent!).entities[1].rate).toBe(5);
    await user.clear(screen.getByRole('spinbutton', { name: 'Rate (items/s)' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Rate (items/s)' }), '10');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: /Source at/ }));
    expect(screen.queryByRole('button', { name: /Source at/ })).toBeNull();
    expect(screen.queryByRole('combobox', { name: /item/ })).toBeNull();
    expect(JSON.parse(screen.getByRole('status').textContent!).entities).toEqual([
      { ...entities[1], rate: 10 },
    ]);
  });

  it('does not place invalid entities or shrink the grid over existing entities', async () => {
    const user = userEvent.setup();
    render(<Example initial={{ width: 10, height: 10 }} />);
    const grid = screen.getByRole('group', { name: /Routing grid/ });
    // A non-square display box letterboxes the square grid; ignore its left margin.
    vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 200, 200, 100));
    await user.click(screen.getByRole('button', { name: 'Add source' }));
    await user.clear(screen.getByRole('combobox', { name: 'Provided item' }));
    fireEvent.click(grid, { clientX: 245, clientY: 295 });
    expect(screen.queryByRole('button', { name: /Source at/ })).toBeNull();
    await user.type(screen.getByRole('combobox', { name: 'Provided item' }), 'iron');
    for (const rate of ['', '0', '-1']) {
      await user.clear(screen.getByRole('spinbutton', { name: 'Rate (items/s)' }));
      if (rate) await user.type(screen.getByRole('spinbutton', { name: 'Rate (items/s)' }), rate);
      fireEvent.click(grid, { clientX: 245, clientY: 295 });
      expect(screen.queryByRole('button', { name: /Source at/ })).toBeNull();
    }
    await user.clear(screen.getByRole('spinbutton', { name: 'Rate (items/s)' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Rate (items/s)' }), '1');
    fireEvent.click(grid, { clientX: 125, clientY: 205 });
    expect(screen.queryByRole('button', { name: /Source at/ })).toBeNull();
    fireEvent.click(grid, { clientX: 245, clientY: 295 });
    expect(screen.getByRole('button', { name: /Source at \(9, 9\)/ })).toBeTruthy();
    await user.clear(screen.getByRole('spinbutton', { name: 'Width' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Width' }), '9');
    await user.click(screen.getByRole('button', { name: 'Resize grid' }));
    expect(screen.getByRole('alert').textContent).toContain('outside the new size');
    expect(grid.getAttribute('viewBox')).toBe('0 0 10 10');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: /Source at/ }));
    await user.click(screen.getByRole('button', { name: 'Resize grid' }));
    expect(grid.getAttribute('viewBox')).toBe('0 0 9 10');
  });

  it('drags sources and sinks to empty tiles, retains selection and autosaving, and ignores the drag click', async () => {
    const user = userEvent.setup();
    const entities: RoutingDebugEntity[] = [
      { kind: 'source', x: 2, y: 3, item: 'iron', rate: 5, direction: 'east' },
      { kind: 'sink', x: 8, y: 9, item: 'iron', rate: 5, direction: 'west' },
    ];
    render(<Example initial={{ entities }} />);
    const grid = screen.getByRole('group', { name: /Routing grid/ });
    vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 200, 960, 640));
    const source = screen.getByRole('button', { name: /Source at/ });
    fireEvent.pointerDown(source, { pointerId: 1, button: 0, clientX: 125, clientY: 235 });
    fireEvent.pointerMove(grid, { pointerId: 1, clientX: 155, clientY: 265 });
    expect(source.getAttribute('transform')).toBe('translate(5 6)');
    expect(JSON.parse(screen.getByRole('status').textContent!).entities).toEqual(entities);
    fireEvent.pointerUp(grid, { pointerId: 1, clientX: 155, clientY: 265 });
    fireEvent.click(grid, { clientX: 155, clientY: 265 });
    expect(
      screen.getByRole('button', { name: /Source at \(5, 6\)/ }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.getByRole('group', { name: 'Source at (5, 6)' })).toBeTruthy();
    await user.clear(screen.getByRole('spinbutton', { name: 'Rate (items/s)' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Rate (items/s)' }), '7');
    const sink = screen.getByRole('button', { name: /Sink at/ });
    fireEvent.pointerDown(sink, { pointerId: 2, button: 0, clientX: 185, clientY: 295 });
    fireEvent.pointerUp(grid, { pointerId: 2, clientX: 1055, clientY: 835 });
    expect(JSON.parse(screen.getByRole('status').textContent!).entities).toEqual([
      { ...entities[0], x: 5, y: 6, rate: 7 },
      { ...entities[1], x: 95, y: 63 },
    ]);
  });

  it('preserves clicks and rejects cancelled, occupied, blocked-connection, and out-of-bounds drops', async () => {
    const user = userEvent.setup();
    const initial: RoutingDebugState = {
      entities: [
        { kind: 'source', x: 2, y: 3, item: 'iron', rate: 5, direction: 'east' },
        { kind: 'sink', x: 8, y: 9, item: 'iron', rate: 5, direction: 'west' },
      ],
      rectangles: [{ x: 10, y: 10, width: 5, height: 5 }],
    };
    render(<Example initial={initial} />);
    const grid = screen.getByRole('group', { name: /Routing grid/ });
    vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 200, 960, 640));
    const source = screen.getByRole('button', { name: /Source at/ });
    fireEvent.pointerDown(source, { pointerId: 1, button: 0, clientX: 125, clientY: 235 });
    fireEvent.pointerUp(grid, { pointerId: 1, clientX: 126, clientY: 236 });
    await user.click(source);
    expect(screen.getByRole('combobox', { name: 'Provided item' })).toBeTruthy();
    for (const [clientX, clientY] of [
      [185, 295],
      [215, 315],
      [1065, 845],
    ]) {
      fireEvent.pointerDown(source, { pointerId: 1, button: 0, clientX: 125, clientY: 235 });
      fireEvent.pointerMove(grid, { pointerId: 1, clientX, clientY });
      fireEvent.pointerUp(grid, { pointerId: 1, clientX, clientY });
      expect(JSON.parse(screen.getByRole('status').textContent!)).toEqual(initial);
    }
    fireEvent.pointerDown(source, { pointerId: 1, button: 0, clientX: 125, clientY: 235 });
    fireEvent.pointerMove(grid, { pointerId: 1, clientX: 155, clientY: 265 });
    fireEvent.pointerCancel(grid, { pointerId: 1 });
    expect(source.getAttribute('transform')).toBe('translate(2 3)');
    expect(JSON.parse(screen.getByRole('status').textContent!)).toEqual(initial);
  });

  it('draws one reserved rectangle in either drag direction and persists it without adding an editor', async () => {
    const user = userEvent.setup();
    render(<Example initial={{ width: 10, height: 10 }} />);
    const grid = screen.getByRole('group', { name: /Routing grid/ });
    vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 200, 200, 100));
    await user.click(screen.getByRole('button', { name: 'Reserve space' }));
    expect(screen.queryByRole('combobox', { name: /item/ })).toBeNull();
    for (const [startX, startY, endX, endY] of [
      [225, 275, 175, 225],
      [155, 205, 165, 215],
    ]) {
      fireEvent.pointerDown(grid, { pointerId: 1, button: 0, clientX: startX, clientY: startY });
      fireEvent.pointerMove(grid, { pointerId: 1, clientX: endX, clientY: endY });
      fireEvent.pointerUp(grid, { pointerId: 1, clientX: endX, clientY: endY });
      fireEvent.click(grid, { clientX: endX, clientY: endY });
    }
    const rectangle = screen.getByRole('img', { name: 'Reserved space at (2, 2), 6 by 6 tiles' });
    expect(rectangle.tagName.toLowerCase()).toBe('rect');
    expect(rectangle.getAttribute('width')).toBe('6');
    expect(rectangle.getAttribute('height')).toBe('6');
    expect(screen.getAllByRole('img')).toHaveLength(2);
    const rd = JSON.parse(screen.getByRole('status').textContent!);
    expect(rd.rectangles).toEqual([
      { x: 2, y: 2, width: 6, height: 6 },
      { x: 0, y: 0, width: 2, height: 2 },
    ]);
    const packed = { v: 1 as const, cs: '', gp: 0, cl: [], ci: 0, mo: {}, rd };
    expect(parseEnvelope(`#${packEnvelope(packed)}`)).toEqual({ kind: 'ok', packed });
    await user.click(screen.getByRole('button', { name: 'Add source' }));
    fireEvent.click(grid, { clientX: 175, clientY: 225 });
    expect(screen.queryByRole('button', { name: /Source at/ })).toBeNull();
    fireEvent.click(grid, { clientX: 245, clientY: 295 });
    expect(screen.getByRole('button', { name: /Source at \(9, 9\)/ })).toBeTruthy();
  });

  it('does not reserve over connections, commit clicks or cancelled drags, or crop saved reserved space', async () => {
    const user = userEvent.setup();
    const initial: RoutingDebugState = {
      width: 10,
      height: 10,
      entities: [{ kind: 'source', x: 3, y: 3, item: 'iron', rate: 5, direction: 'east' }],
      rectangles: [{ x: 7, y: 7, width: 3, height: 3 }],
    };
    render(<Example initial={initial} />);
    const grid = screen.getByRole('group', { name: /Routing grid/ });
    vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 200, 100, 100));
    await user.click(screen.getByRole('button', { name: 'Reserve space' }));
    fireEvent.pointerDown(grid, { pointerId: 1, button: 0, clientX: 125, clientY: 225 });
    fireEvent.pointerUp(grid, { pointerId: 1, clientX: 126, clientY: 226 });
    fireEvent.click(grid, { clientX: 126, clientY: 226 });
    fireEvent.pointerDown(grid, { pointerId: 1, button: 0, clientX: 125, clientY: 225 });
    fireEvent.pointerUp(grid, { pointerId: 1, clientX: 155, clientY: 255 });
    fireEvent.pointerDown(grid, { pointerId: 1, button: 0, clientX: 105, clientY: 205 });
    fireEvent.pointerMove(grid, { pointerId: 1, clientX: 115, clientY: 215 });
    fireEvent.pointerCancel(grid, { pointerId: 1 });
    expect(JSON.parse(screen.getByRole('status').textContent!)).toEqual(initial);
    await user.clear(screen.getByRole('spinbutton', { name: 'Width' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Width' }), '9');
    await user.click(screen.getByRole('button', { name: 'Resize grid' }));
    expect(screen.getByRole('alert').textContent).toContain('Reserved space');
    expect(grid.getAttribute('viewBox')).toBe('0 0 10 10');
  });

  it.each([
    { kind: 'source', direction: 'north', x: 5, y: 4, blockedDirection: 'south' },
    { kind: 'source', direction: 'east', x: 6, y: 5, blockedDirection: 'west' },
    { kind: 'source', direction: 'south', x: 5, y: 6, blockedDirection: 'north' },
    { kind: 'source', direction: 'west', x: 4, y: 5, blockedDirection: 'east' },
    { kind: 'sink', direction: 'north', x: 5, y: 6, blockedDirection: 'south' },
    { kind: 'sink', direction: 'east', x: 4, y: 5, blockedDirection: 'west' },
    { kind: 'sink', direction: 'south', x: 5, y: 4, blockedDirection: 'north' },
    { kind: 'sink', direction: 'west', x: 6, y: 5, blockedDirection: 'east' },
  ] as const)(
    'allows a $direction-facing $kind inside reserved space when its connection is outside',
    async ({ kind, direction, x, y, blockedDirection }) => {
      const user = userEvent.setup();
      render(<Example initial={{ rectangles: [{ x: 4, y: 4, width: 3, height: 3 }] }} />);
      const grid = screen.getByRole('group', { name: /Routing grid/ });
      vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 200, 960, 640));
      await user.click(
        screen.getByRole('button', { name: kind === 'source' ? 'Add source' : 'Add sink' }),
      );
      await user.selectOptions(screen.getByRole('combobox', { name: 'Direction' }), direction);
      // Deep inside the block, every adjacent connection is reserved.
      fireEvent.click(grid, { clientX: 155, clientY: 255 });
      expect(JSON.parse(screen.getByRole('status').textContent!).entities).toBeUndefined();
      fireEvent.click(grid, { clientX: 105 + x * 10, clientY: 205 + y * 10 });
      const entity = { kind, direction, x, y, item: 'item-1', rate: 5 };
      expect(JSON.parse(screen.getByRole('status').textContent!).entities).toEqual([entity]);
      await user.click(screen.getByRole('button', { name: 'Normal' }));
      const port = screen.getByRole('button', {
        name: kind === 'source' ? /Source at/ : /Sink at/,
      });
      await user.click(port);
      const blocked = screen
        .getAllByRole('option')
        .find(
          (option) => (option as HTMLOptionElement).value === blockedDirection,
        ) as HTMLOptionElement;
      expect(blocked.disabled).toBe(true);
      await user.selectOptions(
        screen.getByRole('combobox', { name: 'Direction' }),
        blockedDirection,
      );
      expect(JSON.parse(screen.getByRole('status').textContent!).entities).toEqual([entity]);
      // Moving inward must also keep the old position when the new connection would be blocked.
      fireEvent.pointerDown(port, {
        pointerId: 1,
        button: 0,
        clientX: 105 + x * 10,
        clientY: 205 + y * 10,
      });
      fireEvent.pointerUp(grid, { pointerId: 1, clientX: 155, clientY: 255 });
      expect(JSON.parse(screen.getByRole('status').textContent!).entities).toEqual([entity]);
      // Sliding along the block's edge leaves the connection free and is allowed.
      const destination = x === 5 ? { x: 4, y } : { x, y: 4 };
      fireEvent.pointerDown(port, {
        pointerId: 1,
        button: 0,
        clientX: 105 + x * 10,
        clientY: 205 + y * 10,
      });
      fireEvent.pointerUp(grid, {
        pointerId: 1,
        clientX: 105 + destination.x * 10,
        clientY: 205 + destination.y * 10,
      });
      expect(JSON.parse(screen.getByRole('status').textContent!).entities).toEqual([
        { ...entity, ...destination },
      ]);
    },
  );

  it('shows rectangle dimensions while placing and focusing reserved space', async () => {
    const user = userEvent.setup();
    render(<Example />);
    const grid = screen.getByRole('group', { name: /Routing grid/ });
    vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 200, 960, 640));
    await user.click(screen.getByRole('button', { name: 'Reserve space' }));
    fireEvent.pointerDown(grid, { pointerId: 1, button: 0, clientX: 115, clientY: 215 });
    fireEvent.pointerMove(grid, { pointerId: 1, clientX: 155, clientY: 235 });
    expect(screen.getByText('5x3')).toBeTruthy();
    expect(JSON.parse(screen.getByRole('status').textContent!).rectangles).toBeUndefined();
    fireEvent.pointerUp(grid, { pointerId: 1, clientX: 155, clientY: 235 });
    fireEvent.click(grid, { clientX: 155, clientY: 235 });
    expect(screen.getByText('5x3')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Normal' }));
    fireEvent.click(grid, { clientX: 105, clientY: 205 });
    expect(screen.queryByText('5x3')).toBeNull();
    const rectangle = screen.getByRole('img', { name: /Reserved space at/ });
    fireEvent.focus(rectangle);
    expect(screen.getByText('5x3')).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: /item/ })).toBeNull();
    fireEvent.blur(rectangle);
    expect(screen.queryByText('5x3')).toBeNull();
    await user.hover(rectangle);
    expect(screen.getByText('5x3')).toBeTruthy();
  });

  it('moves rectangles by their grab offset and keeps their dimensions and entities unchanged', () => {
    const entities: RoutingDebugEntity[] = [
      { kind: 'source', x: 8, y: 5, item: 'iron', rate: 5, direction: 'east' },
    ];
    const rectangle = { x: 4, y: 4, width: 5, height: 3 };
    render(<Example initial={{ entities, rectangles: [rectangle] }} />);
    const grid = screen.getByRole('group', { name: /Routing grid/ });
    vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 200, 960, 640));
    const reserved = screen.getByRole('img', { name: /Reserved space at/ });
    fireEvent.pointerDown(reserved, { pointerId: 1, button: 0, clientX: 165, clientY: 255 });
    fireEvent.pointerMove(grid, { pointerId: 1, clientX: 185, clientY: 285 });
    expect(reserved.getAttribute('x')).toBe('6');
    expect(reserved.getAttribute('y')).toBe('7');
    expect(screen.getByText('5x3')).toBeTruthy();
    expect(JSON.parse(screen.getByRole('status').textContent!).rectangles).toEqual([rectangle]);
    fireEvent.pointerUp(grid, { pointerId: 1, clientX: 185, clientY: 285 });
    fireEvent.click(grid, { clientX: 185, clientY: 285 });
    const rd = JSON.parse(screen.getByRole('status').textContent!);
    expect(rd).toEqual({ entities, rectangles: [{ ...rectangle, x: 6, y: 7 }] });
    expect(screen.getByText('5x3')).toBeTruthy();
    const packed = { v: 1 as const, cs: '', gp: 0, cl: [], ci: 0, mo: {}, rd };
    expect(parseEnvelope(`#${packEnvelope(packed)}`)).toEqual({ kind: 'ok', packed });
  });

  it('rejects rectangle moves that cover connection tiles or cross grid edges, and cancels cleanly', () => {
    const initial: RoutingDebugState = {
      entities: [{ kind: 'source', x: 1, y: 2, item: 'iron', rate: 5, direction: 'east' }],
      rectangles: [{ x: 4, y: 4, width: 5, height: 3 }],
    };
    render(<Example initial={initial} />);
    const grid = screen.getByRole('group', { name: /Routing grid/ });
    vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 200, 960, 640));
    const rectangle = screen.getByRole('img', { name: /Reserved space at/ });
    for (const [clientX, clientY] of [
      [125, 225],
      [105, 205],
      [1055, 835],
    ]) {
      fireEvent.pointerDown(rectangle, { pointerId: 1, button: 0, clientX: 165, clientY: 255 });
      fireEvent.pointerUp(grid, { pointerId: 1, clientX, clientY });
      expect(JSON.parse(screen.getByRole('status').textContent!)).toEqual(initial);
    }
    fireEvent.pointerDown(rectangle, { pointerId: 1, button: 0, clientX: 165, clientY: 255 });
    fireEvent.pointerMove(grid, { pointerId: 1, clientX: 185, clientY: 285 });
    fireEvent.pointerCancel(grid, { pointerId: 1 });
    expect(rectangle.getAttribute('x')).toBe('4');
    expect(rectangle.getAttribute('y')).toBe('4');
    expect(JSON.parse(screen.getByRole('status').textContent!)).toEqual(initial);
  });

  it('deletes clicked rectangles in Delete mode, preserving underlying rectangles and enclosed entities', async () => {
    const user = userEvent.setup();
    const entity: RoutingDebugEntity = {
      kind: 'source',
      x: 6,
      y: 5,
      item: 'iron',
      rate: 5,
      direction: 'east',
    };
    const rectangles = [
      { x: 4, y: 4, width: 3, height: 3 },
      { x: 5, y: 4, width: 2, height: 2 },
      { x: 1, y: 1, width: 2, height: 2 },
    ];
    render(<Example initial={{ entities: [entity], rectangles }} />);
    const grid = screen.getByRole('group', { name: /Routing grid/ });
    vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 200, 960, 640));
    fireEvent.click(grid, { clientX: 155, clientY: 245 });
    expect(JSON.parse(screen.getByRole('status').textContent!).rectangles).toEqual(rectangles);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(
      screen.getByRole('button', { name: 'Reserved space at (5, 4), 2 by 2 tiles' }),
    );
    expect(JSON.parse(screen.getByRole('status').textContent!)).toEqual({
      entities: [entity],
      rectangles: [rectangles[0], rectangles[2]],
    });
    // Clicking a port inside a reservation deletes only the port.
    await user.click(screen.getByRole('button', { name: /Source at/ }));
    expect(JSON.parse(screen.getByRole('status').textContent!).rectangles).toEqual([
      rectangles[0],
      rectangles[2],
    ]);
    // Empty grid clicks do nothing; tile clicks within a reservation delete the whole rectangle.
    fireEvent.click(grid, { clientX: 195, clientY: 295 });
    expect(screen.getAllByRole('button', { name: /Reserved space at/ })).toHaveLength(2);
    fireEvent.click(grid, { clientX: 155, clientY: 245 });
    expect(JSON.parse(screen.getByRole('status').textContent!).rectangles).toEqual([rectangles[2]]);
    screen.getByRole('button', { name: /Reserved space at/ }).focus();
    await user.keyboard('{Enter}');
    expect(JSON.parse(screen.getByRole('status').textContent!)).toEqual({
      entities: [],
      rectangles: [],
    });
  });

  it('reserves over source and sink bodies but rejects rectangles over their connection tiles', async () => {
    const user = userEvent.setup();
    const entities: RoutingDebugEntity[] = [
      { kind: 'source', x: 6, y: 5, item: 'iron', rate: 5, direction: 'east' },
      { kind: 'sink', x: 4, y: 4, item: 'iron', rate: 5, direction: 'east' },
    ];
    render(<Example initial={{ entities }} />);
    const grid = screen.getByRole('group', { name: /Routing grid/ });
    vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 200, 960, 640));
    await user.click(screen.getByRole('button', { name: 'Reserve space' }));
    fireEvent.pointerDown(grid, { pointerId: 1, button: 0, clientX: 165, clientY: 265 });
    fireEvent.pointerUp(grid, { pointerId: 1, clientX: 145, clientY: 245 });
    expect(JSON.parse(screen.getByRole('status').textContent!).rectangles).toEqual([
      { x: 4, y: 4, width: 3, height: 3 },
    ]);
    for (const [clientX, clientY] of [
      [175, 255],
      [135, 245],
    ]) {
      fireEvent.pointerDown(grid, { pointerId: 1, button: 0, clientX, clientY });
      fireEvent.pointerUp(grid, { pointerId: 1, clientX: clientX + 10, clientY: clientY + 10 });
      expect(JSON.parse(screen.getByRole('status').textContent!).rectangles).toHaveLength(1);
    }
    expect(JSON.parse(screen.getByRole('status').textContent!).entities).toEqual(entities);
  });
});
