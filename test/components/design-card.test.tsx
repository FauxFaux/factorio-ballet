// @vitest-environment happy-dom
import { render, within } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { assemblerProblem } from '../../src/compute/kernel-problems.ts';
import { DesignCard } from '../../src/components/design/design-card.tsx';

const throughput = {
  beltItemsPerSecond: 30,
  inserterItemsPerSecond: 3,
  longInserterItemsPerSecond: 2,
};

describe('DesignCard', () => {
  it('shows the assembler and tile designs in separate rows', () => {
    const { container } = render(
      <DesignCard
        index={0}
        problem={assemblerProblem({ solidInputs: [1], solidOutputs: [2] })}
        throughput={throughput}
      />,
    );

    const assembler = within(container as HTMLElement).getByRole('region', {
      name: 'Assembler design result',
    });
    const tile = within(container as HTMLElement).getByRole('region', {
      name: 'Tile design result',
    });
    expect(within(assembler).getByRole('heading', { name: 'design v0' })).toBeTruthy();
    expect(within(tile).getByRole('heading', { name: 'design v1' })).toBeTruthy();
    expect(
      within(assembler).getByRole('region', { name: 'Assembler 1 assembler design preview' }),
    ).toBeTruthy();
    expect(
      within(tile).getByRole('region', { name: 'Assembler 1 tile design preview' }),
    ).toBeTruthy();
    expect(assembler.compareDocumentPosition(tile) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the tile solver reason when it cannot handle a problem', () => {
    const { container } = render(
      <DesignCard
        index={1}
        problem={assemblerProblem({ fluidInputs: [200], solidOutputs: [2] })}
        throughput={throughput}
      />,
    );

    const tile = within(container as HTMLElement).getByRole('region', {
      name: 'Tile design result',
    });
    expect(within(tile).getByRole('note').textContent).toContain('external item flows');
  });
});
