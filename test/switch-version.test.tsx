// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SwitchVersion } from '../src/components/switch-version.tsx';

describe('SwitchVersion', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.history.replaceState({}, '', '/');
  });

  it('uses the bundled list when the deployed list cannot be fetched', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    );
    const user = userEvent.setup();
    window.location.hash = '#yplan';
    render(<SwitchVersion />);

    await user.click(screen.getByTitle('Switch version'));

    expect(screen.getByRole('menuitem', { name: /64b4f6c/ }).getAttribute('href')).toBe(
      '/snapshot-64b4f6c/#yplan',
    );
    expect(screen.getByRole('menuitem', { name: /93ea123/ }).classList).toContain(
      'switch-version-incompatible',
    );
  });

  it('recognises the current snapshot and offers the root build', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined)),
    );
    const user = userEvent.setup();
    window.history.replaceState({}, '', '/snapshot-bcd5f27/');
    window.location.hash = '#oplan';
    render(<SwitchVersion />);

    await user.click(screen.getByTitle('Switch version'));

    expect(screen.getByRole('menuitem', { name: 'Current version' }).getAttribute('href')).toBe(
      '/#oplan',
    );
    expect(screen.queryByRole('menuitem', { name: /bcd5f27/ })).toBeNull();
    expect(screen.getByRole('menuitem', { name: /64b4f6c/ }).classList).toContain(
      'switch-version-incompatible',
    );
  });
});
