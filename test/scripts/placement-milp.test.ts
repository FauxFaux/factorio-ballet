import loadHighs from 'highs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  defaultSplitWeights,
  scoreSplit,
  solveSplits,
  type SplitCandidate,
  type SplitProblem,
} from '../../scripts/placement-milp.ts';
import { processingUnitProblem } from '../../scripts/placement-milp-example.ts';
import { fixedSplitBaseline } from '../../scripts/placement-split-baselines.ts';

let highs: Awaited<ReturnType<typeof loadHighs>>;
beforeAll(async () => {
  highs = await loadHighs();
});
const layout = { size: { width: 3, height: 3 }, capacity: 3 };

function assertConservation(problem: SplitProblem, candidate: SplitCandidate) {
  for (const recipe of problem.recipes) {
    const placements = candidate.placements.filter(
      (placement) => placement.recipe === recipe.recipe,
    );
    expect(placements.reduce((sum, placement) => sum + placement.workload, 0)).toBeCloseTo(
      recipe.count,
      7,
    );
    for (const placement of placements) {
      expect(Number.isInteger(placement.buildings)).toBe(true);
      expect(placement.workload).toBeGreaterThan(0);
      expect(placement.workload).toBeLessThanOrEqual(placement.buildings + 1e-6);
      expect(placement.buildings).toBeLessThanOrEqual(placement.layout.capacity);
      for (const side of ['inputs', 'outputs'] as const) {
        for (const rate of recipe[side]) {
          const actual = candidate.flows
            .filter(
              (flow) =>
                flow.material === rate.material &&
                (side === 'inputs' ? flow.consumer : flow.producer) === placement.id,
            )
            .reduce((sum, flow) => sum + flow.rate, 0);
          expect(actual).toBeCloseTo((rate.rate * placement.workload) / recipe.count, 6);
        }
      }
    }
  }
  for (const [side, id] of [
    ['inputs', 'import'],
    ['outputs', 'export'],
  ] as const)
    for (const rate of problem[side]) {
      const actual = candidate.flows
        .filter(
          (flow) =>
            flow.material === rate.material &&
            (id === 'import' ? flow.producer : flow.consumer) === id,
        )
        .reduce((sum, flow) => sum + flow.rate, 0);
      expect(actual).toBeCloseTo(rate.rate, 6);
    }
}

