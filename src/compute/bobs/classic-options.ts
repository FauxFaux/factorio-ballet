import { bobSolverWorkers } from './solver-workers.ts';
import type { BobOptions } from './types.ts';

export interface ClassicOptions extends BobOptions {
  numWorkers: number;
}

export function defaultClassicOptions(): Pick<ClassicOptions, 'numWorkers'> {
  return { numWorkers: bobSolverWorkers() };
}
