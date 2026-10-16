import { afterEach, describe, expect, it, vi } from 'vitest';
import { bobSolverWorkers } from '../../src/compute/bobs/solver-workers.ts';

afterEach(() => vi.unstubAllGlobals());

describe('bobSolverWorkers', () => {
  it.each([
    [1, 1],
    [2, 1],
    [8, 7],
    [16, 15],
    [32, 16],
  ])('uses %i logical processors to select %i workers', (hardwareConcurrency, workers) => {
    vi.stubGlobal('navigator', { hardwareConcurrency });
    expect(bobSolverWorkers()).toBe(workers);
  });

  it('falls back to one worker without hardware information', () => {
    vi.stubGlobal('navigator', {});
    expect(bobSolverWorkers()).toBe(1);
    vi.stubGlobal('navigator', undefined);
    expect(bobSolverWorkers()).toBe(1);
  });
});
