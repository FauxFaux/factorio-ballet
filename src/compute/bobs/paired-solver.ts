import { bobSolverWorkers } from './solver-workers.ts';
import {
  CpModel,
  CpSat,
  LinearExpr,
  sum,
  setCloudNoticeEnabled,
  type IntVar,
  type CpResult,
  type IntervalVar,
} from 'or-tools-wasm/cp-sat';
import { addBobPlacementSymmetry } from './placement-symmetry.ts';
import { bobTransportData } from './problem-data.ts';
import { annealBobBases } from './base-annealing.ts';
import { checkBobInput } from './input.ts';
import { itemOnlyBobProblem } from './item-problem.ts';
import { validateBobLayout } from './validate.ts';
import {
  defaultBobOptions,
  RATE_SCALE,
  type BobOptions,
  type BobProblem,
  type BobLayout,
  type BobInserter,
  type BobAttempt,
  type BobResult,
} from './types.ts';

import {
  defaultBobPairOptions,
  type BobPairOptions,
  type BobPlacementOptions,
} from './paired-options.ts';
const total = (values: IntVar[]) => LinearExpr.from(sum(values));
export type BobPair = Pick<BobInserter, 'from' | 'to' | 'rates'>;

/** Rates choose topology once. Geometry never participates in this model. */
export function buildBobPairings(problem: BobProblem, options: BobPairOptions) {
  const data = bobTransportData(itemOnlyBobProblem(problem));
  const model = new CpModel();
  const capacity = Math.floor(options.pairingCapacity * RATE_SCALE);
  const resources = [...new Set(data.ports.map((p) => p.resource))];
  const edges = data.nodes.flatMap((from) =>
    data.nodes.flatMap((to) => {
      if (from.id === to.id) return [];
      const rates = resources.flatMap((resource) => {
        const limit = Math.min(
          data.outputs.get(from.id)?.[resource] ?? 0,
          data.inputs.get(to.id)?.[resource] ?? 0,
        );
        return limit > 0
          ? [{ resource, flow: model.newIntVar(0, limit, `${from.id}:${to.id}:${resource}`) }]
          : [];
      });
      if (!rates.length) return [];
      const count = model.newIntVar(0, options.maxInserters, `${from.id}:${to.id}:count`);
      model.add(total(rates.map((r) => r.flow)).le(count.times(capacity)));
      return [{ from: from.id, to: to.id, rates, count }];
    }),
  );
  for (const port of data.ports) {
    const flows = edges
      .filter((e) => (port.side === 'input' ? e.to : e.from) === port.node)
      .flatMap((e) => e.rates.filter((r) => r.resource === port.resource).map((r) => r.flow));
    model.add(total(flows).eq(Math.round(port.rate * RATE_SCALE)));
  }
  model.add(total(edges.map((e) => e.count)).le(options.maxInserters));
  model.minimize(total(edges.map((e) => e.count)));
  const read = (result: CpResult): BobPair[] =>
    edges.flatMap((edge) => {
      const remaining = edge.rates.map((r) => ({
        resource: r.resource,
        rate: Number(result.value(r.flow)),
      }));
      return Array.from({ length: Number(result.value(edge.count)) }, () => {
        let space = capacity;
        const rates = Object.fromEntries(
          remaining.flatMap((r) => {
            const rate = Math.min(space, r.rate);
            space -= rate;
            r.rate -= rate;
            return rate ? [[r.resource, rate / RATE_SCALE]] : [];
          }),
        );
        return { from: edge.from, to: edge.to, rates };
      }).filter((pair) => Object.keys(pair.rates).length);
    });
  return { model, read, data };
}

