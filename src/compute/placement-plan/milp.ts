import type { Highs } from 'highs';

export interface Rate {
  material: string;
  rate: number;
}
export interface SplitProblem {
  inputs: Rate[];
  outputs: Rate[];
  recipes: {
    recipe: string;
    count: number;
    inputs: Rate[];
    outputs: Rate[];
    layoutOptions: {
      size: { width: number; height: number };
      capacity: number;
      /** When present, this is a supported exact stack size, not a capacity envelope. */
      buildings?: number;
      /** Explicit cost for estimated geometry when no validated repeat is available. */
      penalty?: number;
    }[];
  }[];
}
export interface SplitWeights {
  extraBuilding: number;
  placement: number;
  connection: number;
  belt: number;
  branch: number;
  boundary: number;
  exclusiveOutput: number;
  exclusiveInput: number;
  mutual: number;
  area: number;
}
export const defaultSplitWeights: SplitWeights = {
  extraBuilding: 30,
  placement: 3,
  connection: 10,
  belt: 2,
  branch: 4,
  boundary: 2,
  exclusiveOutput: 4,
  exclusiveInput: 4,
  mutual: 2,
  area: 0.001,
};
export interface SplitOptions {
  beltCapacity?: number;
  extraSlots?: number;
  maxExtraBuildings?: number;
  timeLimit?: number;
  /** Absolute score tolerance, after removing the constant baseline building cost. */
  absoluteGap?: number;
  weights?: Partial<SplitWeights>;
  seed?: SplitCandidate;
}
export interface SplitPlacement {
  id: string;
  recipe: string;
  workload: number;
  buildings: number;
  layout: SplitProblem['recipes'][number]['layoutOptions'][number];
}
export interface SplitFlow extends Rate {
  producer: string;
  consumer: string;
}
export interface SplitCandidate {
  placements: SplitPlacement[];
  flows: SplitFlow[];
}
const tolerance = 1e-8;
const importId = 'import';
const exportId = 'export';
const rateFor = (rates: Rate[], material: string) =>
  rates.filter((rate) => rate.material === material).reduce((sum, rate) => sum + rate.rate, 0);
const trunks = (material: string, rate: number, beltCapacity: number) =>
  material.startsWith('fluid:') ? 1 : Math.ceil((rate - tolerance) / beltCapacity);

