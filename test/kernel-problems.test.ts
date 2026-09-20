import { describe, expect, it } from 'vitest';
import { kernelProblems, type KernelFlows } from '../src/kernel-problems.ts';

function rates(flows: KernelFlows): number[][] {
  return [Object.values(flows.solids), Object.values(flows.fluids)];
}

describe('kernelProblems', () => {
  it('progresses through every shape for each resource mix', () => {
    expect(kernelProblems).toHaveLength(24);
    expect(
      kernelProblems.slice(0, 6).map((problem) => [rates(problem.inputs), rates(problem.outputs)]),
    ).toEqual([
      [
        [[5], []],
        [[2], []],
      ],
      [
        [[10], []],
        [[3], []],
      ],
      [
        [[25], []],
        [[3], []],
      ],
      [
        [[5, 5], []],
        [[2], []],
      ],
      [
        [[5, 5, 5], []],
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
      [[], [5]],
      [[2], []],
    ]);
    expect(
      kernelProblems[21] && [rates(kernelProblems[21].inputs), rates(kernelProblems[21].outputs)],
    ).toEqual([
      [[5], [5]],
      [[], [2]],
    ]);
    expect(
      kernelProblems[23] && [rates(kernelProblems[23].inputs), rates(kernelProblems[23].outputs)],
    ).toEqual([
      [[5, 5], [5]],
      [[2], [2]],
    ]);
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
