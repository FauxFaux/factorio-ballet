import { describe, expect, it } from 'vitest';
import { generateAssemblerDesign } from '../../../src/compute/assembler-design.ts';
import { assemblerProblem, machineProblem } from '../../../src/compute/kernel-problems.ts';
import { staticData } from '../../../src/data/decode.ts';
import { entityPositionStatuses } from '../../../src/components/design/design-entities.tsx';
import { designBounds } from '../../../src/components/design/design-preview.tsx';
import { designFluidTraces } from '../../../src/components/design/design-fluid-traces.ts';
import { fluidBoxResources } from '../../../src/compute/fluid-box-resources.ts';

const throughput = {
  beltItemsPerSecond: 30,
  inserterItemsPerSecond: 8,
  longInserterItemsPerSecond: 4,
};
const recipeId = 'angels-mono-silicon-seed';
const machine = staticData.machines['angels-casting-machine-3'];
const recipe = staticData.recipes[recipeId];

function problem(output: number | null = 2, solidInputs: number[] = []) {
  const result = machineProblem(
    staticData,
    'casting-machine',
    { fluidInputs: [200, 200], solidInputs, solidOutputs: output === null ? [] : [output] },
    recipeId,
  );
  result.assemblers[0].fluidIngredients = recipe.ingredients;
  return result;
}

