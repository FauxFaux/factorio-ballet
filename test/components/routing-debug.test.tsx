// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { useState } from 'preact/hooks';
import { afterEach, describe, expect, it } from 'vitest';
import { RoutingDebug } from '../../src/components/routing-debug.tsx';
import type { RoutingDebugState } from '../../src/boot/url-handler.tsx';
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
  afterEach(cleanup);

  it('starts at 96 by 64 tiles and saves resized dimensions in URL state', async () => {
    const user = userEvent.setup();
    render(<Example />);
    expect(screen.getByRole('img').getAttribute('viewBox')).toBe('0 0 96 64');
    await user.clear(screen.getByRole('spinbutton', { name: 'Width' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Width' }), '48');
    await user.clear(screen.getByRole('spinbutton', { name: 'Height' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Height' }), '32');
    await user.click(screen.getByRole('button', { name: 'Resize grid' }));
    const grid = screen.getByRole('img', { name: 'Empty routing grid, 48 by 32 tiles' });
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
      expect(screen.getByRole('img').getAttribute('viewBox')).toBe('0 0 120 80');
    }
    expect(JSON.parse(screen.getByRole('status').textContent!)).toEqual({ width: 120, height: 80 });
  });
});