describe('joint placement MILP experiment', () => {
  it('finds coordinated fractional splits with conserved rates and no extra buildings', () => {
    const result = solveSplits(highs, processingUnitProblem, {
      maxExtraBuildings: 0,
      timeLimit: 3,
    });
    expect(result.candidate).toBeDefined();
    assertConservation(processingUnitProblem, result.candidate!);
    expect(result.scored!.metrics).toMatchObject({
      buildings: 75,
      placements: 9,
      connections: 10,
      exclusiveOutputs: 4,
      internalBelts: 15,
    });
    expect(result.scored!.score).toBeLessThan(
      scoreSplit(processingUnitProblem, fixedSplitBaseline(processingUnitProblem, true)).score,
    );
    expect(result.diagnostics.status).toBe('optimal');
  });

  it('trades an extra building for exclusive pairs when its penalty is outweighed', () => {
    const problem: SplitProblem = {
      inputs: [{ material: 'fluid:feed', rate: 21 }],
      outputs: [{ material: 'item:final', rate: 2 }],
      recipes: [
        {
          recipe: 'producer',
          count: 2.1,
          layoutOptions: [layout],
          inputs: [{ material: 'fluid:feed', rate: 21 }],
          outputs: [{ material: 'item:middle', rate: 21 }],
        },
        {
          recipe: 'consumer',
          count: 2,
          layoutOptions: [{ ...layout, capacity: 1 }],
          inputs: [{ material: 'item:middle', rate: 21 }],
          outputs: [{ material: 'item:final', rate: 2 }],
        },
      ],
    };
    const strict = solveSplits(highs, problem, { extraSlots: 1, maxExtraBuildings: 0 });
    const soft = solveSplits(highs, problem, {
      extraSlots: 1,
      maxExtraBuildings: 1,
      weights: { extraBuilding: 1, exclusiveOutput: 20, mutual: 5 },
    });
    expect(strict.scored!.metrics.extraBuildings).toBe(0);
    expect(soft.scored!.metrics).toMatchObject({
      extraBuildings: 1,
      exclusiveOutputs: 2,
      exclusiveInputs: 2,
      mutualPairs: 2,
    });
    assertConservation(problem, soft.candidate!);
  });

  it('preserves gross cyclic flows instead of netting them away', () => {
    const problem: SplitProblem = {
      inputs: [],
      outputs: [],
      recipes: [
        {
          recipe: 'a',
          count: 1,
          layoutOptions: [layout],
          inputs: [{ material: 'item:y', rate: 1 }],
          outputs: [{ material: 'item:x', rate: 1 }],
        },
        {
          recipe: 'b',
          count: 1,
          layoutOptions: [layout],
          inputs: [{ material: 'item:x', rate: 1 }],
          outputs: [{ material: 'item:y', rate: 1 }],
        },
      ],
    };
    const result = solveSplits(highs, problem);
    assertConservation(problem, result.candidate!);
    expect(result.scored!.metrics).toMatchObject({ connections: 2, mutualPairs: 2 });
  });

  it('returns no candidate when gross self-supply needs unavailable topology', () => {
    const problem: SplitProblem = {
      inputs: [],
      outputs: [],
      recipes: [
        {
          recipe: 'return',
          count: 1,
          layoutOptions: [{ ...layout, capacity: 1 }],
          inputs: [{ material: 'item:x', rate: 1 }],
          outputs: [{ material: 'item:x', rate: 1 }],
        },
      ],
    };
    const result = solveSplits(highs, problem);
    expect(result.diagnostics.status).toBe('infeasible');
    expect(result.candidate).toBeUndefined();
  });

  it('rejects unbalanced rates and invalid belt capacity before solving', () => {
    expect(() => solveSplits(highs, { ...processingUnitProblem, inputs: [] })).toThrow(
      'Unbalanced material',
    );
    expect(() => solveSplits(highs, processingUnitProblem, { beltCapacity: 0 })).toThrow(
      'Invalid split options',
    );
  });

  it('rewards a multi-material exclusive pair once and charges every material belt', () => {
    const problem: SplitProblem = { inputs: [], outputs: [], recipes: [] };
    const candidate: SplitCandidate = {
      placements: [],
      flows: [
        { producer: 'a', consumer: 'b', material: 'item:x', rate: 60 },
        { producer: 'a', consumer: 'b', material: 'item:y', rate: 60.0001 },
      ],
    };
    const score = scoreSplit(problem, candidate);
    expect(score.metrics).toMatchObject({
      internalBelts: 3,
      exclusiveOutputs: 1,
      exclusiveInputs: 1,
      mutualPairs: 1,
    });
    expect(score.components.exclusivity).toBe(
      -defaultSplitWeights.exclusiveOutput -
        defaultSplitWeights.exclusiveInput -
        defaultSplitWeights.mutual,
    );
  });

  it('counts imports and byproduct exports when determining whole-pair exclusivity', () => {
    const candidate: SplitCandidate = {
      placements: [],
      flows: [
        { producer: 'a', consumer: 'b', material: 'item:x', rate: 10 },
        { producer: 'a', consumer: 'export', material: 'item:byproduct', rate: 1 },
        { producer: 'import', consumer: 'b', material: 'fluid:feed', rate: 1 },
      ],
    };
    expect(scoreSplit({ inputs: [], outputs: [], recipes: [] }, candidate).metrics).toMatchObject({
      exclusiveOutputs: 0,
      exclusiveInputs: 0,
      mutualPairs: 0,
      boundaryTrunks: 2,
    });
  });
});
