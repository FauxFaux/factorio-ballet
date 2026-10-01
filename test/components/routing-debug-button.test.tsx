// @vitest-environment happy-dom

import { screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { field } from '../../src/ts.ts';
import { useState } from 'preact/hooks';
import { describe, expect, it } from 'vitest';
import { render } from '../render-with-dataset.tsx';
import { RoutingDebugButton } from '../../src/components/routing-debug-button.tsx';
import { RoutingDebug } from '../../src/components/routing-debug.tsx';
import type { UrlState } from '../../src/boot/url-handler.tsx';
import { packEnvelope, parseEnvelope } from '../../src/boot/url-envelope.ts';

function RoutingDebugExample() {
  const uss = useState<UrlState>({
    v: 1,
    cs: '',
    gp: 0,
    cl: [],
    ci: 0,
    mo: {},
    kd: {},
    fa: true,
    rb: [3, 2],
  });
  return (
    <>
      <RoutingDebugButton uss={uss} />
      {uss[0].rd && <RoutingDebug state={field(uss, 'rd')} />}
      <output>{JSON.stringify(uss[0])}</output>
    </>
  );
}

describe('RoutingDebugButton', () => {
  it('opens the empty debugger, clears other pages, persists its object, and toggles off', async () => {
    const user = userEvent.setup();
    render(<RoutingDebugExample />);
    await user.click(screen.getByRole('button', { name: 'Debug routing' }));
    expect(screen.getByRole('heading', { name: 'Routing debug' })).toBeTruthy();
    const state = JSON.parse(screen.getByRole('status').textContent!);
    expect(state.rd).toEqual({});
    expect(state.kd).toBeUndefined();
    expect(state.fa).toBeUndefined();
    expect(state.rb).toBeUndefined();
    expect(parseEnvelope(`#${packEnvelope(state)}`)).toEqual({ kind: 'ok', packed: state });
    await user.click(screen.getByRole('button', { name: 'Debug routing' }));
    expect(screen.queryByRole('heading', { name: 'Routing debug' })).toBeNull();
  });
});
