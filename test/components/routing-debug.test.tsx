// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { useState } from 'preact/hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoutingDebug } from '../../src/components/routing-debug.tsx';
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