describe('adapted casting-machine fluid inputs', () => {
  it('builds a 6x4 tile with a lower port adaptor and a continuous output belt', () => {
    const design = generateAssemblerDesign(problem(), throughput);
    expect(design.columns).toBeDefined();
    const entities = design.columns![0].entities;
    expect(designBounds(entities)).toEqual({ minX: 0, minY: 0, maxX: 6, maxY: 4 });
    expect(entityPositionStatuses(entities)).toEqual(entities.map(() => 'valid'));
    expect(entities).toContainEqual({
      kind: 'assembler',
      position: { x: 1, y: 0 },
      size: { width: 3, height: 3 },
      recipe: recipeId,
      direction: 'north',
    });
    expect(entities.filter(({ kind }) => kind === 'pipe').map(({ position }) => position)).toEqual([
      { x: 0, y: 2 },
      { x: 4, y: 3 },
      { x: 3, y: 3 },
    ]);
    expect(entities.filter(({ kind }) => kind === 'belt')).toEqual(
      [0, 1, 2, 3].map((y) => ({ kind: 'belt', position: { x: 5, y }, direction: 'south' })),
    );
  });

  it('extracts a solid output onto the belt at 13.5 items per second', () => {
    const design = generateAssemblerDesign(problem(13.5), {
      beltItemsPerSecond: 45,
      inserterItemsPerSecond: 15.9,
      longInserterItemsPerSecond: 7.9,
    });
    expect(design.columns).toBeDefined();
    expect(design.columns![0].entities.filter(({ kind }) => kind === 'inserter')).toEqual([
      { kind: 'inserter', position: { x: 4, y: 1 }, direction: 'east' },
    ]);
  });

  it('connects both fluid inputs without adding solid transport when there is no output', () => {
    const design = generateAssemblerDesign(problem(null), {
      beltItemsPerSecond: 45,
      inserterItemsPerSecond: 15.9,
      longInserterItemsPerSecond: 7.9,
    });
    expect(design.columns).toBeDefined();
    const entities = design.columns![0].entities;
    expect(designBounds(entities)).toEqual({ minX: 0, minY: 0, maxX: 5, maxY: 4 });
    expect(entityPositionStatuses(entities)).toEqual(entities.map(() => 'valid'));
    expect(entities.filter(({ kind }) => kind === 'inserter' || kind === 'belt')).toEqual([]);
  });

  it.each([{ inputs: [5] }, { inputs: [5, 5] }])(
    'feeds $inputs solid inputs from a shared belt outside the fluid track',
    ({ inputs }) => {
      const design = generateAssemblerDesign(problem(null, inputs), {
        beltItemsPerSecond: 45,
        inserterItemsPerSecond: 15.9,
        longInserterItemsPerSecond: 7.9,
      });
      expect(design.columns).toBeDefined();
      const entities = design.columns![0].entities;
      expect(entities.filter(({ kind }) => kind === 'inserter')).toEqual([
        { kind: 'inserter', position: { x: 4, y: 1 }, direction: 'west' },
      ]);
      expect(entities.filter(({ kind }) => kind === 'belt')).toEqual(
        [0, 1, 2, 3].map((y) => ({ kind: 'belt', position: { x: 5, y }, direction: 'north' })),
      );
      expect(entityPositionStatuses(entities)).toEqual(entities.map(() => 'valid'));
    },
  );

  it('feeds four solid inputs through belts on both sides of the fluid tracks', () => {
    const design = generateAssemblerDesign(problem(null, [7, 7.6, 5, 5]), {
      beltItemsPerSecond: 45,
      inserterItemsPerSecond: 15.9,
      longInserterItemsPerSecond: 7.9,
    });
    expect(design.columns).toBeDefined();
    const entities = design.columns![0].entities;
    expect(entities.filter(({ kind }) => kind === 'inserter')).toEqual([
      { kind: 'inserter', position: { x: 5, y: 1 }, direction: 'west' },
      { kind: 'inserter', position: { x: 1, y: 0 }, direction: 'east' },
    ]);
    expect(entities.filter(({ kind }) => kind === 'belt')).toEqual([
      ...[0, 1, 2, 3].map((y) => ({ kind: 'belt', position: { x: 6, y }, direction: 'north' })),
      ...[0, 1, 2, 3].map((y) => ({ kind: 'belt', position: { x: 0, y }, direction: 'north' })),
    ]);
    expect(entityPositionStatuses(entities)).toEqual(entities.map(() => 'valid'));
  });

  it.each([
    { inputRate: 29.1, beltItemsPerSecond: 45 },
    { inputRate: 12.2, beltItemsPerSecond: 11.2 },
  ])(
    'splits one $inputRate items/s input across two belts',
    ({ inputRate, beltItemsPerSecond }) => {
      const design = generateAssemblerDesign(problem(null, [inputRate]), {
        beltItemsPerSecond,
        inserterItemsPerSecond: 15.9,
        longInserterItemsPerSecond: 7.9,
      });
      expect(design.columns).toBeDefined();
      const entities = design.columns![0].entities;
      expect(entities.filter(({ kind }) => kind === 'inserter')).toEqual([
        { kind: 'inserter', position: { x: 5, y: 1 }, direction: 'west' },
        { kind: 'inserter', position: { x: 1, y: 0 }, direction: 'east' },
      ]);
      expect(
        entities.filter(({ kind }) => kind === 'belt').map(({ position }) => position.x),
      ).toEqual([6, 6, 6, 6, 0, 0, 0, 0]);
      expect(entityPositionStatuses(entities)).toEqual(entities.map(() => 'valid'));
    },
  );

  it('rejects a single input above the combined belt and inserter capacity', () => {
    const design = generateAssemblerDesign(problem(null, [31.9]), {
      beltItemsPerSecond: 45,
      inserterItemsPerSecond: 15.9,
      longInserterItemsPerSecond: 7.9,
    });
    expect(design).toEqual({
      failure: [
        'the adapted fluid layout cannot feed its solid inputs through the available belts and inserters',
      ],
    });
  });

  it('uses the second belt when two inputs exceed one inserter, and rejects an input beyond either inserter', () => {
    const transport = {
      beltItemsPerSecond: 45,
      inserterItemsPerSecond: 15.9,
      longInserterItemsPerSecond: 7.9,
    };
    expect(generateAssemblerDesign(problem(null, [10, 10]), transport)).toHaveProperty('columns');
    expect(generateAssemblerDesign(problem(null, [23, 5]), transport)).toEqual({
      failure: [
        'the adapted fluid layout cannot feed its solid inputs through the available belts and inserters',
      ],
    });
  });

  it('uses the west free site for a solid input when the east site extracts an output', () => {
    const design = generateAssemblerDesign(problem(5, [5, 5]), {
      beltItemsPerSecond: 45,
      inserterItemsPerSecond: 15.9,
      longInserterItemsPerSecond: 7.9,
    });
    expect(design.columns).toBeDefined();
    const entities = design.columns![0].entities;
    expect(entities.filter(({ kind }) => kind === 'inserter')).toEqual([
      { kind: 'inserter', position: { x: 5, y: 1 }, direction: 'east' },
      { kind: 'inserter', position: { x: 1, y: 0 }, direction: 'east' },
    ]);
    expect(entities.filter(({ kind }) => kind === 'belt')).toEqual([
      ...[0, 1, 2, 3].map((y) => ({ kind: 'belt', position: { x: 6, y }, direction: 'south' })),
      ...[0, 1, 2, 3].map((y) => ({ kind: 'belt', position: { x: 0, y }, direction: 'north' })),
    ]);
    expect(entityPositionStatuses(entities)).toEqual(entities.map(() => 'valid'));
  });

  it('connects the correct fluids through underground partners across three adjacent copies', () => {
    const entities = generateAssemblerDesign(problem(), throughput).columns![0].entities;
    const repeated = [-4, 0, 4].flatMap((offset) =>
      entities.map((entity) => ({
        ...entity,
        position: { x: entity.position.x, y: entity.position.y + offset },
      })),
    );
    expect(entityPositionStatuses(repeated)).toEqual(repeated.map(() => 'valid'));
    // Seed only the first machine: the other two must receive fluid through the seam pairs.
    const firstMachine = repeated.find((entity) => entity.kind === 'assembler')!;
    firstMachine.recipe = 'source';
    const traces = designFluidTraces(
      { entities: repeated },
      { [recipeId]: recipe, source: { ingredients: [], products: recipe.ingredients } },
      {
        [recipeId]: machine,
        source: {
          fluidBoxes: machine.fluidBoxes!.map((box) => ({
            ...box,
            productionType: box.productionType === 'input' ? 'output' : 'none',
            connections: box.connections.map((connection) => ({
              ...connection,
              flowDirection: 'output' as const,
            })),
          })),
        },
      },
    );
    const assigned = fluidBoxResources(machine, recipe);
    repeated.forEach((entity, index) => {
      if (entity.kind === 'assembler' && entity.recipe === recipeId) {
        expect(traces.assemblerStatuses.get(index)).toEqual({ missing: [] });
      }
      if (entity.kind === 'pipe' || entity.kind === 'underground-pipe') {
        expect(traces.pipeTraces.get(index)).toEqual({
          fluids: [assigned.get(entity.position.x === 0 ? 3 : 2)],
        });
      }
    });
  });

  it('supports rotated prototype geometry', () => {
    const rotated = problem();
    const directions = ['north', 'east', 'south', 'west'] as const;
    rotated.assemblers[0].fluidBoxes = machine.fluidBoxes!.map((box) => ({
      ...box,
      connections: box.connections.map((connection) => ({
        ...connection,
        position: { x: -connection.position.y, y: connection.position.x },
        direction: directions[(directions.indexOf(connection.direction) + 1) % 4],
      })),
    }));
    const entities = generateAssemblerDesign(rotated, throughput).columns![0].entities;
    expect(entities.find(({ kind }) => kind === 'assembler')).toMatchObject({ direction: 'south' });
  });

  it('labels preview trunks by their recipe boxes when port order differs from recipe order', () => {
    const column = generateAssemblerDesign(problem(), throughput).columns![0];
    const traces = designFluidTraces(column, { [recipeId]: recipe }, { [recipeId]: machine }, true);
    const assigned = fluidBoxResources(machine, recipe);
    column.entities.forEach((entity, index) => {
      if (entity.kind === 'pipe') {
        expect(traces.pipeTraces.get(index)).toEqual({
          fluids: [assigned.get(entity.position.x === 0 ? 3 : 2)],
        });
      }
    });
  });

  it('rejects ports assigned to the same recipe fluid, including explicit box indexes', () => {
    const invalid = problem();
    invalid.assemblers[0].fluidIngredients = recipe.ingredients.map((ingredient, index) => ({
      ...ingredient,
      fluidboxIndex: index + 1,
    }));
    expect(generateAssemblerDesign(invalid, throughput)).toHaveProperty('failure');
    const oneBox = problem();
    oneBox.assemblers[0].fluidBoxes = [
      {
        productionType: 'input',
        connections: [machine.fluidBoxes![2].connections[0], machine.fluidBoxes![3].connections[0]],
      },
    ];
    expect(generateAssemblerDesign(oneBox, throughput)).toHaveProperty('failure');
  });

  it.each([undefined, { width: 5, height: 3 }])(
    'rejects unsupported machine geometry %j',
    (size) => {
      const invalid = problem();
      invalid.assemblers[0].size = size;
      expect(generateAssemblerDesign(invalid, throughput)).toHaveProperty('failure');
    },
  );

  it('rejects missing ports and enforces the output lane and inserter capacities', () => {
    expect(
      generateAssemblerDesign(
        assemblerProblem({ fluidInputs: [200, 200], solidOutputs: [2] }),
        throughput,
      ),
    ).toHaveProperty('failure');
    expect(generateAssemblerDesign(problem(9), throughput)).toMatchObject({
      failure: ['the adapted fluid layout output exceeds its single free inserter site'],
    });
    expect(
      generateAssemblerDesign(problem(16), { ...throughput, inserterItemsPerSecond: 30 }),
    ).toMatchObject({ failure: ['the adapted fluid layout output exceeds one belt lane'] });
  });
});
