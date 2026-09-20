// @vitest-environment happy-dom

import { render, screen, within } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { describe, expect, it } from 'vitest';
import { App } from '../src/app.tsx';
import { generateAssemblerDesign } from '../src/assembler-design.ts';
import { CARBON_LIGHT_SHORT } from '../src/data/colours.ts';
import { resolveChosen } from '../src/data/index.ts';
import { inserterItemsPerSecondForBeltAtProgress } from '../src/inserter-throughput.ts';
import { kernelProblems } from '../src/kernel-problems.ts';
import { fmt } from '../src/ts.ts';
import type { UrlState } from '../src/url-handler.tsx';

const kernelDesignState: UrlState = {
  v: 1,
  cs: '',
  gp: 0,
  cl: [],
  ci: 0,
  mo: {},
  bt: 'fast-transport-belt',
  kd: {},
};

function KernelDesignApp() {
  return <App uss={useState(kernelDesignState)} />;
}

describe('App', () => {
  it('shows the kernel-design page when URL state enables it', () => {
    render(<KernelDesignApp />);

    const progress = kernelDesignState.gp / 100;
    const chosen = resolveChosen(
      kernelDesignState.mo,
      kernelDesignState.be,
      kernelDesignState.bt,
      progress,
    );
    const throughput = {
      beltItemsPerSecond: chosen.belt.itemsPerSecond,
      inserterItemsPerSecond: inserterItemsPerSecondForBeltAtProgress(progress, chosen.belt),
    };
    const solutionCount = kernelProblems.filter((problem) =>
      generateAssemblerDesign(problem, throughput),
    ).length;

    expect(screen.getByRole('heading', { name: 'Kernel design' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Rail blueprints' })).toBeNull();
    const throughputSummary = screen.getByLabelText('Transport throughput');
    expect(within(throughputSummary).getByText('Belt throughput')).toBeTruthy();
    expect(
      within(throughputSummary).getByText(`${fmt(throughput.beltItemsPerSecond)} items/s`),
    ).toBeTruthy();
    expect(within(throughputSummary).getByText('Inserter throughput')).toBeTruthy();
    expect(
      within(throughputSummary).getByText(`${fmt(throughput.inserterItemsPerSecond)} items/s`),
    ).toBeTruthy();
    const articles = screen.getAllByRole('article');
    expect(articles).toHaveLength(kernelProblems.length);
    expect(screen.queryAllByRole('region', { name: /Problem \d+ preview/ })).toHaveLength(
      solutionCount,
    );
    expect(screen.queryAllByText('[no solution]')).toHaveLength(
      kernelProblems.length - solutionCount,
    );
    expect(within(articles[0]!).getByRole('region', { name: 'Problem 1 preview' })).toBeTruthy();
    expect(within(articles[1]!).getByText('[no solution]')).toBeTruthy();
    expect(within(articles[2]!).getByText('[no solution]')).toBeTruthy();
    expect(screen.getAllByText('Assemblers')).toHaveLength(kernelProblems.length);
    expect(screen.getAllByRole('img', { name: 'Solid' })).toHaveLength(92);
    expect(screen.getAllByRole('img', { name: 'Fluid' })).toHaveLength(36);
    for (const icon of within(articles[0]!).getAllByTitle('item 1')) {
      expect(icon.querySelector('path')?.getAttribute('fill')).toBe(CARBON_LIGHT_SHORT.Red50);
    }
    expect(screen.queryByText('item 1')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Draw belts' })).toBeNull();
  });
});