/** Independently score actual positive flows, never solver activation/reward variables. */
export function scoreSplit(
  problem: SplitProblem,
  candidate: SplitCandidate,
  beltCapacity = 60,
  weights: SplitWeights = defaultSplitWeights,
) {
  const internal = candidate.flows.filter(
    (flow) => flow.producer !== importId && flow.consumer !== exportId && flow.rate > tolerance,
  );
  const boundary = candidate.flows.filter(
    (flow) => (flow.producer === importId || flow.consumer === exportId) && flow.rate > tolerance,
  );
  const pairs = [...new Set(internal.map((flow) => `${flow.producer}/${flow.consumer}`))].map(
    (key) => {
      const [producer, consumer] = key.split('/');
      const allOutputs = candidate.flows.every(
        (flow) =>
          flow.rate <= tolerance || flow.producer !== producer || flow.consumer === consumer,
      );
      const allInputs = candidate.flows.every(
        (flow) =>
          flow.rate <= tolerance || flow.consumer !== consumer || flow.producer === producer,
      );
      return { producer, consumer, allOutputs, allInputs, mutual: allOutputs && allInputs };
    },
  );
  const degrees = new Map<string, number>();
  for (const flow of candidate.flows.filter((flow) => flow.rate > tolerance)) {
    if (flow.producer !== importId) {
      const key = `${flow.producer}:out:${flow.material}`;
      degrees.set(key, (degrees.get(key) ?? 0) + 1);
    }
    if (flow.consumer !== exportId) {
      const key = `${flow.consumer}:in:${flow.material}`;
      degrees.set(key, (degrees.get(key) ?? 0) + 1);
    }
  }
  const buildings = candidate.placements.reduce((sum, placement) => sum + placement.buildings, 0);
  const baseline = problem.recipes.reduce((sum, recipe) => sum + Math.ceil(recipe.count - 1e-8), 0);
  const metrics = {
    buildings,
    extraBuildings: buildings - baseline,
    placements: candidate.placements.length,
    connections: internal.length,
    internalBelts: internal
      .filter((flow) => flow.material.startsWith('item:'))
      .reduce((sum, flow) => sum + trunks(flow.material, flow.rate, beltCapacity), 0),
    internalPipes: internal.filter((flow) => flow.material.startsWith('fluid:')).length,
    boundaryConnections: boundary.length,
    boundaryTrunks: boundary.reduce(
      (sum, flow) => sum + trunks(flow.material, flow.rate, beltCapacity),
      0,
    ),
    branches: [...degrees.values()].reduce((sum, degree) => sum + Math.max(0, degree - 1), 0),
    exclusiveOutputs: pairs.filter((pair) => pair.allOutputs).length,
    exclusiveInputs: pairs.filter((pair) => pair.allInputs).length,
    mutualPairs: pairs.filter((pair) => pair.mutual).length,
    area: candidate.placements.reduce(
      (sum, placement) => sum + placement.layout.size.width * placement.layout.size.height,
      0,
    ),
    estimatedPenalty: candidate.placements.reduce(
      (sum, placement) => sum + (placement.layout.penalty ?? 0),
      0,
    ),
  };
  const components = {
    buildings: weights.extraBuilding * metrics.extraBuildings,
    placements: weights.placement * metrics.placements,
    connections: weights.connection * metrics.connections,
    trunks: weights.belt * (metrics.internalBelts + metrics.internalPipes + metrics.boundaryTrunks),
    boundary: weights.boundary * metrics.boundaryConnections,
    branches: weights.branch * metrics.branches,
    exclusivity:
      -weights.exclusiveOutput * metrics.exclusiveOutputs -
      weights.exclusiveInput * metrics.exclusiveInputs -
      weights.mutual * metrics.mutualPairs,
    area: weights.area * metrics.area,
    estimated: metrics.estimatedPenalty,
  };
  return {
    score: Object.values(components).reduce((a, b) => a + b, 0),
    metrics,
    components,
    pairs,
  };
}

/** Reject invalid input before constructing solver bounds. Summary footprints are capacity
 * envelopes, not validated kernel entities or permission to rotate a layout. */
function validateProblem(problem: SplitProblem) {
  if (!problem.recipes.length) throw new Error('At least one recipe is required');
  if (new Set(problem.recipes.map((recipe) => recipe.recipe)).size !== problem.recipes.length)
    throw new Error('Recipe names must be unique');
  for (const recipe of problem.recipes) {
    if (!Number.isFinite(recipe.count) || recipe.count <= 0 || !recipe.layoutOptions.length)
      throw new Error(`Invalid workload or missing layouts: ${recipe.recipe}`);
    for (const layout of recipe.layoutOptions)
      if (
        !Number.isInteger(layout.capacity) ||
        layout.capacity <= 0 ||
        !Number.isFinite(layout.size.width) ||
        !Number.isFinite(layout.size.height) ||
        layout.size.width <= 0 ||
        layout.size.height <= 0 ||
        (layout.buildings !== undefined &&
          (!Number.isInteger(layout.buildings) ||
            layout.buildings <= 0 ||
            layout.buildings > layout.capacity)) ||
        (layout.penalty !== undefined && (!Number.isFinite(layout.penalty) || layout.penalty < 0))
      )
        throw new Error(`Invalid layout: ${recipe.recipe}`);
  }
  const rates = [
    ...problem.inputs,
    ...problem.outputs,
    ...problem.recipes.flatMap((recipe) => [...recipe.inputs, ...recipe.outputs]),
  ];
  for (const rate of rates)
    if (!/^(item|fluid):/.test(rate.material) || !Number.isFinite(rate.rate) || rate.rate <= 0)
      throw new Error(`Invalid rate: ${rate.material}`);
  for (const material of new Set(rates.map((rate) => rate.material))) {
    const supply =
      rateFor(problem.inputs, material) +
      problem.recipes.reduce((sum, recipe) => sum + rateFor(recipe.outputs, material), 0);
    const demand =
      rateFor(problem.outputs, material) +
      problem.recipes.reduce((sum, recipe) => sum + rateFor(recipe.inputs, material), 0);
    if (Math.abs(supply - demand) > tolerance * Math.max(1, supply, demand))
      throw new Error(`Unbalanced material: ${material}`);
  }
}

