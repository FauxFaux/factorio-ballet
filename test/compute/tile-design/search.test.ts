import { describe, expect, it } from 'vitest';
import { assemblerProblem } from '../../../src/compute/kernel-problems.ts';
import { solidAccessOptions } from '../../../src/compute/tile-design/access.ts';
import { normalizeTileDesignInput } from '../../../src/compute/tile-design/problem.ts';
import {
  solveTileDesign,
  type TileDesignSearchResult,
} from '../../../src/compute/tile-design/search.ts';
import { validateTileDesign } from '../../../src/compute/design-validation/validate.ts';
import type { TileDesignInput, TileDesignOptions } from '../../../src/compute/tile-design/types.ts';

const options: TileDesignOptions = {
  transport: {
    beltLaneCapacity: 15,
    undergroundBeltReach: 4,
    undergroundPipeReach: 10,
    inserters: [{ id: 'ordinary', capacity: 3, reach: 1 }],
    fluidThroughput: 'unlimited',
  },
  envelope: { maxWidth: 12, maxPitch: 10, primitives: ['surface'], maxStates: 100_000 },
};
const withLong: TileDesignOptions = {
  ...options,
  transport: {
    ...options.transport,
    inserters: [...options.transport.inserters, { id: 'long', capacity: 2, reach: 2 }],
  },
};
function input(
  ins: number[],
  outs: number[],
  settings = options,
  size = { width: 3, height: 3 },
): TileDesignInput {
  const normalized = normalizeTileDesignInput(
    assemblerProblem({ solidInputs: ins, solidOutputs: outs, size }),
    settings,
  );
  if (!normalized.success) throw new Error(normalized.message);
  return normalized.input;
}
function found(
  result: TileDesignSearchResult,
): Extract<TileDesignSearchResult, { status: 'found' }> {
  expect(result.status, JSON.stringify(result.diagnostics)).toBe('found');
  if (result.status !== 'found') throw new Error(result.reason);
  expect(result.validation).toMatchObject({ valid: true, issues: [] });
  return result;
}

// Exhaustive independent oracle for ordinary inserters and integer rates. Enumerate every split
// of each demand between the two machine faces. Integral capacities guarantee an integral flow.
// Each face has two lanes, one output-accessible lane, and height shared inserter bases.
function exhaustiveOrdinary(
  ins: number[],
  outs: number[],
  height: number,
  capacity: number,
  laneCapacity: number,
): { area: number; transportEntities: number } | undefined {
  const rates = [...ins, ...outs];
  const west: number[] = [];
  let best: { area: number; transportEntities: number } | undefined;
  function inserterCount(split: number[]): number | undefined {
    const inputs = split.slice(0, ins.length);
    const outputs = split.slice(ins.length).filter((rate) => rate > 0);
    const count =
      Math.ceil(inputs.reduce((a, b) => a + b, 0) / capacity) +
      outputs.reduce((sum, rate) => sum + Math.ceil(rate / capacity), 0);
    if (
      outputs.length > 1 ||
      outputs.some((rate) => rate > laneCapacity) ||
      inputs.reduce((sum, rate) => sum + Math.ceil(rate / laneCapacity), 0) + outputs.length > 2 ||
      count > height
    )
      return undefined;
    return count;
  }
  function split(index: number) {
    if (index === rates.length) {
      const westCount = inserterCount(west);
      const eastCount = inserterCount(rates.map((rate, i) => rate - west[i]));
      if (westCount === undefined || eastCount === undefined) return;
      const belts = Number(westCount > 0) + Number(eastCount > 0);
      const score = {
        area: (3 + 2 * belts) * height,
        transportEntities: belts * height + westCount + eastCount,
      };
      if (
        !best ||
        score.area < best.area ||
        (score.area === best.area && score.transportEntities < best.transportEntities)
      )
        best = score;
      return;
    }
    for (let rate = 0; rate <= rates[index]; rate++) {
      west.push(rate);
      split(index + 1);
      west.pop();
    }
  }
  split(0);
  return best;
}

