import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kernelLayoutOptions } from '../../src/compute/kernel-layout-options.ts';
import type { TileDesignSearchResult } from '../../src/compute/tile-design/result.ts';
import type { KernelProblem } from '../../src/compute/kernel-problems.ts';
import { solveKernelTileDesign } from '../../src/compute/tile-design/kernel-result.ts';

vi.mock('../../src/compute/tile-design/kernel-result.ts', () => ({
  solveKernelTileDesign: vi.fn(),
}));

const problem: KernelProblem = {
  inputs: { solids: {}, fluids: {} },
  outputs: { solids: {}, fluids: {} },
  assemblers: [{ name: 'test', inputPerSecond: {}, outputPerSecond: {} }],
  design: { columns: [] },
};
const throughput = {
  beltItemsPerSecond: 75,
  inserterItemsPerSecond: 30,
  longInserterItemsPerSecond: 15,
};
const diagnostics = {
  exploredStates: 1,
  capacityRejections: 0,
  validationRejections: 0,
  scope: 'high/whole-item-belts/end-tunnels/horizontal-fluid-branches' as const,
};

beforeEach(() => {
  vi.mocked(solveKernelTileDesign).mockReset();
  vi.mocked(solveKernelTileDesign).mockImplementation((_problem, _throughput, options) => {
    if ((options?.repeatCount ?? 1) > 20)
      return { status: 'envelope-exhausted', reason: 'Height limit', diagnostics };
    return {
      status: 'found',
      candidate: {
        column: { entities: [] },
        width: 5,
        pitch: 5,
        machineIds: Object.fromEntries(
          Array.from({ length: options?.pattern === 'pair' ? 2 : 1 }, (_, index) => [
            index,
            'test',
          ]),
        ),
        lanes: [],
        transfers: [],
        fluids: [],
        boundary: [],
      },
      validation: { valid: true, issues: [], supportedCopies: options?.repeatCount ?? 1 },
      optimal: true,
      stopReason: 'complete',
      diagnostics,
    };
  });
});

describe('kernelLayoutOptions', () => {
  it('retains every found capacity across families, including beyond the doubled result', () => {
    const { options } = kernelLayoutOptions(problem, throughput, 12, 8);
    expect(options.filter(({ name }) => name === 'General')).toHaveLength(5);
    expect(new Set(options.map(({ name }) => name))).toEqual(
      new Set(['General', 'HIGH single', 'HIGH pair']),
    );
    expect(options[0].columns).toHaveLength(1);
    expect(options[0].maxBuildingsPerColumn).toBe(32);
    expect(solveKernelTileDesign).toHaveBeenCalledWith(problem, throughput, {
      mode: 'search',
      repeatCount: 2,
      moduleHeight: 100,
      undergroundBeltReach: 8,
    });
  });

  it('counts actual buildings in multi-building repeats and shows rounding of fixed demand', () => {
    const { options } = kernelLayoutOptions(problem, throughput, 5, 8);
    const pair = options.find(({ name, columns }) => name === 'HIGH pair' && columns.length === 1)!;
    expect(pair.buildingsPerRepeat).toBe(2);
    expect(pair.maxBuildingsPerColumn).toBeGreaterThanOrEqual(6);
    expect(pair.columns[0].machineCount).toBe(6);
  });

  it('retains earlier successes when larger capacity fails and tries HIGH after general failure', () => {
    const found = vi.mocked(solveKernelTileDesign).getMockImplementation()!;
    vi.mocked(solveKernelTileDesign).mockImplementation((problem, throughput, options) =>
      options?.mode === 'search' || (options?.repeatCount ?? 1) > 1
        ? { status: 'envelope-exhausted', reason: 'Does not fit', diagnostics }
        : found(problem, throughput, options),
    );
    const { options } = kernelLayoutOptions(problem, throughput, 12, 8);
    expect(options.map(({ name }) => name)).toEqual(['HIGH pair', 'HIGH single']);
    expect(options.map(({ columns }) => columns.length)).toEqual([6, 12]);
  });

  it('tries 2× even when the initial capacity is larger and twice that capacity fails', () => {
    const found = vi.mocked(solveKernelTileDesign).getMockImplementation()!;
    vi.mocked(solveKernelTileDesign).mockImplementation((problem, throughput, options) => {
      const repeats = options?.repeatCount ?? 1;
      if (repeats > 2) return { status: 'envelope-exhausted', reason: 'Does not fit', diagnostics };
      const result = found(problem, throughput, options) as Extract<
        TileDesignSearchResult,
        { status: 'found' }
      >;
      return {
        ...result,
        candidate: { ...result.candidate, width: repeats === 2 ? 7 : 5 },
        validation: { ...result.validation, supportedCopies: repeats === 2 ? 4 : 3 },
      };
    });
    const { options } = kernelLayoutOptions(problem, throughput, 2, 8);
    const general = options.filter(({ name }) => name === 'General');
    expect(general.map(({ requestedCopies }) => requestedCopies)).toEqual([2, 1]);
    expect(general.map(({ columns }) => columns.length)).toEqual([1, 1]);
  });

  it('does not search for zero or unknown building demand', () => {
    expect(kernelLayoutOptions(problem, throughput, 0, 8).options).toEqual([]);
    expect(kernelLayoutOptions(problem, throughput, Number.NaN, 8).options).toEqual([]);
    expect(solveKernelTileDesign).not.toHaveBeenCalled();
  });
});
