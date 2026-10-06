import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LayoutCache,
  layoutRequestKey,
  type LayoutRequest,
} from '../../src/dataset/layout-cache.ts';
import { allocateKernelLayouts } from '../../src/compute/kernel-layout-options.ts';
import { modulesForCell } from '../../src/compute/modules.ts';
import { solveKernelTileDesign } from '../../src/compute/tile-design/kernel-result.ts';

vi.mock('../../src/compute/tile-design/kernel-result.ts', () => ({
  solveKernelTileDesign: vi.fn(),
}));

const request: LayoutRequest = {
  problem: {
    inputs: { solids: { 'item:ore': 1, 'item:coal': 2 }, fluids: {} },
    outputs: { solids: { 'item:plate': 1 }, fluids: {} },
    assemblers: [{ name: 'plate', machine: 'furnace', inputPerSecond: {}, outputPerSecond: {} }],
    design: { columns: [] },
  },
  throughput: { beltItemsPerSecond: 30, inserterItemsPerSecond: 8, longInserterItemsPerSecond: 4 },
  undergroundBeltReach: 5,
};
const key = layoutRequestKey(request);

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(solveKernelTileDesign).mockReset();
  vi.mocked(solveKernelTileDesign).mockImplementation((_problem, _throughput, options) => ({
    status: 'found',
    candidate: {
      column: { entities: [] },
      width: 5,
      pitch: 5,
      machineIds: { 0: 'furnace' },
      lanes: [],
      transfers: [],
      fluids: [],
      boundary: [],
    },
    validation: { valid: true, issues: [], supportedCopies: options?.repeatCount ?? 1 },
    optimal: true,
    stopReason: 'complete',
    diagnostics: {
      exploredStates: 1,
      capacityRejections: 0,
      validationRejections: 0,
      scope: 'one-machine/external-items/straight-surface-trunks',
    },
  }));
});
afterEach(() => vi.useRealTimers());