describe('solveTileDesign', () => {
  it('packs an input and output onto separate lanes of one trunk when sites permit', () => {
    const result = found(solveTileDesign(input([1], [2])));
    expect(result).toMatchObject({
      optimal: true,
      stopReason: 'complete',
      validation: { supportedCopies: 7 },
      candidate: { width: 5, pitch: 3 },
    });
    expect(result.candidate.boundary).toHaveLength(1);
    expect(Object.values(result.candidate.boundary[0].lanes!)).toEqual(
      expect.arrayContaining(['item:1', 'item:2']),
    );
  });

  it('allocates three or more inserters from rates rather than a fixed per-item limit', () => {
    const result = found(solveTileDesign(input([11], [2], options, { width: 3, height: 5 })));
    expect(result.candidate.transfers.filter(({ side }) => side === 'input')).toHaveLength(4);
  });

  it('splits one resource across independent lanes to meet repeat capacity', () => {
    const problem = input([8], [2], { ...options, repeatCount: 2 });
    const result = found(solveTileDesign(problem));
    const supplied = result.candidate.boundary
      .flatMap((track) => Object.values(track.laneFlows!))
      .filter(({ side }) => side === 'input');
    expect(supplied.length).toBeGreaterThanOrEqual(2);
    expect(supplied.reduce((sum, { rate }) => sum + rate, 0)).toBeCloseTo(8);
    expect(supplied.every(({ rate }) => rate * 2 <= 15)).toBe(true);
    expect(result.validation.supportedCopies).toBeGreaterThanOrEqual(2);
    expect(validateTileDesign(problem, result.candidate).valid).toBe(true);
  });

  it('shares one input inserter budget between two lane resources', () => {
    const result = found(solveTileDesign(input([1, 2], [], options, { width: 3, height: 1 })));
    expect(result.candidate.column.entities.filter(({ kind }) => kind === 'inserter')).toHaveLength(
      1,
    );
    expect(result.candidate.transfers.map(({ inserterIndex }) => inserterIndex)).toEqual([1, 1]);
    expect(result.candidate.transfers.reduce((sum, { rate }) => sum + rate, 0)).toBe(3);
  });

  it('cannot reuse one site capacity independently for different ingredients', () => {
    const problem = input(
      [2, 2],
      [],
      { ...options, envelope: { ...options.envelope, maxWidth: 5, maxPitch: 1 } },
      { width: 3, height: 1 },
    );
    expect(solveTileDesign(problem).status).toBe('envelope-exhausted');
  });

  it('uses long inserters alongside ordinary inserters and filters multiple products', () => {
    const problem = input([1, 1, 1, 1], [2, 2, 2], withLong);
    const result = found(solveTileDesign(problem));
    expect(
      result.candidate.column.entities.some(
        (entity) => entity.kind === 'inserter' && entity.reach === 2,
      ),
    ).toBe(true);
    for (const transfer of result.candidate.transfers.filter(({ side }) => side === 'output'))
      expect(result.candidate.column.entities[transfer.inserterIndex]).toMatchObject({
        filter: transfer.resource,
      });
  });

  it('supports six ingredients without relying on object order or a legacy layout strategy', () => {
    const problem = input([1, 1, 1, 1, 1, 1], [2], withLong);
    const result = found(solveTileDesign(problem));
    expect(result.diagnostics.validationRejections).toBe(0);
    const reordered = structuredClone(problem);
    reordered.machines[0].inputs.items.reverse();
    reordered.boundary.inputs.items.reverse();
    reordered.transport.inserters.reverse();
    expect(solveTileDesign(reordered)).toEqual(result);
  });

  it('rotates rectangular machines when the envelope requires it', () => {
    const problem = input(
      [1],
      [2],
      { ...options, envelope: { ...options.envelope, maxWidth: 4, maxPitch: 5 } },
      { width: 5, height: 2 },
    );
    const result = found(solveTileDesign(problem));
    expect(result.candidate).toMatchObject({ width: 4, pitch: 5 });
    expect(result.candidate.column.entities.find(({ kind }) => kind === 'assembler')).toMatchObject(
      { direction: 'east', size: { width: 2, height: 5 } },
    );
  });

  it('derives short and long alternative configurations at the same base on all four faces', () => {
    const problem = input([1], [2], withLong, { width: 2, height: 3 });
    const accesses = solidAccessOptions(problem.machines[0], { x: 4, y: 4 }, problem.transport);
    for (const face of ['west', 'east', 'north', 'south']) {
      const short = accesses.find(
        (option) => option.side === 'input' && option.face === face && option.reach === 1,
      )!;
      expect(
        accesses.some(
          (option) =>
            option.side === 'input' &&
            option.face === face &&
            option.reach === 2 &&
            option.base.x === short.base.x &&
            option.base.y === short.base.y,
        ),
      ).toBe(true);
    }
    const narrow = input([1], [2], withLong, { width: 1, height: 3 });
    expect(
      solidAccessOptions(narrow.machines[0], { x: 0, y: 0 }, narrow.transport).some(
        (option) => option.face === 'west' && option.reach === 2 && option.base.x === -1,
      ),
    ).toBe(false);
  });

  it('does not promise both output lanes just by adding inserters on one face', () => {
    const problem = input([], [16], { ...options, envelope: { ...options.envelope, maxWidth: 5 } });
    expect(solveTileDesign(problem).status).toBe('envelope-exhausted');
    const result = found(solveTileDesign(input([], [16])));
    expect(result.candidate.boundary).toHaveLength(2);
  });

  it('retains gross catalyst transfers on separate input and output lanes', () => {
    const problem = input([2], [3]);
    problem.machines[0].outputs.items[0].resource = 'item:1';
    problem.boundary.outputs.items[0].resource = 'item:1';
    const result = found(solveTileDesign(problem));
    expect(result.candidate.transfers.map(({ side, rate }) => [side, rate])).toEqual([
      ['input', 2],
      ['output', 3],
    ]);
    expect(Object.values(result.candidate.boundary[0].lanes!)).toEqual(['item:1', 'item:1']);
  });

  it('honors physical module height and fractional per-lane repeat capacity', () => {
    expect(
      solveTileDesign(input([1], [1], { ...options, repeatCount: 3, moduleHeight: 8 })).status,
    ).toBe('envelope-exhausted');
    const result = found(
      solveTileDesign(
        input([0.3], [], {
          ...options,
          repeatCount: 10,
          transport: { ...options.transport, beltLaneCapacity: 1 },
        }),
      ),
    );
    expect(result.validation.supportedCopies).toBeGreaterThanOrEqual(10);
  });

  it('does not round a full lane up to two required lanes due to floating-point noise', () => {
    const problem = input([0.1 + 0.2], [0.1 + 0.2], {
      ...options,
      transport: { ...options.transport, beltLaneCapacity: 0.3 },
      envelope: { ...options.envelope, maxWidth: 5 },
    });
    expect(found(solveTileDesign(problem)).candidate.boundary).toHaveLength(1);
  });

  it('reports bounded failure separately from an interrupted search and unsupported rules', () => {
    const problem = input([1], [2]);
    expect(
      solveTileDesign({ ...problem, envelope: { ...problem.envelope, maxStates: 1 } }),
    ).toMatchObject({ status: 'budget-exhausted', diagnostics: { exploredStates: 1 } });
    expect(
      solveTileDesign({ ...problem, envelope: { ...problem.envelope, maxWidth: 3 } }).status,
    ).toBe('envelope-exhausted');
    expect(
      solveTileDesign({
        ...problem,
        machines: [
          ...problem.machines,
          {
            ...problem.machines[0],
            id: 'second',
            inputs: { items: [], fluids: [] },
            outputs: { items: [], fluids: [] },
          },
        ],
      }).status,
    ).toBe('unsupported');
    expect(
      solveTileDesign({
        ...problem,
        transport: { ...problem.transport, inserters: [{ id: 'longer', reach: 3, capacity: 3 }] },
      }).status,
    ).toBe('unsupported');
    expect(
      solveTileDesign({ ...problem, envelope: { ...problem.envelope, maxStates: 0 } }).status,
    ).toBe('invalid-input');
  });

  it('returns a validated incumbent when the state budget ends before optimality is proved', () => {
    const problem = input([1], [2]);
    const complete = found(solveTileDesign(problem));
    let partial: TileDesignSearchResult | undefined;
    for (let maxStates = 1; maxStates < complete.diagnostics.exploredStates; maxStates++) {
      const result = solveTileDesign({ ...problem, envelope: { ...problem.envelope, maxStates } });
      if (result.status === 'found') {
        partial = result;
        break;
      }
    }
    expect(partial).toMatchObject({
      status: 'found',
      optimal: false,
      stopReason: 'budget-exhausted',
      validation: { valid: true },
    });
  });

  it('independently checks emitted per-lane supply rates', () => {
    const problem = input([1], [2]);
    const candidate = found(solveTileDesign(problem)).candidate;
    Object.values(candidate.boundary[0].laneFlows!)[0].rate++;
    expect(
      validateTileDesign(problem, candidate).issues.some(({ code }) => code === 'boundary-rate'),
    ).toBe(true);
  });

  it('matches an exhaustive allocator across small capacities, heights, and resource counts', () => {
    for (const height of [1, 2, 3])
      for (const a of [1, 2, 3, 4])
        for (const b of [0, 1, 2])
          for (const c of [1, 2, 3])
            for (const d of [0, 1]) {
              const ins = [a, b].filter(Boolean);
              const outs = [c, d].filter(Boolean);
              const problem = input(
                ins,
                outs,
                {
                  ...options,
                  transport: {
                    ...options.transport,
                    beltLaneCapacity: 2,
                    inserters: [{ id: 'ordinary', reach: 1, capacity: 2 }],
                  },
                  envelope: { ...options.envelope, maxWidth: 7 },
                },
                { width: 3, height },
              );
              problem.machines[0].orientations = [{ rotation: 'north', mirrored: false }];
              const result = solveTileDesign(problem);
              const witness = JSON.stringify({
                ins,
                outs,
                height,
                diagnostics: result.diagnostics,
              });
              expect(result.status, witness).not.toBe('budget-exhausted');
              const expected = exhaustiveOrdinary(ins, outs, height, 2, 2);
              expect(result.status === 'found', witness).toBe(expected !== undefined);
              expect(result.diagnostics.bestScore, witness).toEqual(expected);
              if (result.status === 'found') {
                expect(result.optimal, witness).toBe(true);
                expect(validateTileDesign(problem, result.candidate).valid, witness).toBe(true);
              }
            }
  });
});
