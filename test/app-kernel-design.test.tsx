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
      longInserterItemsPerSecond: inserterItemsPerSecondForBeltAtProgress(progress, chosen.belt, 2),
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
    expect(within(throughputSummary).getByText('Long inserter throughput')).toBeTruthy();
    expect(
      within(throughputSummary).getByText(`${fmt(throughput.longInserterItemsPerSecond)} items/s`),
    ).toBeTruthy();
    const articles = screen.getAllByRole('article');
    const articleForProblem = (problemNumber: number) =>
      screen
        .getByRole('heading', { name: `Problem ${problemNumber}`, level: 3 })
        .closest('article')!;
    expect(articles).toHaveLength(kernelProblems.length);
    expect(screen.queryAllByRole('region', { name: /Problem \d+ preview/ })).toHaveLength(
      solutionCount,
    );
    expect(screen.queryAllByText('[no solution]')).toHaveLength(
      kernelProblems.length - solutionCount,
    );
    const noSolutionTitles = screen
      .queryAllByText('[no solution]')
      .map(
        (element) =>
          within(element.closest('article')!).getByRole('heading', { level: 3 }).textContent,
      );
    const expectedNoSolutionTitles = kernelProblems.flatMap((problem, index) =>
      generateAssemblerDesign(problem, throughput) ? [] : [`Problem ${index + 1}`],
    );
    const cardTitles = articles.map(
      (article) => within(article).getByRole('heading', { level: 3 }).textContent,
    );
    expect(noSolutionTitles).toEqual(expectedNoSolutionTitles);
    expect(cardTitles.slice(solutionCount)).toEqual(noSolutionTitles);
    expect(
      within(articleForProblem(1)).getByRole('region', { name: 'Problem 1 preview' }),
    ).toBeTruthy();
    expect(within(articleForProblem(1)).getByLabelText('Max column height').textContent).toContain(
      '×6',
    );
    expect(within(articleForProblem(4)).getByLabelText('Max column height').textContent).toContain(
      '×3',
    );
    expect(within(articleForProblem(5)).getByLabelText('Max column height').textContent).toContain(
      '×3',
    );
    expect(screen.getAllByText('Assemblers')).toHaveLength(kernelProblems.length);
    expect(screen.getAllByRole('img', { name: 'Solid' })).toHaveLength(92);
    expect(screen.getAllByRole('img', { name: 'Fluid' })).toHaveLength(36);
    for (const icon of within(articleForProblem(1)).getAllByTitle('item 1')) {
      expect(icon.querySelector('path')?.getAttribute('fill')).toBe(CARBON_LIGHT_SHORT.Red50);
    }
    const firstPreview = within(articleForProblem(1)).getByRole('region', {
      name: 'Problem 1 preview',
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
    const fifthPreview = within(articleForProblem(5)).getByRole('region', {
      name: 'Problem 5 preview',
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
    const problem7Preview = within(articleForProblem(7)).getByRole('region', {
      name: 'Problem 7 preview',
    });
    expect(within(problem7Preview).getAllByRole('img', { name: /Pipe at 0, [0-2]/ })).toHaveLength(
      3,
    );
    for (const problemNumber of [11, 12, 13, 14]) {
      const preview = within(articleForProblem(problemNumber)).getByRole('region', {
        name: `Problem ${problemNumber} preview`,
      });
      expect(within(preview).getAllByRole('img', { name: /Pipe at 0, [0-2]/ })).toHaveLength(3);
    }
    const problem15Preview = within(articleForProblem(15)).getByRole('region', {
      name: 'Problem 15 preview',
    });
    expect(
      within(problem15Preview).getAllByRole('img', {
        name: /Transport belt at 6, \d, pointing north/,
      }),
    ).toHaveLength(3);
    expect(screen.queryByText('item 1')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Draw belts' })).toBeNull();
  });
});
