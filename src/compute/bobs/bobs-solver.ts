import {
  CpModel,
  CpSat,
  CpSolverStatus,
  sum as linearSum,
  LinearExpr,
  setCloudNoticeEnabled,
  type BoolVar,
  type IntVar,
  type IntervalVar,
} from 'or-tools-wasm/cp-sat';
import { bobSwings } from './geometry.ts';
import {
  defaultBobOptions,
  RATE_SCALE,
  type BobLayout,
  type BobOptions,
  type BobProblem,
  type BobResult,
  type Rates,
} from './types.ts';
import type { ResourceId } from '../../types.ts';
import { validateBobLayout } from './validate.ts';
import { itemOnlyBobProblem } from './item-problem.ts';

type Rect = { x: IntVar; y: IntVar; width: IntVar; height: IntVar; present: BoolVar };

const sum = (values: Iterable<IntVar>) => LinearExpr.from(linearSum(values));

/** Exposed for inspecting or adding experimental constraints before a solve. */
export function buildBobModel(problem: BobProblem, settings: Partial<BobOptions> = {}) {
  problem = itemOnlyBobProblem(problem);
  const options = { ...defaultBobOptions(problem), ...settings };
  checkInput(problem, options);
  const { maxWidth, maxHeight, maxChests, maxInserters } = options;
  const model = new CpModel();
  const width = model.newIntVar(1, maxWidth, 'width');
  const height = model.newIntVar(1, maxHeight, 'height');
  const xIntervals: IntervalVar[] = [];
  const yIntervals: IntervalVar[] = [];
  const rect = (name: string, w: number, h: number, optional = false, rotate = false): Rect => {
    const present = model.newBoolVar(`${name}:present`);
    if (!optional) model.add(present.eq(1));
    // The wrapper rejects Boolean-domain integer variables in optional intervals.
    const x = model.newIntVar(0, Math.max(2, maxWidth - 1), `${name}:x`);
    const y = model.newIntVar(0, Math.max(2, maxHeight - 1), `${name}:y`);
    const rw = model.newIntVar(Math.min(w, h), Math.max(w, h), `${name}:w`);
    const rh = model.newIntVar(Math.min(w, h), Math.max(w, h), `${name}:h`);
    model.addAllowedAssignments(
      [rw, rh],
      rotate && w !== h
        ? [
            [w, h],
            [h, w],
          ]
        : [[w, h]],
    );
    const endX = model.newIntVar(1, maxWidth + Math.max(w, h), `${name}:right`);
    const endY = model.newIntVar(1, maxHeight + Math.max(w, h), `${name}:bottom`);
    model.add(endX.eq(x.plus(rw)));
    model.add(endY.eq(y.plus(rh)));
    model.add(endX.le(width)).onlyEnforceIf(present);
    model.add(endY.le(height)).onlyEnforceIf(present);
    model.add(x.eq(0)).onlyEnforceIf(present.not());
    model.add(y.eq(0)).onlyEnforceIf(present.not());
    xIntervals.push(
      model.newOptionalIntervalVar(x, w === h ? w : rw, endX, present, `${name}:horizontal`),
    );
    yIntervals.push(
      model.newOptionalIntervalVar(y, w === h ? h : rh, endY, present, `${name}:vertical`),
    );
    return { x, y, width: rw, height: rh, present };
  };
  const definitions = [
    ...problem.machines.map((machine) => ({
      ...machine,
      kind: 'assembler' as const,
      resource: undefined,
    })),
    ...problem.inputs.map((resource) => ({
      id: `source:${resource}`,
      label: `Source: ${resource}`,
      resource,
      kind: 'source' as const,
      size: { width: 1, height: 1 },
    })),
    ...problem.outputs.map((resource) => ({
      id: `sink:${resource}`,
      label: `Sink: ${resource}`,
      resource,
      kind: 'sink' as const,
      size: { width: 1, height: 1 },
    })),
    ...Array.from({ length: maxChests }, (_, i) => ({
      id: `chest:${i}`,
      label: `Chest ${i + 1}`,
      kind: 'chest' as const,
      resource: undefined,
      size: { width: 1, height: 1 },
    })),
  ];
  const nodes = definitions.map((d) =>
    rect(d.id, d.size.width, d.size.height, d.kind === 'chest', d.kind === 'assembler'),
  );
  const source = problem.machines.length;
  const chestStart = source + problem.inputs.length + problem.outputs.length;
  for (let index = source; index < chestStart; index++) {
    const node = nodes[index];
    const sides = Array.from({ length: 4 }, (_, i) => model.newBoolVar(`${index}:boundary:${i}`));
    model.addBoolOr(sides);
    [node.x.eq(0), node.y.eq(0), node.x.plus(1).eq(width), node.y.plus(1).eq(height)].forEach(
      (bound, i) => model.add(bound).onlyEnforceIf(sides[i]),
    );
  }
  const chests = nodes.slice(chestStart);
  const ordered = (previous: Rect, next: Rect) => {
    model.addImplication(next.present, previous.present);
    model
      .add(previous.x.times(maxHeight).plus(previous.y).lt(next.x.times(maxHeight).plus(next.y)))
      .onlyEnforceIf(next.present);
  };
  chests.forEach((node, i) => {
    if (i) ordered(chests[i - 1], node);
  });

  const resources = [
    ...new Set(
      problem.machines.flatMap((m) => [...Object.keys(m.inputs), ...Object.keys(m.outputs)]),
    ),
  ] as ResourceId[];
  const inputs = problem.machines.map((m) => quantize(m.inputs));
  const outputs = problem.machines.map((m) => quantize(m.outputs));
  // Rounding each copy can leave a few integer units at a balanced internal edge. Reconcile
  // those units at a producer; actual emitted rates are independently checked within this tolerance.
  for (const resource of resources) {
    if (problem.inputs.includes(resource) || problem.outputs.includes(resource)) continue;
    const original = problem.machines.reduce(
      (n, m) => n + (m.outputs[resource] ?? 0) - (m.inputs[resource] ?? 0),
      0,
    );
    if (Math.abs(original) > 1e-6)
      throw new Error(`Internal resource ${resource} is not balanced.`);
    const difference =
      inputs.reduce((n, r) => n + (r[resource] ?? 0), 0) -
      outputs.reduce((n, r) => n + (r[resource] ?? 0), 0);
    const producer = outputs.find((r) => (r[resource] ?? 0) > 0);
    if (difference && producer) producer[resource] = producer[resource]! + difference;
  }
  const supply = resources.map(
    (r) =>
      inputs.reduce((n, m) => n + (m[r] ?? 0), 0) - outputs.reduce((n, m) => n + (m[r] ?? 0), 0),
  );
  supply.forEach((rate, i) => {
    if (
      (rate > 0 && !problem.inputs.includes(resources[i])) ||
      (rate < 0 && !problem.outputs.includes(resources[i]))
    ) {
      throw new Error(`Declare the external ${rate > 0 ? 'input' : 'output'} for ${resources[i]}.`);
    }
  });
  const incoming = nodes.map(() => resources.map(() => [] as IntVar[]));
  const outgoing = nodes.map(() => resources.map(() => [] as IntVar[]));
  const swings = bobSwings();
  const maxCapacity = Math.floor(Math.max(...swings.map((s) => s.capacity)) * RATE_SCALE);
  const slots = Array.from({ length: maxInserters }, (_, index) => {
    const base = rect(`inserter:${index}`, 1, 1, true);
    const px = model.newIntVar(0, maxWidth - 1, `pickup:${index}:x`);
    const py = model.newIntVar(0, maxHeight - 1, `pickup:${index}:y`);
    const dx = model.newIntVar(0, maxWidth - 1, `dropoff:${index}:x`);
    const dy = model.newIntVar(0, maxHeight - 1, `dropoff:${index}:y`);
    const capacity = model.newIntVar(0, maxCapacity, `capacity:${index}`);
    const offsets = ['px', 'py', 'dx', 'dy'].map((axis) =>
      model.newIntVar(-3, 3, `${index}:${axis}:offset`),
    );
    [px, py, dx, dy].forEach((endpoint, i) =>
      model.add(endpoint.eq((i % 2 === 0 ? base.x : base.y).plus(offsets[i]))),
    );
    model.addAllowedAssignments(
      [...offsets, capacity],
      [
        [0, 0, 0, 0, 0],
        ...swings.map((s) => [
          s.pickup.x,
          s.pickup.y,
          s.dropoff.x,
          s.dropoff.y,
          Math.floor(s.capacity * RATE_SCALE),
        ]),
      ],
    );
    model.add(capacity.eq(0)).onlyEnforceIf(base.present.not());
    model.add(capacity.ge(1)).onlyEnforceIf(base.present);
    const rates = resources.map((_, r) => model.newIntVar(0, maxCapacity, `flow:${index}:${r}`));
    model.add(sum(rates).le(capacity));
    model.add(sum(rates).ge(base.present));
    const selections = (side: 'from' | 'to', ex: IntVar, ey: IntVar) => {
      const selections = nodes.map((node, n) => {
        const selected = model.newBoolVar(`${index}:${side}:${n}`);
        model.addImplication(selected, node.present);
        model.add(ex.ge(node.x)).onlyEnforceIf(selected);
        model.add(ey.ge(node.y)).onlyEnforceIf(selected);
        model.add(ex.lt(node.x.plus(node.width))).onlyEnforceIf(selected);
        model.add(ey.lt(node.y.plus(node.height))).onlyEnforceIf(selected);
        const flows = side === 'from' ? outgoing[n] : incoming[n];
        resources.forEach((resource, r) => {
          const machineRates = side === 'from' ? outputs[n] : inputs[n];
          const definition = definitions[n];
          const allowed =
            n < source
              ? (machineRates[resource] ?? 0) > 0
              : definition.kind === 'source'
                ? side === 'from' && definition.resource === resource && supply[r] > 0
                : definition.kind === 'sink'
                  ? side === 'to' && definition.resource === resource && supply[r] < 0
                  : true;
          if (!allowed) {
            model.add(rates[r].eq(0)).onlyEnforceIf(selected);
            return;
          }
          const flow = model.newIntVar(0, maxCapacity, `${index}:${side}:${n}:${r}`);
          model.add(flow.eq(rates[r])).onlyEnforceIf(selected);
          model.add(flow.eq(0)).onlyEnforceIf(selected.not());
          flows[r].push(flow);
        });
        if (
          (side === 'from' && definitions[n].kind === 'sink') ||
          (side === 'to' && definitions[n].kind === 'source')
        )
          model.add(selected.eq(0));
        return selected;
      });
      model.add(sum(selections).eq(base.present));
      return selections;
    };
    const from = selections('from', px, py);
    const to = selections('to', dx, dy);
    nodes.forEach((_, n) => model.addAtMostOne([from[n], to[n]]));
    return { base, px, py, dx, dy, capacity, rates, from, to };
  });
  slots.forEach((slot, i) => {
    if (i) ordered(slots[i - 1].base, slot.base);
  });
  nodes.forEach((node, n) =>
    resources.forEach((resource, r) => {
      const ins = sum(incoming[n][r]);
      const outs = sum(outgoing[n][r]);
      if (n < source) {
        model.add(ins.eq(inputs[n][resource] ?? 0));
        model.add(outs.eq(outputs[n][resource] ?? 0));
      } else if (definitions[n].kind === 'source') {
        model.add(outs.eq(definitions[n].resource === resource ? Math.max(0, supply[r]) : 0));
      } else if (definitions[n].kind === 'sink') {
        model.add(ins.eq(definitions[n].resource === resource ? Math.max(0, -supply[r]) : 0));
      } else {
        model.add(ins.eq(outs));
        model.add(ins.eq(0)).onlyEnforceIf(node.present.not());
      }
    }),
  );
  // Every active relay must actually be used. There is intentionally no degree limit.
  chests.forEach((node, i) => model.add(sum(incoming[chestStart + i].flat()).ge(node.present)));
  model.addNoOverlap2D(xIntervals, yIntervals);
  const entityCount = sum([...chests, ...slots.map((s) => s.base)].map((r) => r.present));
  model.minimize(
    width
      .plus(height)
      .times(maxChests + maxInserters + 1)
      .plus(entityCount),
  );
  return { model, options, width, height, definitions, nodes, slots, resources };
}

