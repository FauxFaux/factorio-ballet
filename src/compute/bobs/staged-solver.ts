import { CpSat, CpSolverStatus, setCloudNoticeEnabled, type CpResult } from 'or-tools-wasm/cp-sat';
import { buildBobPlacement } from './placement.ts';
import { buildBobTransport, BobTransportTimeout } from './transport.ts';
import { bobTransportData, portKey } from './problem-data.ts';
import { checkBobInput } from './input.ts';
import { itemOnlyBobProblem } from './item-problem.ts';
import { validateBobLayout } from './validate.ts';
import {
  defaultBobOptions,
  type BobAttempt,
  type BobOptions,
  type BobPort,
  type BobProblem,
  type BobResult,
} from './types.ts';

const isStatus = (result: CpResult, status: keyof typeof CpSolverStatus) =>
  result.status === status || result.status === CpSolverStatus[status];

/** Placement/refinement heuristic. Only complete, independently validated layouts are returned. */
export async function solveBobLayout(
  problem: BobProblem,
  settings: Partial<BobOptions> = {},
  signal?: AbortSignal,
  onAttempt?: (attempt: BobAttempt) => void,
): Promise<BobResult> {
  signal?.throwIfAborted();
  problem = itemOnlyBobProblem(problem);
  const options = { ...defaultBobOptions(problem), ...settings };
  checkBobInput(problem, options);
  const deadline = performance.now() + options.maxTimeInSeconds * 1000;
  const remaining = () => Math.max(0, (deadline - performance.now()) / 1000);
  const data = bobTransportData(problem);
  const attempts: BobAttempt[] = [];
  const promoted: BobPort[] = [];
  const unknown = (): BobResult => ({
    status: 'unknown',
    attempts,
    message: `No complete transport layout found within the time budget; feasibility is unknown. ${attempts.length} placements retained.`,
  });
  if (data.minInserters > options.maxInserters)
    return {
      status: 'infeasible',
      attempts,
      message: `Item throughput requires at least ${data.minInserters} inserters; the selected bound is ${options.maxInserters}.`,
    };
  setCloudNoticeEnabled(false);
  let minimumPerimeter = 0;
  let reserveRelays = false;
  let expandParallelSlots = false;
  const publish = (attempt: BobAttempt) => {
    attempts[attempt.id - 1] = attempt;
    onAttempt?.(attempt);
  };
  for (let retry = 0; remaining() > 0.005; retry++) {
    signal?.throwIfAborted();
    const placement = buildBobPlacement(
      data,
      reserveRelays ? options : { ...options, maxChests: 0 },
      promoted,
      attempts.map((a) => a.layout),
      minimumPerimeter,
      expandParallelSlots,
    );
    if (remaining() <= 0.005) return unknown();
    const packed = await CpSat.solve(placement.model, {
      numWorkers: 1,
      maxTimeInSeconds: Math.min(1, remaining() / 3),
      signal,
    });
    signal?.throwIfAborted();
    if (isStatus(packed, 'MODEL_INVALID'))
      throw new Error(`Invalid placement model: ${packed.response?.solutionInfo ?? ''}`);
    if (!packed.hasSolution) {
      if (retry === 0 && isStatus(packed, 'INFEASIBLE'))
        return {
          status: 'infeasible',
          attempts,
          message:
            'Assemblers, boundary chests and the minimum inserter space cannot fit these bounds.',
        };
      // Start with small partner banks, then allow extra parallel arms when
      // reach geometry cannot supply enough capacity with the smaller banks.
      if (promoted.length && !expandParallelSlots) {
        expandParallelSlots = true;
        continue;
      }
      // Prefer direct reservations so optional relays do not steer a compact
      // direct solution toward a topology that needs additional chest space.
      if (promoted.length && !reserveRelays && options.maxChests > 0) {
        reserveRelays = true;
        continue;
      }
      if (!isStatus(packed, 'INFEASIBLE')) continue;
      // Promotions and excluded placements restrict this heuristic, so their infeasibility
      // is never reported as proof about the original problem. Retry with more space.
      promoted.splice(Math.max(0, promoted.length - 2));
      reserveRelays = false;
      expandParallelSlots = false;
      minimumPerimeter = Math.min(minimumPerimeter + 1, options.maxWidth + options.maxHeight);
      continue;
    }
    let attempt: BobAttempt = {
      id: attempts.length + 1,
      layout: placement.read(packed),
      stage: 'placement',
      conflicts: [],
      promoted: [...promoted],
      message: 'Assemblers placed; selecting inserters and relay chests…',
    };
    publish(attempt);
    // Grow the relay budget gradually. One-chest graphs exclude chest-to-chest
    // edges, making common relay routes much cheaper to find than the full graph.
    const relayBudgets = [0];
    for (let count = 1; count < options.maxChests; count *= 2) relayBudgets.push(count);
    if (options.maxChests > 0) relayBudgets.push(options.maxChests);
    for (const relayBudget of relayBudgets) {
      if (remaining() <= 0.005) break;
      let transport: Awaited<ReturnType<typeof buildBobTransport>>;
      try {
        transport = await buildBobTransport(
          data,
          attempt.layout,
          { ...options, maxChests: relayBudget },
          relayBudget > 0,
          signal,
          deadline,
          'hints',
        );
      } catch (error) {
        if (!(error instanceof BobTransportTimeout)) throw error;
        attempt = {
          ...attempt,
          stage: 'conflict',
          message: error.message,
          conflicts: error.conflicts,
        };
        publish(attempt);
        break;
      }
      if (remaining() <= 0.005) {
        attempt = {
          ...attempt,
          stage: 'conflict',
          message: 'Transport enumeration exhausted the time budget.',
          conflicts: transport.conflicts(true),
        };
        publish(attempt);
        break;
      }
      const selected = await CpSat.solve(transport.model, {
        numWorkers: 1,
        maxTimeInSeconds: Math.min(1.5, remaining() / (relayBudget ? 1.5 : 3)),
        signal,
      });
      signal?.throwIfAborted();
      if (isStatus(selected, 'MODEL_INVALID'))
        throw new Error(`Invalid transport model: ${selected.response?.solutionInfo ?? ''}`);
      if (selected.hasSolution) {
        const layout = transport.read(selected);
        const errors = validateBobLayout(problem, layout);
        if (errors.length) throw new Error(`Layout validation failed: ${errors.join('; ')}`);
        attempt = {
          ...attempt,
          layout,
          stage: 'solved',
          conflicts: [],
          message: 'Transport connected and validated.',
        };
        publish(attempt);
        const optimal = !data.ports.length && isStatus(packed, 'OPTIMAL');
        return {
          status: optimal ? 'optimal' : 'feasible',
          layout,
          attempts,
          message: optimal
            ? 'Optimal packing; no item transport required.'
            : `Feasible layout found after ${attempts.length} placement${attempts.length === 1 ? '' : 's'}; global optimality is not proven.`,
        };
      }
      const timedOut = !isStatus(selected, 'INFEASIBLE');
      attempt = {
        ...attempt,
        stage: 'conflict',
        conflicts: transport.conflicts(timedOut),
        message: timedOut
          ? 'Transport search timed out. Highlighted regions are suspected bottlenecks.'
          : `No transport fits this fixed placement${relayBudget ? ` with ≤${relayBudget} relay chests` : ' using direct connections'}. Highlighted regions guide the next attempt.`,
      };
      publish(attempt);
    }
    if (attempt.stage === 'placement') {
      publish({
        ...attempt,
        stage: 'conflict',
        message: 'Time budget exhausted before transport could finish.',
      });
    }
    const suggestions = [
      ...attempt.conflicts.flatMap((c) => c.ports),
      ...data.ports.slice().sort((a, b) => b.rate - a.rate),
    ].filter((port) => data.nodes.some((n) => n.id === port.node && n.kind === 'assembler'));
    // Boundary fan-out/fan-in is already constrained at the machine ends.
    // Promoting it as well introduces a large duplicate bank of optional arms.
    let added = 0;
    for (const port of suggestions) {
      if (promoted.some((p) => portKey(p) === portKey(port))) continue;
      promoted.push(port);
      if (++added === 2) break;
    }
    reserveRelays = false;
    expandParallelSlots = false;
    // First try the promoted connections at the same perimeter. After two failed
    // packings permit more space, while still retrying arrangements at fixed bounds.
    minimumPerimeter = Math.min(
      options.maxWidth + options.maxHeight,
      Math.max(
        minimumPerimeter,
        attempt.layout.width + attempt.layout.height + (attempts.length % 2 === 0 ? 1 : 0),
      ),
    );
  }
  return unknown();
}
