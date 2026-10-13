// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCellPlacementPlan } from '../src/components/cell/placement-plan.ts';
import { baselineCellPlacements, type PlacementPlan } from '../src/compute/placement-plan/index.ts';
import type { PlacementDemand } from '../src/compute/placement-plan/recipes.ts';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage?: (event: MessageEvent<{ id: number; plan: PlacementPlan }>) => void;
  onerror?: () => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    FakeWorker.instances.push(this);
  }
}
const demand = (count: number): PlacementDemand => ({
  machineCount: count,
  options: [],
  problem: {
    assemblers: [{ name: 'test', inputPerSecond: {}, outputPerSecond: {} }],
    inputs: { solids: { 'item:ore': 1 }, fluids: {} },
    outputs: { solids: { 'item:plate': 1 }, fluids: {} },
    design: { columns: [] },
  },
});
function Preview({
  count,
  enabled = true,
  pending = false,
}: {
  count: number;
  enabled?: boolean;
  pending?: boolean;
}) {
  const plan = useCellPlacementPlan([{ ...demand(count), pending }], enabled, 60, {
    inputs: ['item:ore'],
    outputs: ['item:plate'],
  });
  return (
    <output aria-label="plan">
      {plan.diagnostics.solver}:{plan.modules.reduce((sum, module) => sum + module.workload!, 0)}
    </output>
  );
}
function answer(worker: FakeWorker, count: number) {
  const plan = baselineCellPlacements([demand(count)], 60);
  plan.diagnostics = { solver: 'highs', status: 'optimal' };
  worker.onmessage?.({ data: { id: 1, plan } } as MessageEvent<{
    id: number;
    plan: PlacementPlan;
  }>);
}
beforeEach(() => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('asynchronous default placement planning', () => {
  it('runs off the render path, publishes retained plans, and reuses completed requests', async () => {
    const view = render(<Preview count={1} />);
    expect(screen.getByLabelText('plan').textContent).toBe('baseline:1');
    const first = FakeWorker.instances[0];
    expect(first.postMessage).toHaveBeenCalledOnce();
    await act(() => answer(first, 1));
    expect(screen.getByLabelText('plan').textContent).toBe('highs:1');
    expect(first.terminate).toHaveBeenCalled();
    view.rerender(<Preview count={2} />);
    await act(() => answer(FakeWorker.instances[1], 2));
    view.rerender(<Preview count={1} />);
    expect(screen.getByLabelText('plan').textContent).toBe('highs:1');
    expect(FakeWorker.instances).toHaveLength(2);
  });

  it('cancels changed requests and ignores stale worker replies', async () => {
    const view = render(<Preview count={1} />);
    const obsolete = FakeWorker.instances[0];
    view.rerender(<Preview count={3} />);
    expect(obsolete.terminate).toHaveBeenCalled();
    await act(() => answer(obsolete, 1));
    expect(screen.getByLabelText('plan').textContent).toBe('baseline:3');
    await act(() => answer(FakeWorker.instances[1], 3));
    expect(screen.getByLabelText('plan').textContent).toBe('highs:3');
    view.unmount();
    expect(FakeWorker.instances[1].terminate).toHaveBeenCalled();
  });

  it('waits for kernel answers and only creates workers for open layouts', () => {
    const view = render(<Preview count={1} enabled={false} />);
    expect(FakeWorker.instances).toHaveLength(0);
    view.rerender(<Preview count={1} pending />);
    expect(FakeWorker.instances).toHaveLength(0);
    view.rerender(<Preview count={1} />);
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it('keeps a usable baseline if worker loading fails', async () => {
    render(<Preview count={2} />);
    await act(() => FakeWorker.instances[0].onerror?.());
    expect(screen.getByLabelText('plan').textContent).toBe('baseline:2');
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalled();
  });
  it('keeps a usable baseline when the browser refuses to create a worker', () => {
    vi.stubGlobal(
      'Worker',
      class {
        constructor() {
          throw new Error('Worker creation denied');
        }
      },
    );
    render(<Preview count={2} />);
    expect(screen.getByLabelText('plan').textContent).toBe('baseline:2');
  });
});