/** Bounded joint packing and multi-commodity transport; no fixed assembler grid or route tree. */
export async function solveBobLayout(
  problem: BobProblem,
  settings: Partial<BobOptions> = {},
  signal?: AbortSignal,
): Promise<BobResult> {
  const { model, options, width, height, definitions, nodes, slots, resources } = buildBobModel(
    problem,
    settings,
  );
  const { maxWidth, maxHeight, maxChests, maxInserters } = options;
  setCloudNoticeEnabled(false);
  const result = await CpSat.solve(model, {
    numWorkers: 1,
    maxTimeInSeconds: options.maxTimeInSeconds,
    signal,
  });
  const isStatus = (status: keyof typeof CpSolverStatus) =>
    result.status === status || result.status === CpSolverStatus[status];
  const scope = `${maxWidth}×${maxHeight}, ≤${maxChests} relay chests, ≤${maxInserters} inserters`;
  if (!result.hasSolution) {
    if (isStatus('MODEL_INVALID'))
      throw new Error(`Invalid CP-SAT model: ${result.response?.solutionInfo ?? ''}`);
    return {
      status: isStatus('INFEASIBLE') ? 'infeasible' : 'unknown',
      message: isStatus('INFEASIBLE')
        ? `No layout fits these search bounds (${scope}).`
        : `No solution found within ${options.maxTimeInSeconds}s (${scope}); feasibility is unknown.`,
    };
  }
  const value = (v: IntVar) => Number(result.value(v));
  const layout: BobLayout = {
    width: value(width),
    height: value(height),
    nodes: nodes.flatMap((node, n) =>
      result.booleanValue(node.present)
        ? [
            {
              id: definitions[n].id,
              label: definitions[n].label,
              kind: definitions[n].kind,
              resource: definitions[n].resource,
              position: { x: value(node.x), y: value(node.y) },
              size: { width: value(node.width), height: value(node.height) },
            },
          ]
        : [],
    ),
    inserters: slots.flatMap((slot) =>
      result.booleanValue(slot.base.present)
        ? [
            {
              position: { x: value(slot.base.x), y: value(slot.base.y) },
              pickup: { x: value(slot.px), y: value(slot.py) },
              dropoff: { x: value(slot.dx), y: value(slot.dy) },
              from: definitions[slot.from.findIndex((s) => result.booleanValue(s))].id,
              to: definitions[slot.to.findIndex((s) => result.booleanValue(s))].id,
              capacity: value(slot.capacity) / RATE_SCALE,
              rates: Object.fromEntries(
                resources.flatMap((r, i) =>
                  value(slot.rates[i]) ? [[r, value(slot.rates[i]) / RATE_SCALE]] : [],
                ),
              ),
            },
          ]
        : [],
    ),
  };
  const errors = validateBobLayout(problem, layout);
  if (errors.length) throw new Error(`Layout validation failed: ${errors.join('; ')}`);
  const optimal = isStatus('OPTIMAL');
  return {
    status: optimal ? 'optimal' : 'feasible',
    layout,
    message: `${optimal ? 'Optimal within search bounds' : 'Feasible; optimality not proven'} (${scope}).`,
  };
}