describe('LayoutCache', () => {
  it('yields before every solve and deduplicates concurrent consumers', async () => {
    const cache = new LayoutCache();
    const listener = vi.fn();
    cache.subscribe(key, request, listener);
    cache.subscribe(key, structuredClone(request), listener);
    expect(solveKernelTileDesign).not.toHaveBeenCalled();
    await vi.advanceTimersToNextTimerAsync();
    expect(solveKernelTileDesign).toHaveBeenCalledTimes(1);
    expect(listener).not.toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(solveKernelTileDesign).toHaveBeenCalledTimes(21);
    expect(cache.read(key)?.status).toBe('ready');
    expect(listener).toHaveBeenCalledTimes(1);
    cache.subscribe(key, request, vi.fn());
    await vi.runAllTimersAsync();
    expect(solveKernelTileDesign).toHaveBeenCalledTimes(21);
  });

  it('reallocates counts from retained answers and chooses the highest capacity', async () => {
    const cache = new LayoutCache();
    cache.subscribe(key, request, vi.fn());
    await vi.runAllTimersAsync();
    const state = cache.read(key)!;
    if (state.status !== 'ready') throw new Error(state.status);
    const first = allocateKernelLayouts(request.problem, state.result, 5);
    const second = allocateKernelLayouts(request.problem, state.result, 50);
    expect(first.options[0].columns).toHaveLength(1);
    expect(second.options[0].columns).toHaveLength(3);
    expect(solveKernelTileDesign).toHaveBeenCalledTimes(21);
    // Put the smallest first to prove selection doesn't depend on option ordering.
    const options = second.options.toSorted(
      (a, b) => a.maxBuildingsPerColumn - b.maxBuildingsPerColumn,
    );
    const modules = modulesForCell([{ problem: request.problem, machineCount: 50, options }], 30);
    expect(modules).toHaveLength(3);
    expect(modules.reduce((total, module) => total + module.machineCount, 0)).toBe(50);
  });

  it('keys equivalent rates by value and invalidates rates, machine and transport changes', () => {
    const clone = structuredClone(request);
    clone.problem.inputs.solids = { 'item:coal': 2, 'item:ore': 1 };
    expect(layoutRequestKey(clone)).toBe(key);
    clone.problem.inputs.solids['item:ore'] = 2;
    expect(layoutRequestKey(clone)).not.toBe(key);
    expect(layoutRequestKey({ ...request, undergroundBeltReach: 8 })).not.toBe(key);
    expect(
      layoutRequestKey({
        ...request,
        throughput: { ...request.throughput, inserterItemsPerSecond: 9 },
      }),
    ).not.toBe(key);
    clone.problem = structuredClone(request.problem);
    clone.problem.assemblers[0].machine = 'other';
    expect(layoutRequestKey(clone)).not.toBe(key);
  });

  it('abandons unsubscribed work between solves but preserves work during resubscription', async () => {
    const cache = new LayoutCache();
    const stop = cache.subscribe(key, request, vi.fn());
    await vi.advanceTimersToNextTimerAsync();
    stop();
    const listener = vi.fn();
    const stopAgain = cache.subscribe(key, request, listener);
    await vi.advanceTimersToNextTimerAsync();
    expect(solveKernelTileDesign).toHaveBeenCalledTimes(2);
    expect(vi.mocked(solveKernelTileDesign).mock.lastCall?.[2]?.repeatCount).toBe(2);
    stopAgain();
    await vi.runAllTimersAsync();
    expect(solveKernelTileDesign).toHaveBeenCalledTimes(2);
    expect(cache.read(key)).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
  });

  it('interleaves recipes instead of making one row wait behind a complete search', async () => {
    const cache = new LayoutCache();
    const other = { ...request, undergroundBeltReach: 8 };
    cache.subscribe(key, request, vi.fn());
    cache.subscribe(layoutRequestKey(other), other, vi.fn());
    await vi.advanceTimersToNextTimerAsync();
    await vi.advanceTimersToNextTimerAsync();
    expect(
      vi.mocked(solveKernelTileDesign).mock.calls.map((call) => call[2]?.undergroundBeltReach),
    ).toEqual([5, 8]);
  });

  it('retains unsuccessful searches and reports thrown errors', async () => {
    vi.mocked(solveKernelTileDesign).mockReturnValue({
      success: false,
      code: 'invalid-machine',
      message: 'Unsupported machine',
    });
    const cache = new LayoutCache();
    const stop = cache.subscribe(key, request, vi.fn());
    await vi.runAllTimersAsync();
    expect(cache.read(key)).toMatchObject({
      status: 'ready',
      result: { options: [], reason: 'Unsupported machine' },
    });
    stop();
    cache.subscribe(key, request, vi.fn());
    await vi.runAllTimersAsync();
    expect(solveKernelTileDesign).toHaveBeenCalledTimes(21);
    vi.mocked(solveKernelTileDesign).mockImplementation(() => {
      throw new Error('Search failed');
    });
    const other = { ...request, undergroundBeltReach: 8 };
    cache.subscribe(layoutRequestKey(other), other, vi.fn());
    await vi.runAllTimersAsync();
    expect(cache.read(layoutRequestKey(other))).toEqual({
      status: 'error',
      reason: 'Search failed',
    });
  });

  it('bounds unused completed answers without evicting active consumers', async () => {
    const cache = new LayoutCache(1);
    const stop = cache.subscribe(key, request, vi.fn());
    await vi.runAllTimersAsync();
    const other = { ...request, undergroundBeltReach: 8 };
    const otherKey = layoutRequestKey(other);
    cache.subscribe(otherKey, other, vi.fn());
    await vi.runAllTimersAsync();
    expect(cache.read(key)?.status).toBe('ready');
    stop();
    expect(cache.read(key)).toBeUndefined();
    expect(cache.read(otherKey)?.status).toBe('ready');
  });
});