/** Joint continuous workloads + discrete stack capacity, support and belt count.
 * Slots bound topology size; no independently enumerated workload partitions are used. */
export function solveSplits(highs: Highs, problem: SplitProblem, options: SplitOptions = {}) {
  validateProblem(problem);
  const beltCapacity = options.beltCapacity ?? 60;
  const extraSlots = options.extraSlots ?? 0;
  const maxExtra = options.maxExtraBuildings ?? 6;
  const timeLimit = options.timeLimit ?? 5;
  const absoluteGap = options.absoluteGap ?? 0.01;
  const weights = { ...defaultSplitWeights, ...options.weights };
  if (
    !Number.isFinite(beltCapacity) ||
    beltCapacity <= 0 ||
    !Number.isInteger(extraSlots) ||
    extraSlots < 0 ||
    !Number.isInteger(maxExtra) ||
    maxExtra < 0 ||
    !Number.isFinite(timeLimit) ||
    timeLimit <= 0 ||
    !Number.isFinite(absoluteGap) ||
    absoluteGap < 0 ||
    Object.values(weights).some((weight) => !Number.isFinite(weight) || weight < 0)
  )
    throw new Error('Invalid split options');
  const costs = new Map<string, number>();
  const bounds: string[] = [];
  const integers: string[] = [];
  const binaries: string[] = [];
  const rows: string[] = [];
  let nextVariable = 0;
  const variable = (cost = 0, upper?: number, integer = false, binary = false) => {
    const name = `v${nextVariable++}`;
    costs.set(name, cost);
    if (upper !== undefined) bounds.push(`0 <= ${name} <= ${upper}`);
    if (binary) binaries.push(name);
    else if (integer) integers.push(name);
    return name;
  };
  type Term = [number, string];
  const expression = (terms: Term[]) =>
    terms
      .filter(([coefficient]) => coefficient !== 0)
      .map(
        ([coefficient, name]) => `${coefficient < 0 ? '-' : '+'} ${Math.abs(coefficient)} ${name}`,
      )
      .join(' ') || `0 ${[...costs.keys()][0]}`;
  const row = (terms: Term[], relation: '=' | '<=' | '>=', rhs: number) =>
    rows.push(`r${rows.length}: ${expression(terms)} ${relation} ${rhs}`);
  const slots = problem.recipes.flatMap((recipe, recipeIndex) => {
    const maximum = Math.max(...recipe.layoutOptions.map((layout) => layout.capacity));
    // Equal/dominated footprint envelopes never improve this abstract model.
    const layouts = recipe.layoutOptions.filter(
      (layout, index, all) =>
        !all.some(
          (other, otherIndex) =>
            ((layout.buildings === undefined && other.buildings === undefined) ||
              layout.buildings === other.buildings) &&
            (other.penalty ?? 0) <= (layout.penalty ?? 0) &&
            other.capacity >= layout.capacity &&
            other.size.width * other.size.height <= layout.size.width * layout.size.height &&
            (other.capacity > layout.capacity ||
              other.size.width * other.size.height < layout.size.width * layout.size.height ||
              otherIndex < index),
        ),
    );
    const recipeSlots = Array.from(
      { length: Math.ceil(recipe.count / maximum) + extraSlots },
      (_, index) => {
        const active = variable(weights.placement, undefined, false, true);
        const work = variable(0, Math.min(recipe.count, maximum));
        const buildings = variable(weights.extraBuilding, maximum, true);
        const choices = layouts.map((layout) => ({
          layout,
          choice: variable(
            layout.size.width * layout.size.height * weights.area + (layout.penalty ?? 0),
            undefined,
            false,
            true,
          ),
        }));
        row(
          [
            [1, work],
            [-1, buildings],
          ],
          '<=',
          0,
        );
        row(
          [
            [1, buildings],
            ...choices.map(({ choice, layout }): Term => [-layout.capacity, choice]),
          ],
          '<=',
          0,
        );
        row(
          [
            [1, active],
            [-1, buildings],
          ],
          '<=',
          0,
        );
        row(
          [
            [1, work],
            [-Math.min(1e-4, recipe.count * 1e-4), active],
          ],
          '>=',
          0,
        );
        row([...choices.map(({ choice }): Term => [1, choice]), [-1, active]], '=', 0);
        if (layouts.every((layout) => layout.buildings !== undefined))
          row(
            [
              [1, buildings],
              ...choices.map(({ choice, layout }): Term => [-layout.buildings!, choice]),
            ],
            '=',
            0,
          );
        return { id: `r${recipeIndex}s${index}`, recipe, active, work, buildings, choices };
      },
    );
    row(
      recipeSlots.map((slot): Term => [1, slot.work]),
      '=',
      recipe.count,
    );
    // Identical slots can always be relabelled in descending workload order.
    for (let i = 1; i < recipeSlots.length; i++)
      row(
        [
          [1, recipeSlots[i].work],
          [-1, recipeSlots[i - 1].work],
        ],
        '<=',
        0,
      );
    return recipeSlots;
  });
  const baseline = problem.recipes.reduce((sum, recipe) => sum + Math.ceil(recipe.count - 1e-8), 0);
  row(
    slots.map((slot): Term => [1, slot.buildings]),
    '<=',
    baseline + maxExtra,
  );
  const flows: (SplitFlow & { flow: string; active: string; trunk: string })[] = [];
  const materials = [
    ...new Set(
      problem.recipes.flatMap((recipe) =>
        [...recipe.inputs, ...recipe.outputs].map((rate) => rate.material),
      ),
    ),
  ];
  for (const material of materials) {
    const producers = slots.filter((slot) => rateFor(slot.recipe.outputs, material) > 0);
    const consumers = slots.filter((slot) => rateFor(slot.recipe.inputs, material) > 0);
    const addFlow = (producer: string, consumer: string, upper: number) => {
      const isBoundary = producer === importId || consumer === exportId;
      const active = variable(
        isBoundary ? weights.boundary : weights.connection,
        undefined,
        false,
        true,
      );
      const flow = variable(0, upper);
      const trunk = material.startsWith('fluid:')
        ? active
        : variable(weights.belt, Math.ceil(upper / beltCapacity), true);
      if (material.startsWith('fluid:')) costs.set(active, costs.get(active)! + weights.belt);
      else {
        row(
          [
            [1, flow],
            [-beltCapacity, trunk],
          ],
          '<=',
          0,
        );
        row(
          [
            [1, trunk],
            [-Math.ceil(upper / beltCapacity), active],
          ],
          '<=',
          0,
        );
      }
      row(
        [
          [1, flow],
          [-upper, active],
        ],
        '<=',
        0,
      );
      row(
        [
          [1, flow],
          [-Math.min(1e-4, upper * 1e-4), active],
        ],
        '>=',
        0,
      );
      for (const id of [producer, consumer]) {
        const slot = slots.find((slot) => slot.id === id);
        if (slot)
          row(
            [
              [1, active],
              [-1, slot.active],
            ],
            '<=',
            0,
          );
      }
      flows.push({ producer, consumer, material, rate: 0, flow, active, trunk });
    };
    for (const producer of producers) {
      for (const consumer of consumers) {
        if (producer.id === consumer.id) continue;
        addFlow(
          producer.id,
          consumer.id,
          Math.min(
            rateFor(producer.recipe.outputs, material),
            rateFor(consumer.recipe.inputs, material),
          ),
        );
      }
      if (rateFor(problem.outputs, material) > 0)
        addFlow(
          producer.id,
          exportId,
          Math.min(rateFor(problem.outputs, material), rateFor(producer.recipe.outputs, material)),
        );
    }
    if (rateFor(problem.inputs, material) > 0)
      for (const consumer of consumers)
        addFlow(
          importId,
          consumer.id,
          Math.min(rateFor(problem.inputs, material), rateFor(consumer.recipe.inputs, material)),
        );
    for (const [side, selected] of [
      ['out', producers],
      ['in', consumers],
    ] as const) {
      for (const slot of selected) {
        const edges = flows.filter(
          (flow) =>
            flow.material === material &&
            (side === 'out' ? flow.producer : flow.consumer) === slot.id,
        );
        const perMachine =
          rateFor(side === 'out' ? slot.recipe.outputs : slot.recipe.inputs, material) /
          slot.recipe.count;
        row([...edges.map((flow): Term => [1, flow.flow]), [-perMachine, slot.work]], '=', 0);
        // Each positive stack interface has at least one edge: degree - 1 is linear here.
        costs.set(slot.active, costs.get(slot.active)! - weights.branch);
        for (const edge of edges) costs.set(edge.active, costs.get(edge.active)! + weights.branch);
      }
    }
    for (const [id, rates] of [
      [importId, problem.inputs],
      [exportId, problem.outputs],
    ] as const) {
      const rate = rateFor(rates, material);
      if (rate > 0)
        row(
          flows
            .filter(
              (flow) =>
                flow.material === material &&
                (id === importId ? flow.producer : flow.consumer) === id,
            )
            .map((flow): Term => [1, flow.flow]),
          '=',
          rate,
        );
    }
  }
  const rewards: {
    producer: string;
    consumer: string;
    out: string;
    input: string;
    mutual: string;
  }[] = [];
  for (const producer of slots)
    for (const consumer of slots) {
      const edges = flows.filter(
        (flow) => flow.producer === producer.id && flow.consumer === consumer.id,
      );
      if (!edges.length) continue;
      const exclusive = (side: 'out' | 'in', reward: number) => {
        const flag = variable(-reward, undefined, false, true);
        row([[1, flag], ...edges.map((edge): Term => [-1, edge.active])], '<=', 0);
        const otherEdges = flows.filter((flow) =>
          side === 'out'
            ? flow.producer === producer.id && flow.consumer !== consumer.id
            : flow.consumer === consumer.id && flow.producer !== producer.id,
        );
        // No tolerance-dependent near match: every other activated flow excludes this reward.
        for (const edge of otherEdges)
          row(
            [
              [1, flag],
              [1, edge.active],
            ],
            '<=',
            1,
          );
        return flag;
      };
      const out = exclusive('out', weights.exclusiveOutput);
      const input = exclusive('in', weights.exclusiveInput);
      const mutual = variable(-weights.mutual, undefined, false, true);
      rewards.push({ producer: producer.id, consumer: consumer.id, out, input, mutual });
      row(
        [
          [1, mutual],
          [-1, out],
        ],
        '<=',
        0,
      );
      row(
        [
          [1, mutual],
          [-1, input],
        ],
        '<=',
        0,
      );
    }
  const lp = [
    'Minimize',
    `cost: ${expression([...costs].map(([name, cost]): Term => [cost, name]))}`,
    'Subject To',
    ...rows,
    'Bounds',
    ...bounds,
    'Generals',
    integers.join(' '),
    'Binaries',
    binaries.join(' '),
    'End',
  ].join('\n');
  return highs.withModel({ format: 'lp', data: lp }, (model) => {
    model.options.set({
      output_flag: false,
      time_limit: timeLimit,
      mip_rel_gap: 0,
      mip_abs_gap: absoluteGap,
      random_seed: 0,
    });
    if (options.seed) {
      const values = new Map([...costs.keys()].map((name) => [name, 0]));
      const ids = new Map<string, string>([
        [importId, importId],
        [exportId, exportId],
      ]);
      let valid = true;
      for (const recipe of problem.recipes) {
        const pieces = options.seed.placements
          .filter((piece) => piece.recipe === recipe.recipe)
          .toSorted((a, b) => b.workload - a.workload);
        const available = slots.filter((slot) => slot.recipe === recipe);
        if (pieces.length > available.length) {
          valid = false;
          break;
        }
        for (let i = 0; i < pieces.length; i++) {
          const piece = pieces[i];
          const slot = available[i];
          const selected = slot.choices.find(
            ({ layout }) =>
              (layout.buildings === undefined
                ? layout.capacity >= piece.buildings
                : layout.buildings === piece.buildings) &&
              layout.size.width === piece.layout.size.width &&
              layout.size.height === piece.layout.size.height,
          );
          if (!selected) {
            valid = false;
            break;
          }
          ids.set(piece.id, slot.id);
          values.set(slot.active, 1);
          values.set(slot.work, piece.workload);
          values.set(slot.buildings, piece.buildings);
          values.set(selected.choice, 1);
        }
      }
      for (const flow of options.seed.flows) {
        const edge = flows.find(
          (edge) =>
            edge.producer === ids.get(flow.producer) &&
            edge.consumer === ids.get(flow.consumer) &&
            edge.material === flow.material,
        );
        if (!edge) {
          valid = false;
          break;
        }
        values.set(edge.flow, flow.rate);
        values.set(edge.active, 1);
        values.set(
          edge.trunk,
          flow.material.startsWith('fluid:') ? 1 : trunks(flow.material, flow.rate, beltCapacity),
        );
      }
      for (const reward of rewards) {
        const used = flows.filter((flow) => values.get(flow.active)! > 0.5);
        const connected = used.some(
          (flow) => flow.producer === reward.producer && flow.consumer === reward.consumer,
        );
        const out =
          connected &&
          used.every(
            (flow) => flow.producer !== reward.producer || flow.consumer === reward.consumer,
          );
        const input =
          connected &&
          used.every(
            (flow) => flow.consumer !== reward.consumer || flow.producer === reward.producer,
          );
        values.set(reward.out, Number(out));
        values.set(reward.input, Number(input));
        values.set(reward.mutual, Number(out && input));
      }
      if (valid) {
        const colValue = new Float64Array(nextVariable);
        for (const [name, value] of values) colValue[model.getColByName(name)] = value;
        model.setSolution({ colValue });
      }
    }
    const start = performance.now();
    model.run();
    const elapsedMs = performance.now() - start;
    const diagnostics = {
      status:
        Object.entries(highs.constants.modelStatus).find(
          ([, code]) => code === model.getModelStatus(),
        )?.[0] ?? 'unknown',
      elapsedMs,
      variables: nextVariable,
      constraints: rows.length,
      nodes: Number(model.info.get('mip_node_count')),
      solverGap: model.info.get('mip_gap'),
      lowerBound: Number(model.info.get('mip_dual_bound')) - weights.extraBuilding * baseline,
    };
    if (Number(model.info.get('primal_solution_status')) !== 2)
      return { diagnostics, candidate: undefined, scored: undefined };
    const solution = model.getSolution().colValue;
    const value = (name: string) => solution[model.getColByName(name)];
    const candidate: SplitCandidate = {
      placements: slots
        .filter((slot) => value(slot.active) > 0.5)
        .map((slot) => ({
          id: slot.id,
          recipe: slot.recipe.recipe,
          workload: value(slot.work),
          buildings: Math.round(value(slot.buildings)),
          layout: slot.choices.find(({ choice }) => value(choice) > 0.5)!.layout,
        })),
      flows: flows
        .map((flow) => ({
          producer: flow.producer,
          consumer: flow.consumer,
          material: flow.material,
          rate: value(flow.flow),
        }))
        .filter((flow) => flow.rate > tolerance),
    };
    const scored = scoreSplit(problem, candidate, beltCapacity, weights);
    const solverScore = model.getObjectiveValue() - weights.extraBuilding * baseline;
    if (Math.abs(scored.score - solverScore) > 1e-4)
      throw new Error(`Score mismatch: ${scored.score} vs ${solverScore}`);
    return {
      diagnostics: {
        ...diagnostics,
        scoreGap:
          Math.max(0, scored.score - diagnostics.lowerBound) / Math.max(1, Math.abs(scored.score)),
      },
      candidate,
      scored,
    };
  });
}
