import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assemblerProblem } from '../../../src/compute/kernel-problems.ts';
import { entityPositionStatuses } from '../../../src/compute/design-validation/geometry.ts';
import { validateTileDesign } from '../../../src/compute/design-validation/validate.ts';
import { solveHighTileDesign } from '../../../src/compute/tile-design/high/solve.ts';
import { normalizeTileDesignInput } from '../../../src/compute/tile-design/problem.ts';
import { solveTileDesignWithMode } from '../../../src/compute/tile-design/solver.ts';
import { solveKernelTileDesign } from '../../../src/compute/tile-design/kernel-result.ts';
import type { TileDesignSearchResult } from '../../../src/compute/tile-design/search.ts';
import type { FluidAccess, TileDesignInput } from '../../../src/compute/tile-design/types.ts';
import { modulesForTile } from '../../../src/compute/modules.ts';

function problem(ins = [2, 2, 2, 2, 2, 2], outs = [2], height = 3): TileDesignInput {
  const result = normalizeTileDesignInput(
    assemblerProblem({ solidInputs: ins, solidOutputs: outs, size: { width: 3, height } }),
    {
      transport: {
        beltLaneCapacity: 15,
        undergroundBeltReach: 8,
        undergroundPipeReach: 10,
        inserters: [
          { id: 'ordinary', reach: 1, capacity: 8 },
          { id: 'long', reach: 2, capacity: 4 },
        ],
        fluidThroughput: 'unlimited',
      },
      envelope: {
        maxWidth: 12,
        maxPitch: 14,
        maxStates: 10_000,
        primitives: ['surface', 'underground', 'branch'],
      },
    },
  );
  if (!result.success) throw new Error(result.message);
  result.input.machines[0].orientations = [{ rotation: 'north', mirrored: false }];
  return result.input;
}
function found(result: TileDesignSearchResult) {
  expect(result.status, JSON.stringify(result)).toBe('found');
  if (result.status !== 'found') throw new Error(result.reason);
  expect(result.validation).toMatchObject({ valid: true, issues: [] });
  return result;
}
function fluid(
  input: TileDesignInput,
  side: 'west' | 'east',
  resource: `fluid:${string}`,
  flowSide: 'inputs' | 'outputs' = 'inputs',
  row = 1,
) {
  const machine = input.machines[0];
  const access: FluidAccess = {
    resource,
    boxIndex: machine.inputs.fluids.length + machine.outputs.fluids.length,
    positions: [
      {
        direction: side,
        position: { x: side === 'west' ? -1 : 1, y: row - (machine.size.height - 1) / 2 },
      },
    ],
  };
  machine[flowSide].fluids.push(access);
  input.boundary[flowSide].fluids.push(resource);
}

