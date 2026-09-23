import {
  solveDualFluidDesign,
  solveOneFluidTwoOutputsDesign,
  solveDualFluidSolidOutputDesign,
  solveDualFluidSolidInputDesign,
  solveFluidInputDesign,
  solveFluidOutputDesign,
  solveOutsideFluidTrunkDesign,
} from './assembler-design/fluid-strategies.ts';
import {
  solveCompactSolidDesign,
  solveWideSolidDesign,
} from './assembler-design/solid-strategies.ts';
import {
  count,
  designRejection,
  invalidRatesRejection,
  type AssemblerDesignRejection,
  type AssemblerDesignStrategy,
  type AssemblerDesignThroughput,
  type PreparedAssemblerProblem,
} from './assembler-design/strategy.ts';
import type { FactoryDesign } from './design.ts';
import type { KernelProblem } from './kernel-problems.ts';

export type { AssemblerDesignThroughput } from './assembler-design/strategy.ts';

/** An explanation of the first constraint which prevented a kernel from being generated. */
export interface AssemblerDesignFailure {
  failure: string[];
  columns?: undefined;
}

export type AssemblerDesignResult = FactoryDesign | AssemblerDesignFailure;

interface AssemblerDesignCandidate {
  strategy: string;
  design: FactoryDesign;
  area: number;
}

const assemblerDesignStrategies: AssemblerDesignStrategy[] = [
  { id: 'compact-solid', solve: solveCompactSolidDesign },
  { id: 'wide-solid', solve: solveWideSolidDesign },
  { id: 'outside-fluid-trunk', solve: solveOutsideFluidTrunkDesign },
  { id: 'single-fluid-input-trunk', solve: solveFluidInputDesign },
  { id: 'single-fluid-output-trunk', solve: solveFluidOutputDesign },
  { id: 'dual-fluid-solid-input', solve: solveDualFluidSolidInputDesign },
  { id: 'dual-fluid-solid-output', solve: solveDualFluidSolidOutputDesign },
  { id: 'opposing-fluid-trunks', solve: solveDualFluidDesign },
  { id: 'one-fluid-two-outputs', solve: solveOneFluidTwoOutputsDesign },
];

export function isAssemblerDesignFailure(
  result: AssemblerDesignResult,
): result is AssemblerDesignFailure {
  return result.columns === undefined;
}

/**
 * Generate a vertically tileable assembler design supported by the current transport kernels.
 *
 * The ordinary fluid kernels support one trunk, while machines with suitable opposing ports can
 * connect a fluid input and output to separate trunks. The solid kernels support one product.
 * Each input belt may carry two solid resources, one per lane, and the kernel adds belts when lane
 * count or transfer throughput requires them. Every applicable stock strategy is attempted, and
 * the valid design with the smallest occupied area is returned.
 */
export function generateAssemblerDesign(
  problem: KernelProblem,
  throughput: AssemblerDesignThroughput,
): AssemblerDesignResult {
  const prepared = prepareAssemblerProblem(problem, throughput);
  if ('failure' in prepared) return failed(...prepared.failure);

  const attempts = assemblerDesignStrategies.map((strategy) => ({
    strategy,
    result: strategy.solve(prepared),
  }));
  const candidates = attempts.flatMap(({ strategy, result }): AssemblerDesignCandidate[] =>
    result.kind === 'candidate'
      ? [{ strategy: strategy.id, design: result.design, area: designArea(result.design) }]
      : [],
  );
  candidates.sort(
    (left, right) =>
      left.area - right.area ||
      assemblerDesignStrategies.findIndex(({ id }) => id === left.strategy) -
        assemblerDesignStrategies.findIndex(({ id }) => id === right.strategy),
  );
  if (candidates[0]) return candidates[0].design;

  const rejection = attempts.find(
    (
      attempt,
    ): attempt is typeof attempt & {
      result: { kind: 'rejected'; rejection: AssemblerDesignRejection };
    } => attempt.result.kind === 'rejected',
  )?.result.rejection;
  return rejection ? failed(...rejection.failure) : failed('no assembler design strategy applies');
}

function prepareAssemblerProblem(
  problem: KernelProblem,
  throughput: AssemblerDesignThroughput,
): PreparedAssemblerProblem | AssemblerDesignRejection {
  if (
    !Number.isFinite(throughput.beltItemsPerSecond) ||
    throughput.beltItemsPerSecond <= 0 ||
    !Number.isFinite(throughput.inserterItemsPerSecond) ||
    throughput.inserterItemsPerSecond <= 0 ||
    !Number.isFinite(throughput.longInserterItemsPerSecond) ||
    throughput.longInserterItemsPerSecond <= 0
  ) {
    return designRejection(
      'invalid-problem',
      'cannot design an assembler kernel because transport throughput is invalid',
    );
  }
  if (problem.assemblers.length !== 1) {
    return designRejection(
      'invalid-problem',
      'cannot design a kernel for',
      count(problem.assemblers.length, 'assembler'),
      'because this generator supports exactly one assembler',
    );
  }

  for (const [side, rates] of [
    ['input', problem.inputs.solids],
    ['input', problem.inputs.fluids],
    ['output', problem.outputs.solids],
    ['output', problem.outputs.fluids],
  ] as const) {
    if (!Object.values(rates).every((value) => Number.isFinite(value) && value > 0)) {
      return invalidRatesRejection(side, rates);
    }
  }

  return {
    problem,
    throughput,
    inputSolids: Object.values(problem.inputs.solids),
    inputFluids: Object.values(problem.inputs.fluids),
    outputSolids: Object.values(problem.outputs.solids),
    outputFluids: Object.values(problem.outputs.fluids),
  };
}

function designArea(design: FactoryDesign): number {
  return design.columns.reduce((total, { entities }) => {
    if (entities.length === 0) return total;
    const minX = Math.min(...entities.map(({ position }) => position.x));
    const minY = Math.min(...entities.map(({ position }) => position.y));
    const maxX = Math.max(
      ...entities.map(
        (entity) => entity.position.x + (entity.kind === 'assembler' ? entity.size.width : 1),
      ),
    );
    const maxY = Math.max(
      ...entities.map(
        (entity) => entity.position.y + (entity.kind === 'assembler' ? entity.size.height : 1),
      ),
    );
    return total + (maxX - minX) * (maxY - minY);
  }, 0);
}

function failed(...failure: string[]): AssemblerDesignFailure {
  return { failure };
}
