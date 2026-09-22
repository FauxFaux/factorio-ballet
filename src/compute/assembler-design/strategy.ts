import type { DesignDirection, FactoryDesign, DesignEntity } from '../design.ts';
import type { KernelProblem, ResourceRates } from '../kernel-problems.ts';

/** Transport capabilities selected for one assembler-kernel generation pass. */
export interface AssemblerDesignThroughput {
  beltItemsPerSecond: number;
  inserterItemsPerSecond: number;
  longInserterItemsPerSecond: number;
}

type AssemblerDesignRejectionKind =
  | 'invalid-problem'
  | 'unsupported-flows'
  | 'transport-capacity'
  | 'machine-geometry'
  | 'entity-placement';

export interface AssemblerDesignRejection {
  kind: AssemblerDesignRejectionKind;
  failure: string[];
}

export interface PreparedAssemblerProblem {
  problem: KernelProblem;
  throughput: AssemblerDesignThroughput;
  inputSolids: number[];
  inputFluids: number[];
  outputSolids: number[];
  outputFluids: number[];
}

export type AssemblerDesignStrategyResult =
  | { kind: 'candidate'; design: FactoryDesign }
  | { kind: 'rejected'; rejection: AssemblerDesignRejection }
  | { kind: 'not-applicable' };

export interface AssemblerDesignStrategy {
  id: string;
  solve: (prepared: PreparedAssemblerProblem) => AssemblerDesignStrategyResult;
}

export function verticalBelt(x: number, direction: 'north' | 'south'): DesignEntity[] {
  return [0, 1, 2].map((y) => ({ kind: 'belt', position: { x, y }, direction }));
}

export function pipeTrunk(x = 0, height = 3): DesignEntity[] {
  return Array.from({ length: height }, (_, y) => ({ kind: 'pipe', position: { x, y } }));
}

export function assembler(
  problem: KernelProblem,
  x: number,
  direction?: DesignDirection,
): DesignEntity {
  const specification = problem.assemblers[0];
  return {
    kind: 'assembler',
    position: { x, y: 0 },
    size: specification.size ? rotatedSize(specification.size, direction) : { width: 3, height: 3 },
    recipe: specification.name,
    ...(direction ? { direction } : {}),
  };
}

export function rotatedSize(
  size: { width: number; height: number },
  direction: DesignDirection | undefined,
) {
  return direction === 'east' || direction === 'west'
    ? { width: size.height, height: size.width }
    : size;
}

export function invalidRatesRejection(
  side: 'input' | 'output',
  rates: ResourceRates,
): AssemblerDesignRejection {
  return designRejection(
    'invalid-problem',
    `cannot use the ${side} rates because`,
    Object.keys(rates).length === 0
      ? `there are no ${side} resources`
      : 'every rate must be a finite positive number',
  );
}

export function inserterFailure(
  operation: 'insert' | 'extract',
  resources: string[],
  problem: KernelProblem,
  required: number,
  available: number,
): AssemblerDesignRejection {
  const preposition = operation === 'insert' ? 'into' : 'from';
  return designRejection(
    'entity-placement',
    `cannot ${operation}`,
    resources.join(' and '),
    preposition,
    problem.assemblers[0].name,
    'because',
    count(required, 'inserter'),
    'are needed but only',
    count(available, 'tile'),
    `${available === 1 ? 'is' : 'are'} available beside the assembler`,
  );
}

export function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? '' : 's'}`;
}

export function rateText(value: number): string {
  return `${value} items/s`;
}

export function solved(design: FactoryDesign): AssemblerDesignStrategyResult {
  return { kind: 'candidate', design };
}

export function notApplicable(): AssemblerDesignStrategyResult {
  return { kind: 'not-applicable' };
}

export function reject(
  kind: AssemblerDesignRejectionKind,
  ...failure: string[]
): AssemblerDesignStrategyResult {
  return rejected(designRejection(kind, ...failure));
}

export function rejected(rejection: AssemblerDesignRejection): AssemblerDesignStrategyResult {
  return { kind: 'rejected', rejection };
}

export function designRejection(
  kind: AssemblerDesignRejectionKind,
  ...failure: string[]
): AssemblerDesignRejection {
  return { kind, failure };
}

export function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
