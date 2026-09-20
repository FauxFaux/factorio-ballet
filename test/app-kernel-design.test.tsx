// @vitest-environment happy-dom

import { render, screen, within } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { describe, expect, it } from 'vitest';
import { App } from '../src/app.tsx';
import { CARBON_LIGHT_SHORT } from '../src/data/colours.ts';
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
    const articles = screen.getAllByRole('article');
    expect(articles).toHaveLength(24);
    expect(screen.getAllByRole('region', { name: /Problem \d+ preview/ })).toHaveLength(3);
    expect(screen.getAllByText('[no solution]')).toHaveLength(21);
    expect(within(articles[0]!).getByRole('region', { name: 'Problem 1 preview' })).toBeTruthy();
    expect(within(articles[1]!).getByRole('region', { name: 'Problem 2 preview' })).toBeTruthy();
    expect(within(articles[2]!).getByText('[no solution]')).toBeTruthy();
    expect(screen.getAllByText('Assemblers')).toHaveLength(24);
    expect(screen.getAllByRole('img', { name: 'Solid' })).toHaveLength(96);
    expect(screen.getAllByRole('img', { name: 'Fluid' })).toHaveLength(48);
    for (const icon of within(articles[0]!).getAllByTitle('item 1')) {
      expect(icon.querySelector('path')?.getAttribute('fill')).toBe(CARBON_LIGHT_SHORT.Red50);
    }
    expect(screen.queryByText('item 1')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Draw belts' })).toBeNull();
  });
});