function quantize(rates: Rates): Rates {
  return Object.fromEntries(
    Object.entries(rates).map(([r, rate]) => [r, Math.round(rate! * RATE_SCALE)]),
  );
}

function checkInput(problem: BobProblem, options: BobOptions) {
  if (!problem.machines.length) throw new Error('Add a recipe to place assemblers.');
  if (problem.machines.length > 24)
    throw new Error('This experimental search supports at most 24 assemblers.');
  if (
    new Set(problem.machines.map((m) => m.id)).size !== problem.machines.length ||
    problem.machines.some((m) => /^(source|sink|chest):/.test(m.id))
  ) {
    throw new Error('Machine IDs must be unique and must not use reserved chest IDs.');
  }
  for (const m of problem.machines) {
    if (![m.size.width, m.size.height].every((n) => Number.isInteger(n) && n > 0))
      throw new Error('Machine footprints must use positive whole tiles.');
    for (const [resource, rate] of [...Object.entries(m.inputs), ...Object.entries(m.outputs)]) {
      if (!resource.startsWith('item:'))
        throw new Error('Inserter transport requires item resources.');
      if (!Number.isFinite(rate) || rate! < 0 || rate! > 1e6)
        throw new Error('Item rates must be finite, nonnegative and at most 1,000,000/s.');
    }
  }
  if (
    ![options.maxWidth, options.maxHeight].every((n) => Number.isInteger(n) && n > 0 && n <= 128) ||
    !Number.isInteger(options.maxChests) ||
    options.maxChests < 0 ||
    options.maxChests > 32 ||
    !Number.isInteger(options.maxInserters) ||
    options.maxInserters < 0 ||
    options.maxInserters > 128 ||
    !Number.isFinite(options.maxTimeInSeconds) ||
    options.maxTimeInSeconds <= 0 ||
    options.maxTimeInSeconds > 120
  ) {
    throw new Error(
      'Use bounds of 1–128 tiles, 0–32 relay chests, 0–128 inserters and 0–120 seconds.',
    );
  }
}
