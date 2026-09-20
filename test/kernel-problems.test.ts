import { describe, expect, it } from 'vitest';
import { kernelProblems, type KernelFlows } from '../src/kernel-problems.ts';

function rates(flows: KernelFlows): number[][] {
  return [Object.values(flows.solids), Object.values(flows.fluids)];
}

describe('kernelProblems', () => {
  it('progresses through every shape for each resource mix', () => {
    expect(kernelProblems).toHaveLength(20);
    expect(
      kernelProblems.slice(0, 6).map((problem) => [rates(problem.inputs), rates(problem.outputs)]),
    ).toEqual([
      [
        [[5], []],
        [[2], []],
      ],
      [
        [[8], []],
        [[3], []],
      ],
      [
        [[25], []],
        [[2], []],
      ],
      [
        [[5, 5], []],
        [[2], []],
      ],
      [
        [[5, 5, 8], []],
        [[2], []],
      ],
      [
        [[5, 5, 5], []],
        [[2, 2], []],
      ],
    ]);
    expect(
      kernelProblems[6] && [rates(kernelProblems[6].inputs), rates(kernelProblems[6].outputs)],
    ).toEqual([
      [[], [200]],
      [[2], []],
    ]);
    expect(
      kernelProblems[17] && [rates(kernelProblems[17].inputs), rates(kernelProblems[17].outputs)],
    ).toEqual([
      [[5], [200]],
      [[], [200]],
    ]);
    expect(
      kernelProblems[19] && [rates(kernelProblems[19].inputs), rates(kernelProblems[19].outputs)],
    ).toEqual([
      [[5, 5], [200]],
      [[2], [200]],
    ]);
  });

  it('uses 200 per second for every fluid', () => {
    for (const problem of kernelProblems) {
      expect(Object.values(problem.inputs.fluids).every((rate) => rate === 200)).toBe(true);
      expect(Object.values(problem.outputs.fluids).every((rate) => rate === 200)).toBe(true);
    }
  });

  it('gives the assembler the complete boundary flow', () => {
    for (const problem of kernelProblems) {
      expect(problem.assemblers[0]?.inputPerSecond).toEqual({
        ...problem.inputs.solids,
        ...problem.inputs.fluids,
      });
      expect(problem.assemblers[0]?.outputPerSecond).toEqual({
        ...problem.outputs.solids,
        ...problem.outputs.fluids,
      });
    }
  });
});
