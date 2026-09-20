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
    expect(screen.getAllByRole('article')).toHaveLength(10);
    expect(screen.getAllByRole('region', { name: /Design viewport/ })).toHaveLength(10);
  });
});