/** Fixed edges, free machine rectangles and bases; no reach or swing tables. */
export function buildBobPairedPlacement(
  problem: BobProblem,
  pairs: BobPair[],
  options: BobOptions & Partial<BobPlacementOptions>,
) {
  const boundaryEdges = options.boundaryEdges ?? defaultBobPairOptions.boundaryEdges;
  const breakSymmetry = options.breakSymmetry ?? defaultBobPairOptions.breakSymmetry;
  const definitions = bobTransportData(itemOnlyBobProblem(problem)).nodes;
  const model = new CpModel();
  const width = model.newIntVar(1, options.maxWidth, 'width');
  const height = model.newIntVar(1, options.maxHeight, 'height');
  const horizontal: IntervalVar[] = [],
    vertical: IntervalVar[] = [];
  const rectangle = (id: string, w: number, h: number) => {
    const x = model.newIntVar(0, Math.max(2, options.maxWidth - 1), `${id}:x`);
    const y = model.newIntVar(0, Math.max(2, options.maxHeight - 1), `${id}:y`);
    const rw = model.newIntVar(Math.min(w, h), Math.max(w, h), `${id}:w`);
    const rh = model.newIntVar(Math.min(w, h), Math.max(w, h), `${id}:h`);
    model.addAllowedAssignments(
      [rw, rh],
      [
        [w, h],
        [h, w],
      ],
    );
    const right = model.newIntVar(1, options.maxWidth + Math.max(w, h), `${id}:right`);
    const bottom = model.newIntVar(1, options.maxHeight + Math.max(w, h), `${id}:bottom`);
    model.add(right.eq(x.plus(rw)));
    model.add(bottom.eq(y.plus(rh)));
    model.add(right.le(width));
    model.add(bottom.le(height));
    horizontal.push(model.newIntervalVar(x, w === h ? w : rw, right, `${id}:horizontal`));
    vertical.push(model.newIntervalVar(y, w === h ? h : rh, bottom, `${id}:vertical`));
    return { x, y, w: rw, h: rh, right, bottom };
  };
  const nodes = definitions.map((d) => ({
    definition: d,
    ...rectangle(d.id, d.size.width, d.size.height),
  }));
  for (const n of nodes.filter((n) => n.definition.kind !== 'assembler')) {
    if (boundaryEdges === 'left-right') {
      model.add(n.definition.kind === 'source' ? n.x.eq(0) : n.right.eq(width));
      continue;
    }
    const sides = Array.from({ length: 4 }, (_, i) =>
      model.newBoolVar(`${n.definition.id}:side:${i}`),
    );
    model.addBoolOr(sides);
    [n.x.eq(0), n.y.eq(0), n.right.eq(width), n.bottom.eq(height)].forEach((c, i) =>
      model.add(c).onlyEnforceIf(sides[i]),
    );
  }
  const distances: IntVar[] = [];
  const arms = pairs.map((pair, i) => {
    const base = rectangle(`base:${i}`, 1, 1);
    const endpoints = [pair.from, pair.to].map((id, end) => {
      const node = nodes.find((n) => n.definition.id === id)!;
      const x = model.newIntVar(0, Math.max(2, options.maxWidth - 1), `${i}:${end}:x`);
      const y = model.newIntVar(0, Math.max(2, options.maxHeight - 1), `${i}:${end}:y`);
      model.add(x.ge(node.x));
      model.add(x.lt(node.right));
      model.add(y.ge(node.y));
      model.add(y.lt(node.bottom));
      const dx = model.newIntVar(0, options.maxWidth, `${i}:${end}:dx`);
      const dy = model.newIntVar(0, options.maxHeight, `${i}:${end}:dy`);
      model.addAbsEquality(dx, x.minus(base.x));
      model.addAbsEquality(dy, y.minus(base.y));
      distances.push(dx, dy);
      return { x, y };
    });
    return { pair, base, endpoints };
  });
  model.addNoOverlap2D(horizontal, vertical);
  if (breakSymmetry) {
    addBobPlacementSymmetry(
      model,
      width,
      height,
      [...nodes, ...arms.map((a) => a.base)],
      options.maxWidth,
      options.maxHeight,
      boundaryEdges === 'left-right',
    );
  }
  model.minimize(
    total(distances)
      .times(options.maxWidth + options.maxHeight + 1)
      .plus(width)
      .plus(height),
  );
  const read = (result: CpResult): BobLayout => {
    const value = (v: IntVar) => Number(result.value(v));
    const point = (p: { x: IntVar; y: IntVar }) => ({ x: value(p.x), y: value(p.y) });
    return {
      width: value(width),
      height: value(height),
      transport: 'relaxed',
      nodes: nodes.map((n) => ({
        ...n.definition,
        position: point(n),
        size: { width: value(n.w), height: value(n.h) },
      })),
      inserters: arms.map((a) => ({
        ...a.pair,
        position: point(a.base),
        pickup: point(a.endpoints[0]),
        dropoff: point(a.endpoints[1]),
        capacity: 0,
      })),
    };
  };
  return { model, read };
}

