// @vitest-environment happy-dom
import { within } from '@testing-library/preact';
import { render } from '../render-with-dataset.tsx';
import { describe, expect, it } from 'vitest';
import { assemblerProblem } from '../../src/compute/kernel-problems.ts';
import { DesignCard } from '../../src/components/design/design-card.tsx';

const throughput = {
  beltItemsPerSecond: 30,
  inserterItemsPerSecond: 3,
  longInserterItemsPerSecond: 2,
};

describe('DesignCard', () => {
  it('rounds flow rates to at most one decimal place', () => {
    const problem = assemblerProblem({
      solidInputs: [16.7999999999999],
      solidOutputs: [2.04],
    });
    const { container } = render(
      <DesignCard index={0} problem={problem} throughput={throughput} />,
    );

    expect(within(container as HTMLElement).getByLabelText('16.8 item:1')).toBeTruthy();
    expect(within(container as HTMLElement).getByLabelText('2 item:2')).toBeTruthy();
  });

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

  it('shows fluid layouts from the tile solver', () => {
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
    expect(within(tile).queryByRole('note')).toBeNull();
    expect(
      within(tile).getByRole('region', { name: 'Assembler 2 tile design preview' }),
    ).toBeTruthy();
  });
  it('shows the tile solver reason for unsupported machine groups', () => {
    const problem = assemblerProblem({ solidInputs: [1], solidOutputs: [2] });
    problem.assemblers.push({ ...problem.assemblers[0], inputPerSecond: {}, outputPerSecond: {} });
    const { container } = render(
      <DesignCard index={2} problem={problem} throughput={throughput} />,
    );
    const tile = within(container as HTMLElement).getByRole('region', {
      name: 'Tile design result',
    });
    expect(within(tile).getByRole('note').textContent).toContain('Only one machine');
  });
});
