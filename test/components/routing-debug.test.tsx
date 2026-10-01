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
});