export async function solveBobPairedLayout(
  problem: BobProblem,
  settings: Partial<BobPairOptions> = {},
  signal?: AbortSignal,
  onAttempt?: (attempt: BobAttempt) => void,
): Promise<BobResult> {
  signal?.throwIfAborted();
  problem = itemOnlyBobProblem(problem);
  const options = { ...defaultBobOptions(problem), ...defaultBobPairOptions, ...settings };
  checkBobInput(problem, Infinity);
  setCloudNoticeEnabled(false);
  const topology = buildBobPairings(problem, options);
  const paired = await CpSat.solve(topology.model, {
    numWorkers: bobSolverWorkers(),
    maxTimeInSeconds: options.pairingSeconds,
    signal,
  });
  signal?.throwIfAborted();
  if (!paired.hasSolution)
    return {
      status: 'unknown',
      message:
        'No pairings found within the selected inserter, capacity and time bounds; physical feasibility is unknown.',
    };
  const pairs = topology.read(paired);
  const placement = buildBobPairedPlacement(problem, pairs, options);
  const packed = await CpSat.solve(placement.model, {
    numWorkers: bobSolverWorkers(),
    maxTimeInSeconds: options.maxTimeInSeconds,
    signal,
  });
  signal?.throwIfAborted();
  if (!packed.hasSolution)
    return {
      status: 'unknown',
      message: 'The fixed pairings could not be placed within the selected bounds and time budget.',
    };
  const relaxed = placement.read(packed);
  const attempts: BobAttempt[] = [];
  const publish = (layout: BobLayout, stage: BobAttempt['stage'], message: string) => {
    const attempt: BobAttempt = {
      id: attempts.length + 1,
      layout,
      stage,
      message,
      conflicts: [],
      promoted: [],
    };
    attempts.push(attempt);
    onAttempt?.(attempt);
  };
  publish(
    relaxed,
    'placement',
    `${pairs.length} fixed pairings placed using minimum base-to-footprint Manhattan distance. Reach and capacity require base legalization.`,
  );
  const layout = await annealBobBases(relaxed, options.annealingSeconds, signal);
  if (!layout) {
    attempts[0] = {
      ...attempts[0],
      stage: 'conflict',
      message:
        'Base annealing did not legalize this fixed placement. Pairing sketch retained; reach and capacity remain unvalidated.',
    };
    onAttempt?.(attempts[0]);
    return {
      status: 'unknown',
      attempts,
      message:
        'Relaxed placement retained. Base annealing did not find legal inserters for these fixed pairings; no placement retries were run.',
    };
  }
  const errors = validateBobLayout(problem, layout);
  if (errors.length) throw new Error(`Paired layout validation failed: ${errors.join('; ')}`);
  publish(layout, 'solved', 'Fixed pairings legalized and independently validated.');
  return {
    status: 'feasible',
    layout,
    attempts,
    message: 'Fixed-pair layout connected and validated after one placement and base annealing.',
  };
}
