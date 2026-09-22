// @vitest-environment happy-dom

import { render, screen, within } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/app.tsx';
import { generateAssemblerDesign } from '../../src/compute/assembler-design.ts';
import { CARBON_LIGHT_SHORT } from '../../src/compute/colours.ts';
import { resolveChosen } from '../../src/data';
import { inserterItemsPerSecondForBeltAtProgress } from '../../src/data/inserter-throughput.ts';
import {
  allKernelProblems,
  kernelProblems,
  type KernelProblem,
} from '../../src/compute/kernel-problems.ts';
import { fmt } from '../../src/ts.ts';
import type { UrlState } from '../../src/boot/url-handler.tsx';

const kernelDesignState: UrlState = {
  v: 1,
  cs: '',
  gp: 100,
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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the kernel-design page when URL state enables it', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined)),
    );
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
      longInserterItemsPerSecond: inserterItemsPerSecondForBeltAtProgress(progress, chosen.belt, 2),
    };
    const sortedProblems = allKernelProblems.toSorted(
      (left, right) =>
        Number(!generateAssemblerDesign(left, throughput)) -
        Number(!generateAssemblerDesign(right, throughput)),
    );
    const solutionCount = allKernelProblems.filter((problem) =>
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
    expect(within(throughputSummary).getByText('Long inserter throughput')).toBeTruthy();
    expect(
      within(throughputSummary).getByText(`${fmt(throughput.longInserterItemsPerSecond)} items/s`),
    ).toBeTruthy();
    const articles = screen.getAllByRole('article');
    const articleForProblem = (problem: KernelProblem) =>
      articles[sortedProblems.indexOf(problem)]!;
    expect(articles).toHaveLength(allKernelProblems.length);
    expect(screen.queryAllByRole('region', { name: / preview$/ })).toHaveLength(solutionCount);
    expect(screen.queryAllByText('[no solution]')).toHaveLength(
      allKernelProblems.length - solutionCount,
    );
    const cardTitles = articles.map(
      (article) => within(article).getByRole('heading', { level: 3 }).textContent,
    );
    expect(cardTitles).toEqual(
      sortedProblems.map((problem) => problem.assemblers.map(({ name }) => name).join(', ')),
    );
    expect(
      articles.slice(solutionCount).every((article) => within(article).getByText('[no solution]')),
    ).toBe(true);
    const firstSolidProblem = kernelProblems.solid[0]!;
    expect(
      within(articleForProblem(firstSolidProblem)).getByRole('region', {
        name: 'Assembler 1 preview',
      }),
    ).toBeTruthy();
    expect(
      within(articleForProblem(firstSolidProblem)).getByLabelText('Max column height').textContent,
    ).toContain('×6');
    expect(
      within(articleForProblem(kernelProblems.solid[3]!)).getByLabelText('Max column height')
        .textContent,
    ).toContain('×3');
    expect(
      within(articleForProblem(kernelProblems.solid[4]!)).getByLabelText('Max column height')
        .textContent,
    ).toContain('×3');
    expect(
      within(articleForProblem(firstSolidProblem)).getByRole('button', {
        name: 'About maximum column height',
      }),
    ).toBeTruthy();
    expect(screen.queryByText('Assemblers')).toBeNull();
    expect(screen.getAllByRole('img', { name: 'Solid' })).toHaveLength(46);
    expect(screen.getAllByRole('img', { name: 'Fluid' })).toHaveLength(24);
    for (const icon of within(articleForProblem(firstSolidProblem)).getAllByTitle('item 1')) {
      expect(icon.querySelector('path')?.getAttribute('fill')).toBe(CARBON_LIGHT_SHORT.Red50);
    }
    const firstPreview = within(articleForProblem(firstSolidProblem)).getByRole('region', {
      name: 'Assembler 1 preview',
    });
    const inputBelts = within(firstPreview).getAllByRole('img', {
      name: /Transport belt at 0, \d, pointing north/,
    });
    expect(inputBelts).toHaveLength(3);
    for (const belt of inputBelts) {
      expect(belt.getAttribute('title')).toContain('left side: item 1, 5/s');
      expect(belt.getAttribute('title')).toContain('right side: item 1, 5/s');
      const lanes = belt.querySelectorAll('.cell-design-belt-lane');
      expect(lanes).toHaveLength(2);
      for (const lane of lanes) {
        expect((lane as HTMLElement).style.backgroundColor).toBe(CARBON_LIGHT_SHORT.Red50);
      }
    }
    const outputBelts = within(firstPreview).getAllByRole('img', {
      name: /Transport belt at 6, \d, pointing south/,
    });
    expect(outputBelts).toHaveLength(3);
    for (const belt of outputBelts) {
      expect(belt.querySelectorAll('.cell-design-belt-lane')).toHaveLength(2);
    }
    for (const belt of outputBelts) {
      expect(belt.getAttribute('title')).toContain('item 2, 2/s');
      expect(
        [...belt.querySelectorAll<HTMLElement>('.cell-design-belt-lane')].some(
          (lane) => lane.style.backgroundColor === CARBON_LIGHT_SHORT.Green60,
        ),
      ).toBe(true);
    }
    const fifthPreview = within(articleForProblem(kernelProblems.solid[4]!)).getByRole('region', {
      name: 'Assembler 1 preview',
    });
    const mixedInputBelts = within(fifthPreview).getAllByRole('img', {
      name: /Transport belt at 1, \d, pointing north/,
    });
    expect(mixedInputBelts).toHaveLength(3);
    for (const belt of mixedInputBelts) {
      expect(belt.getAttribute('title')).toContain('left side: item 1, 5/s');
      expect(belt.getAttribute('title')).toContain('right side: item 2, 5/s');
      expect(
        belt.querySelector<HTMLElement>('.cell-design-belt-lane[data-side="left"]')?.style
          .backgroundColor,
      ).toBe(CARBON_LIGHT_SHORT.Red50);
      expect(
        belt.querySelector<HTMLElement>('.cell-design-belt-lane[data-side="right"]')?.style
          .backgroundColor,
      ).toBe(CARBON_LIGHT_SHORT.Green60);
    }
    const rightInputBelts = within(fifthPreview).getAllByRole('img', {
      name: /Transport belt at 7, \d, pointing north/,
    });
    expect(rightInputBelts).toHaveLength(3);
    for (const belt of rightInputBelts) {
      expect(belt.getAttribute('title')).toContain('left side: item 3, 8/s');
      expect(belt.getAttribute('title')).toContain('right side: item 3, 8/s');
    }
    const fluidOnlyInputPreview = within(
      articleForProblem(kernelProblems.fluidInput[0]!),
    ).getByRole('region', {
      name: 'Assembler 1 preview',
    });
    expect(
      within(fluidOnlyInputPreview).getAllByRole('img', { name: /Pipe at 0, [0-2]/ }),
    ).toHaveLength(3);
    for (const problem of kernelProblems.fluidOutput.slice(0, 4)) {
      const preview = within(articleForProblem(problem)).getByRole('region', {
        name: 'Assembler 1 preview',
      });
      expect(within(preview).getAllByRole('img', { name: /Pipe at 0, [0-2]/ })).toHaveLength(3);
    }
    const fiveInputFluidOutputPreview = within(
      articleForProblem(kernelProblems.fluidOutput[4]!),
    ).getByRole('region', {
      name: 'Assembler 1 preview',
    });
    expect(
      within(fiveInputFluidOutputPreview).getAllByRole('img', {
        name: /Transport belt at 6, \d, pointing north/,
      }),
    ).toHaveLength(3);
    expect(screen.queryByText('item 1')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Draw belts' })).toBeNull();
  });
});
