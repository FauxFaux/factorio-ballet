// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UrlHandler, type UrlState } from '../../src/boot/url-handler.tsx';
import { packCells, createIdTables } from '../../src/boot/pack.ts';
import { packEnvelope, parseEnvelope } from '../../src/boot/url-envelope.ts';
import type { State } from '../../src/ts.ts';
import { defaultDataset } from '../with-bobang.ts';

const { appRender } = vi.hoisted(() => ({ appRender: vi.fn() }));

vi.mock('../../src/app.tsx', () => ({
  App: ({ uss: [us, setUs] }: { uss: State<UrlState> }) => {
    appRender(us);
    return (
      <button
        onClick={() =>
          setUs((previous) => ({
            ...previous,
            cl: previous.cl.map((cell) => ({
              ...cell,
              layout: { frozenModules: { 'copper-cable:0': { x: 60, y: 50 } } },
            })),
          }))
        }
      >
        Freeze module
      </button>
    );
  },
}));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  appRender.mockClear();
  window.history.replaceState({}, '', '/');
});

function planHash(cs = ''): string {
  return `#${packEnvelope({
    dataset: defaultDataset.id,
    v: 1,
    cs,
    gp: 0,
    ci: 0,
    mo: {},
    cl: packCells(
      [{ entries: [{ recipe: 'copper-cable' }], layout: {} }],
      createIdTables(defaultDataset.data),
    ),
  })}`;
}

function liveState(): UrlState {
  return appRender.mock.lastCall![0];
}

describe('URL handler', () => {
  it('keeps live state references when its own URL write triggers hashchange', async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, '', `/${planHash()}`);
    render(<UrlHandler data={defaultDataset.data} datasetId={defaultDataset.id} />);
    fireEvent.click(screen.getByRole('button', { name: 'Freeze module' }));
    const state = liveState();
    const renderCount = appRender.mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    const saved = parseEnvelope(window.location.hash);
    expect(saved.kind).toBe('ok');
    if (saved.kind !== 'ok') throw new Error('URL write failed');
    expect(saved.packed.cl[0].layout?.frozenModules).toEqual({
      'copper-cable:0': { x: 60, y: 50 },
    });
    act(() => {
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    expect(liveState()).toBe(state);
    expect(appRender).toHaveBeenCalledTimes(renderCount);
  });

  it('still loads external hash changes and navigation back to a previously written hash', async () => {
    vi.useFakeTimers();
    window.history.replaceState({}, '', `/${planHash()}`);
    render(<UrlHandler data={defaultDataset.data} datasetId={defaultDataset.id} />);
    fireEvent.click(screen.getByRole('button', { name: 'Freeze module' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    const savedHash = window.location.hash;

    act(() => {
      window.history.replaceState({}, '', `/${planHash('iron')}`);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(liveState().cs).toBe('iron');
    expect(liveState().cl[0].layout?.frozenModules).toBeUndefined();

    act(() => {
      window.history.replaceState({}, '', `/${savedHash}`);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(liveState().cs).toBe('');
    expect(liveState().cl[0].layout?.frozenModules).toEqual({ 'copper-cable:0': { x: 60, y: 50 } });
  });
});
