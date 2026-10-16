import { isItem, type MachineSize, type ResourceId } from '../../types.ts';

export type Point = { x: number; y: number };
export type Rates = Partial<Record<ResourceId, number>>;

export interface BobMachine {
  id: string;
  recipe?: string;
  label: string;
  size: MachineSize;
  inputs: Rates;
  outputs: Rates;
}

export interface BobProblem {
  machines: BobMachine[];
  inputs: ResourceId[];
  outputs: ResourceId[];
}

export interface BobOptions {
  maxWidth: number;
  maxHeight: number;
  maxChests: number;
  maxInserters: number;
  maxTimeInSeconds: number;
}

export interface BobNode {
  id: string;
  label: string;
  kind: 'assembler' | 'source' | 'sink' | 'chest';
  resource?: ResourceId;
  position: Point;
  size: MachineSize;
}

export interface BobInserter {
  position: Point;
  pickup: Point;
  dropoff: Point;
  from: string;
  to: string;
  rates: Rates;
  capacity: number;
}

export interface BobLayout {
  width: number;
  height: number;
  nodes: BobNode[];
  inserters: BobInserter[];
}

export interface BobResult {
  status: 'optimal' | 'feasible' | 'infeasible' | 'unknown';
  layout?: BobLayout;
  message: string;
  attempts?: BobAttempt[];
}

export interface BobPort {
  node: string;
  resource: ResourceId;
  side: 'input' | 'output';
  rate: number;
}

export interface BobConflict {
  kind: 'space' | 'capacity' | 'routing' | 'timeout';
  message: string;
  tiles: Point[];
  ports: BobPort[];
}

/** A placement snapshot survives subsequent transport failures and retries. */
export interface BobAttempt {
  id: number;
  layout: BobLayout;
  stage: 'placement' | 'conflict' | 'solved';
  message: string;
  conflicts: BobConflict[];
  promoted: BobPort[];
}

/** Integer CP-SAT flows resolve one thousandth of an item per second. */
export const RATE_SCALE = 1000;

export function defaultBobOptions(problem: BobProblem): BobOptions {
  const ports = problem.machines.reduce(
    (n, machine) =>
      n +
      Object.keys(machine.inputs).filter(isItem).length +
      Object.keys(machine.outputs).filter(isItem).length,
    0,
  );
  return {
    maxWidth: 32,
    maxHeight: 32,
    maxChests: Math.min(8, Math.max(2, problem.machines.length)),
    maxInserters: Math.min(64, Math.max(6, ports * 2 + 4)),
    maxTimeInSeconds: 10,
  };
}
