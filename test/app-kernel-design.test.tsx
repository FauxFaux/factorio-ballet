// @vitest-environment happy-dom

import { render, screen } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { describe, expect, it } from 'vitest';
import { App } from '../src/app.tsx';
import type { UrlState } from '../src/url-handler.tsx';

const kernelDesignState: UrlState = { v: 1, cs: '', gp: 0, cl: [], ci: 0, mo: {}, kd: {} };

function KernelDesignApp() {
  return <App uss={useState(kernelDesignState)} />;
}

describe('App', () => {
  it('shows the kernel-design page when URL state enables it', () => {
    render(<KernelDesignApp />);

    expect(screen.getByRole('heading', { name: 'Kernel design' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Rail blueprints' })).toBeNull();
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(screen.getAllByRole('region', { name: /Problem \d+ preview/ })).toHaveLength(3);
    expect(screen.getAllByText('Assemblers')).toHaveLength(3);
    expect(screen.getAllByText('5 item 1 + 1 item 2 + 200 fluid 3')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Draw belts' })).toBeNull();
  });
});