describe('solveHighTileDesign', () => {
  it.each(['single', 'pair'] as const)(
    'stacks real two-by-two corner-port geometry with the %s pattern',
    (pattern) => {
      const result = solveKernelTileDesign(
        assemblerProblem({
          solidInputs: [16.8, 14, 2.8],
          solidOutputs: [30.8],
          fluidInputs: [28],
          size: { width: 2, height: 2 },
          fluidBoxes: [
            {
              productionType: 'input',
              connections: [
                { position: { x: 0.5, y: -0.5 }, direction: 'north', flowDirection: 'input' },
              ],
            },
          ],
        }),
        { beltItemsPerSecond: 75, inserterItemsPerSecond: 37.5, longInserterItemsPerSecond: 18.75 },
        {
          mode: 'high',
          pattern,
          repeatCount: pattern === 'single' ? 2 : 1,
          undergroundBeltReach: 22,
          moduleHeight: 100,
        },
      );
      if (!('status' in result)) throw new Error(result.message);
      const tile = found(result);
      const machines = tile.candidate.column.entities.filter(
        (entity) => entity.kind === 'assembler',
      );
      expect(machines).toHaveLength(pattern === 'single' ? 1 : 2);
      expect(
        machines.every((machine) => machine.size.width === 2 && machine.size.height === 2),
      ).toBe(true);
      expect(tile.validation.supportedCopies * machines.length).toBeGreaterThanOrEqual(2);
      const repeated = [-1, 0, 1].flatMap((copy) =>
        tile.candidate.column.entities.map((entity) => ({
          ...entity,
          position: { ...entity.position, y: entity.position.y + copy * tile.candidate.pitch },
        })),
      );
      expect(entityPositionStatuses(repeated)).toEqual(repeated.map(() => 'valid'));
    },
  );

  it('uses the third middle belt for the 33.3/s inputs and 3.7/s output example', () => {
    const result = solveKernelTileDesign(
      assemblerProblem({ solidInputs: [33.3, 33.3], solidOutputs: [3.7] }),
      { beltItemsPerSecond: 75, inserterItemsPerSecond: 37.5, longInserterItemsPerSecond: 18.8 },
      { mode: 'high', undergroundBeltReach: 22 },
    );
    if (!('status' in result)) throw new Error(result.message);
    const tile = found(result);
    expect(tile.candidate).toMatchObject({ width: 3, pitch: 10 });
    expect(tile.diagnostics.bestScore?.area).toBe(15);
    expect(tile.candidate.column.entities.filter((entity) => entity.kind === 'belt')).toHaveLength(
      0,
    );
    expect(
      tile.candidate.column.entities.filter((entity) => entity.kind === 'underground-belt'),
    ).toHaveLength(6);
    const output = tile.candidate.boundary.find(({ lanes }) =>
      Object.values(lanes ?? {}).includes('item:3'),
    )!;
    expect(output.laneFlows).toEqual({
      left: { side: 'output', rate: 3.7 },
      right: { side: 'output', rate: 3.7 },
    });
    const outputTransfers = tile.candidate.transfers.filter(({ side }) => side === 'output');
    expect(outputTransfers.map(({ beltLane, rate }) => [beltLane, rate])).toEqual([
      ['right', 3.7],
      ['left', 3.7],
    ]);
    const corrupted = structuredClone(tile.candidate);
    corrupted.transfers.find(({ side }) => side === 'output')!.beltLane = 'left';
    const input = problem([33.3, 33.3], [3.7]);
    input.transport.beltLaneCapacity = 37.5;
    input.transport.inserters[0].capacity = 37.5;
    input.machines[0].orientations = [
      { rotation: 'east', mirrored: false },
      { rotation: 'north', mirrored: false },
    ];
    expect(validateTileDesign(input, corrupted).issues.map(({ code }) => code)).toContain(
      'transfer-lane',
    );
  });

  it('removes the empty column in the exported fluid assembler problem', () => {
    const result = solveKernelTileDesign(
      assemblerProblem({
        solidInputs: [16.799999999999997, 14, 2.8],
        solidOutputs: [30.799999999999997],
        fluidInputs: [28],
      }),
      { beltItemsPerSecond: 75, inserterItemsPerSecond: 37.5, longInserterItemsPerSecond: 18.8 },
      { mode: 'high', pattern: 'single', repeatCount: 2, undergroundBeltReach: 22 },
    );
    if (!('status' in result)) throw new Error(result.message);
    const tile = found(result);
    expect(tile.candidate).toMatchObject({ width: 6, pitch: 7 });
    expect(tile.diagnostics.bestScore).toEqual({ area: 42, transportEntities: 25 });
    expect(tile.validation.supportedCopies).toBe(2);
    expect(tile.optimal).toBe(true);
    const entities = tile.candidate.column.entities;
    expect(
      entities
        .filter((entity) => entity.kind === 'inserter')
        .every((entity) => entity.reach === undefined || entity.reach === 1),
    ).toBe(true);
    for (let x = 0; x < tile.candidate.width; x++)
      expect(entities.some((entity) => entity.position.x === x)).toBe(true);
  });

  it.each(['single', 'auto'] as const)(
    'splits the exported output across dedicated belts for three repeats in %s mode',
    (pattern) => {
      const kernel = assemblerProblem({
        solidInputs: [16.799999999999997, 14, 2.8],
        solidOutputs: [30.799999999999997],
        fluidInputs: [28],
      });
      const result = solveKernelTileDesign(
        kernel,
        { beltItemsPerSecond: 75, inserterItemsPerSecond: 37.5, longInserterItemsPerSecond: 18.8 },
        { mode: 'high', pattern, repeatCount: 3, undergroundBeltReach: 22 },
      );
      if (!('status' in result)) throw new Error(result.message);
      const tile = found(result);
      const outputs = tile.candidate.boundary.filter(({ laneFlows }) =>
        Object.values(laneFlows ?? {}).some(({ side }) => side === 'output'),
      );
      expect(outputs.length).toBeGreaterThan(1);
      const copies = Object.values(tile.candidate.machineCopies!)[0];
      expect(
        outputs
          .flatMap(({ laneFlows }) => Object.values(laneFlows!))
          .reduce((sum, { rate }) => sum + rate, 0),
      ).toBeCloseTo(30.8 * copies);
      for (const belt of outputs)
        for (const { rate } of Object.values(belt.laneFlows!))
          expect(rate * 3).toBeLessThanOrEqual(37.5 + 1e-9);
      expect(tile.validation.supportedCopies).toBeGreaterThanOrEqual(3);
      expect(tile.optimal).toBe(true);
      const modules = modulesForTile('test', copies * 3, kernel, tile.candidate, 3);
      expect(modules.reduce((sum, module) => sum + module.outputs['item:4'], 0)).toBeCloseTo(
        30.8 * copies * 3,
      );
    },
  );

  it.each(['single', 'pair'] as const)(
    'fits a compact fluid branch and an adjacent trunk in the %s pattern',
    (pattern) => {
      const input = problem([2, 2, 2, 2], []);
      fluid(input, 'west', 'fluid:water');
      fluid(input, 'east', 'fluid:steam', 'outputs');
      input.envelope.maxWidth = 7;
      const tile = found(solveHighTileDesign(input, { pattern }));
      expect(tile.candidate.width).toBe(7);
      expect(tile.optimal).toBe(true);
      const entities = tile.candidate.column.entities;
      expect(entities.filter((entity) => entity.kind === 'underground-pipe')).toHaveLength(
        pattern === 'single' ? 2 : 4,
      );
      expect(
        entities
          .filter((entity) => entity.kind === 'inserter')
          .every((entity) => entity.reach === undefined || entity.reach === 1),
      ).toBe(true);
      const repeated = [-tile.candidate.pitch, 0, tile.candidate.pitch].flatMap((offset) =>
        entities.map((entity) => ({
          ...entity,
          position: { ...entity.position, y: entity.position.y + offset },
        })),
      );
      expect(entityPositionStatuses(repeated)).toEqual(repeated.map(() => 'valid'));
    },
  );

  it('keeps all three opposite-side inserter sites with an adjacent fluid trunk', () => {
    const input = problem([24], [2]);
    fluid(input, 'east', 'fluid:water');
    input.envelope.maxWidth = 6;
    // An adjacent surface trunk does not require a fluid branch or a pipe tunnel.
    input.envelope.primitives = ['surface', 'underground'];
    const tile = found(solveHighTileDesign(input, { pattern: 'single' }));
    expect(tile.candidate.width).toBe(6);
    expect(
      tile.candidate.column.entities.some((entity) => entity.kind === 'underground-pipe'),
    ).toBe(false);
    const inputs = tile.candidate.transfers.filter(({ side }) => side === 'input');
    const inserterIndices = [...new Set(inputs.map(({ inserterIndex }) => inserterIndex))];
    expect(inserterIndices).toHaveLength(3);
    expect(
      inserterIndices.map((index) =>
        inputs
          .filter(({ inserterIndex }) => inserterIndex === index)
          .reduce((sum, { rate }) => sum + rate, 0),
      ),
    ).toEqual([8, 8, 8]);
  });

  it('uses both middle output lanes in a single when one lane or one inserter is insufficient', () => {
    const input = problem([], [20]);
    input.transport.inserters[0].capacity = 12;
    const result = found(solveHighTileDesign(input, { pattern: 'single' }));
    expect(result.candidate).toMatchObject({ width: 3, pitch: 7 });
    expect(result.candidate.boundary[0].laneFlows).toEqual({
      left: { side: 'output', rate: 10 },
      right: { side: 'output', rate: 10 },
    });
    expect(result.candidate.transfers.map(({ beltLane, rate }) => [beltLane, rate])).toEqual([
      ['right', 10],
      ['left', 10],
    ]);
    expect(result.validation.supportedCopies).toBe(1);
    expect(found(solveHighTileDesign(input, { pattern: 'pair' })).candidate.boundary).toHaveLength(
      2,
    );
    input.machines[0].outputs.items[0].rate = 31;
    input.boundary.outputs.items[0].rate = 31;
    expect(found(solveHighTileDesign(input)).candidate.boundary.length).toBeGreaterThan(1);
  });

  it('counts each end output lane separately across paired repeats', () => {
    const input = problem([], [8]);
    input.repeat = { count: 1, moduleHeight: 100 };
    const result = found(solveHighTileDesign(input, { pattern: 'pair' }));
    expect(result.candidate.width).toBe(3);
    expect(result.candidate.boundary[0].laneFlows).toEqual({
      left: { side: 'output', rate: 8 },
      right: { side: 'output', rate: 8 },
    });
    expect(result.validation.supportedCopies).toBe(1);
    input.transport.beltLaneCapacity = 16;
    input.repeat.count = 2;
    expect(found(solveHighTileDesign(input, { pattern: 'pair' })).validation.supportedCopies).toBe(
      2,
    );
    input.repeat.count = 3;
    const split = found(solveHighTileDesign(input, { pattern: 'pair' }));
    expect(split.candidate.boundary).toHaveLength(2);
    expect(split.validation.supportedCopies).toBeGreaterThanOrEqual(3);
  });
  it.each([
    { pattern: 'single' as const, pitch: 7, copies: 1 },
    { pattern: 'pair' as const, pitch: 10, copies: 2 },
  ])(
    'reproduces the seven independent belt profiles of the $pattern HIGH fixture',
    ({ pattern, pitch, copies }) => {
      const input = problem();
      const result = found(solveHighTileDesign(input, { pattern }));
      expect(result.candidate).toMatchObject({ width: 9, pitch });
      expect(Object.values(result.candidate.machineCopies!)).toEqual([copies]);
      const fixture = JSON.parse(
        readFileSync(
          new URL(
            `../../../docs/blueprints/ass-13l-pitch-${pattern === 'single' ? 7 : 5}.json`,
            import.meta.url,
          ),
          'utf8',
        ),
      );
      const belts = fixture.blueprint.entities.filter(
        (entity: { name: string }) =>
          entity.name.endsWith('transport-belt') || entity.name.endsWith('underground-belt'),
      ) as { name: string; position: { x: number; y: number }; type?: string }[];
      const minX = Math.min(...belts.map(({ position }) => position.x));
      const minY = Math.min(...belts.map(({ position }) => position.y));
      const expected = belts
        .filter(({ position }) => position.y - minY < pitch)
        .map((entity) => [
          entity.position.x - minX,
          entity.position.y - minY,
          entity.type ?? 'surface',
        ])
        .sort();
      const actual = result.candidate.column.entities
        .flatMap((entity) =>
          entity.kind === 'belt' || entity.kind === 'underground-belt'
            ? [
                [
                  entity.position.x,
                  entity.position.y,
                  entity.kind === 'underground-belt' ? entity.end : 'surface',
                ],
              ]
            : [],
        )
        .sort();
      expect(actual).toEqual(expected);
      const repeated = [-pitch, 0, pitch].flatMap((offset) =>
        result.candidate.column.entities.map((entity) => ({
          ...entity,
          position: { ...entity.position, y: entity.position.y + offset },
        })),
      );
      expect(entityPositionStatuses(repeated)).toEqual(repeated.map(() => 'valid'));
      expect(result.diagnostics.exploredStates).toBeLessThan(1_000);
      expect(result.optimal).toBe(true);
    },
  );

  it.each(['single', 'pair'] as const)(
    'adds isolated west and east fluid trunks to the %s pattern',
    (pattern) => {
      const input = problem();
      fluid(input, 'west', 'fluid:water');
      fluid(input, 'east', 'fluid:steam', 'outputs');
      const result = found(solveHighTileDesign(input, { pattern }));
      expect(result.candidate.width).toBe(11);
      expect(result.candidate.boundary.filter(({ kind }) => kind === 'belt')).toHaveLength(7);
      expect(
        result.candidate.boundary
          .filter(({ kind }) => kind === 'pipe')
          .map(({ resource }) => resource)
          .sort(),
      ).toEqual(['fluid:steam', 'fluid:water']);
      expect(validateTileDesign(input, result.candidate).valid).toBe(true);
      const broken = structuredClone(result.candidate);
      const pipe = broken.column.entities.find((entity) => entity.kind === 'underground-pipe');
      if (pipe?.kind === 'underground-pipe') pipe.direction = 'north';
      expect(validateTileDesign(input, broken).valid).toBe(false);
    },
  );

  it('chooses the dense pair when capacity permits and the single when it does not', () => {
    expect(found(solveHighTileDesign(problem())).candidate.pitch).toBe(10);
    const input = problem([9, 9, 9, 9, 9, 9]);
    input.transport.inserters = [
      { id: 'ordinary', reach: 1, capacity: 8 },
      { id: 'long', reach: 2, capacity: 12 },
    ];
    // Each middle input needs two local sites, available only on the single.
    expect(found(solveHighTileDesign(input)).candidate.pitch).toBe(7);
    expect(solveHighTileDesign(input, { pattern: 'pair' }).status).toBe('envelope-exhausted');
  });

  it('removes unused belts and uses both lanes of one input belt without splitting across belts', () => {
    const input = problem([20], [2]);
    const result = found(solveHighTileDesign(input, { pattern: 'single' }));
    const belts = result.candidate.boundary.filter(({ kind }) => kind === 'belt');
    expect(belts).toHaveLength(2);
    const supply = belts.find(({ lanes }) => Object.values(lanes ?? {}).includes('item:1'))!;
    expect(supply.lanes).toEqual({ left: 'item:1', right: 'item:1' });
    expect(supply.laneFlows).toEqual({
      left: { side: 'input', rate: 10 },
      right: { side: 'input', rate: 10 },
    });
    expect(result.validation.supportedCopies).toBe(1);
    expect(solveHighTileDesign(problem([31], [2])).status).toBe('envelope-exhausted');
  });

  it('checks the single and pair tunnel distances against the selected tier', () => {
    const input = problem();
    input.transport.undergroundBeltReach = 4;
    expect(solveHighTileDesign(input).status).toBe('envelope-exhausted');
    input.transport.undergroundBeltReach = 5;
    expect(found(solveHighTileDesign(input)).candidate.pitch).toBe(7);
    input.transport.undergroundBeltReach = 7;
    expect(solveHighTileDesign(input, { pattern: 'pair' }).status).toBe('envelope-exhausted');
    input.transport.undergroundBeltReach = 8;
    expect(found(solveHighTileDesign(input)).candidate.pitch).toBe(10);
  });

  it('charges belt throughput and physical height for the full repeat unit', () => {
    const input = problem();
    input.repeat = { count: 3, moduleHeight: 30 };
    const result = found(solveHighTileDesign(input, { pattern: 'pair' }));
    expect(result.validation.supportedCopies).toBe(3);
    for (const track of result.candidate.boundary.filter(({ kind }) => kind === 'belt'))
      expect(Object.values(track.laneFlows ?? {}).reduce((sum, flow) => sum + flow.rate, 0)).toBe(
        4,
      );
    input.repeat.count = 4;
    expect(solveHighTileDesign(input, { pattern: 'pair' }).status).toBe('envelope-exhausted');
  });

  it('filters split products and rejects output beyond all available lane capacity', () => {
    const input = problem([], [35, 2]);
    input.transport.inserters[0].capacity = 40;
    const tile = found(solveHighTileDesign(input, { pattern: 'single' }));
    const outputs = tile.candidate.transfers.filter(({ side }) => side === 'output');
    for (const transfer of outputs) {
      expect(tile.candidate.column.entities[transfer.inserterIndex]).toMatchObject({
        kind: 'inserter',
        filter: transfer.resource,
      });
    }
    expect(
      tile.candidate.boundary.filter(({ lanes }) => Object.values(lanes ?? {}).includes('item:1'))
        .length,
    ).toBeGreaterThan(1);
    input.machines[0].outputs.items[0].rate = 200;
    input.boundary.outputs.items[0].rate = 200;
    expect(solveHighTileDesign(input).status).toBe('envelope-exhausted');
  });

  it('checks each assembler demand even when the pair total is correct', () => {
    const input = problem();
    const tile = found(solveHighTileDesign(input, { pattern: 'pair' })).candidate;
    const product = tile.transfers.filter(({ side }) => side === 'output');
    product[0].rate = 3;
    product[1].rate = 1;
    const issues = validateTileDesign(input, tile).issues;
    expect(issues.filter(({ code }) => code === 'machine-rate')).toHaveLength(2);
    const badCopies = structuredClone(tile);
    badCopies.machineCopies![input.machines[0].id] = 1;
    expect(validateTileDesign(input, badCopies).issues.map(({ code }) => code)).toContain(
      'machine-identity',
    );
  });

  it('shares the edge budget between near and far belts and filters multiple products', () => {
    const input = problem([9, 9, 9], [5, 5, 5, 5]);
    input.transport.inserters = [
      { id: 'ordinary', reach: 1, capacity: 5 },
      { id: 'long', reach: 2, capacity: 3 },
    ];
    // Inputs require both end sites, leaving all four outputs on the shared side edges.
    const tile = found(solveHighTileDesign(input, { pattern: 'single' })).candidate;
    expect(
      tile.transfers
        .filter(({ side }) => side === 'output')
        .every(({ inserterIndex, resource }) => {
          const entity = tile.column.entities[inserterIndex];
          return entity.kind === 'inserter' && entity.filter === resource;
        }),
    ).toBe(true);
    fluid(input, 'west', 'fluid:water');
    expect(solveHighTileDesign(input).status).toBe('envelope-exhausted');
  });

  it('generalizes end tunnels and fluid ports to three-by-five machines', () => {
    const input = problem([2, 2, 2, 2, 2, 2], [2], 5);
    fluid(input, 'east', 'fluid:water', 'inputs', 2);
    input.transport.undergroundBeltReach = 12;
    expect(found(solveHighTileDesign(input, { pattern: 'single' })).candidate).toMatchObject({
      pitch: 9,
      width: 10,
    });
    expect(found(solveHighTileDesign(input, { pattern: 'pair' })).candidate).toMatchObject({
      pitch: 14,
      width: 10,
    });
  });

  it('keeps allocation canonical when item, orientation, and inserter rules are reordered', () => {
    const input = problem([2, 4, 3, 2, 1, 2]);
    input.machines[0].orientations.push({ rotation: 'south', mirrored: false });
    const original = solveHighTileDesign(input);
    input.machines[0].inputs.items.reverse();
    input.machines[0].orientations.reverse();
    input.transport.inserters.reverse();
    expect(solveHighTileDesign(input)).toEqual(original);
  });

  it('rotates prototype fluid ports into the HIGH side branches', () => {
    const kernel = assemblerProblem({
      solidInputs: [2, 2, 2, 2, 2, 2],
      solidOutputs: [2],
      fluidInputs: [200],
    });
    const result = solveKernelTileDesign(
      kernel,
      { beltItemsPerSecond: 30, inserterItemsPerSecond: 8, longInserterItemsPerSecond: 4 },
      { mode: 'high', undergroundBeltReach: 8 },
    );
    if (!('status' in result)) throw new Error(result.message);
    const tile = found(result).candidate;
    expect(tile.width).toBe(10);
    expect(tile.boundary.filter(({ kind }) => kind === 'pipe')).toHaveLength(1);
    expect(
      tile.column.entities
        .filter((entity) => entity.kind === 'assembler')
        .every((entity) => entity.direction === 'east' || entity.direction === 'west'),
    ).toBe(true);
  });

  it('reports an honest state budget and retains a valid incumbent', () => {
    const input = problem();
    input.envelope.maxStates = 1;
    expect(solveHighTileDesign(input)).toMatchObject({
      status: 'budget-exhausted',
      diagnostics: { exploredStates: 1 },
    });
    const single = found(solveHighTileDesign(problem(), { pattern: 'single' }));
    input.envelope.maxStates = single.diagnostics.exploredStates + 1;
    const incumbent = found(solveHighTileDesign(input));
    expect(incumbent).toMatchObject({ optimal: false, stopReason: 'budget-exhausted' });
  });

  it('falls back to the existing search for problems outside the HIGH policy', () => {
    const input = problem(Array(8).fill(1), [2]);
    expect(solveHighTileDesign(input).status).toBe('unsupported');
    const wide = problem([2], [2]);
    wide.machines[0].size.width = 5;
    expect(found(solveTileDesignWithMode(wide, 'auto')).diagnostics.scope).not.toContain('high/');
    const invalid = problem();
    invalid.transport.beltLaneCapacity = 0;
    expect(solveTileDesignWithMode(invalid, 'auto').status).toBe('invalid-input');
  });

  it('uses the same kernel adapter and module consumer without changing per-machine rates', () => {
    const kernel = assemblerProblem({ solidInputs: [2, 2, 2, 2, 2, 2], solidOutputs: [2] });
    const result = solveKernelTileDesign(
      kernel,
      { beltItemsPerSecond: 30, inserterItemsPerSecond: 8, longInserterItemsPerSecond: 4 },
      { mode: 'high', pattern: 'pair', undergroundBeltReach: 8 },
    );
    expect('status' in result).toBe(true);
    if (!('status' in result)) throw new Error(result.message);
    const tile = found(result);
    const modules = modulesForTile(
      'test',
      6,
      kernel,
      tile.candidate,
      tile.validation.supportedCopies,
    );
    expect(modules.reduce((sum, module) => sum + module.machineCount, 0)).toBe(6);
    expect(modules.reduce((sum, module) => sum + module.inputs['item:1'], 0)).toBe(12);
  });
});
