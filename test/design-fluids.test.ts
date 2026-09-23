import { describe, expect, it } from 'vitest';
import { designFluidTraces } from '../src/components/design/design-fluid-traces.ts';
import type {
  DesignSceneMachines,
  DesignSceneRecipes,
} from '../src/components/design/design-scene.tsx';
import type { DesignColumn } from '../src/compute/design.ts';

const machines: DesignSceneMachines = {
  source: {
    fluidBoxes: [
      {
        productionType: 'output',
        connections: [{ position: { x: 1, y: 0 }, direction: 'east', flowDirection: 'output' }],
      },
    ],
  },
  consumer: {
    fluidBoxes: [
      {
        productionType: 'input',
        connections: [{ position: { x: -1, y: 0 }, direction: 'west', flowDirection: 'input' }],
      },
    ],
  },
};

const recipes: DesignSceneRecipes = {
  source: { ingredients: [], products: [{ resource: 'fluid:steam' }] },
  consumer: { ingredients: [{ resource: 'fluid:steam' }], products: [] },
  waterConsumer: { ingredients: [{ resource: 'fluid:water' }], products: [] },
};

describe('design fluid traces', () => {
  it('fills a complete pipe component from an adjacent fluidbox output', () => {
    const column: DesignColumn = {
      entities: [
        assembler('source', 0),
        { kind: 'pipe', position: { x: 3, y: 1 } },
        { kind: 'pipe', position: { x: 4, y: 1 } },
        assembler('consumer', 5),
      ],
    };

    const traces = designFluidTraces(column, recipes, machines);

    expect(traces.pipeTraces.get(1)).toEqual({ fluids: ['fluid:steam'] });
    expect(traces.pipeTraces.get(2)).toEqual({ fluids: ['fluid:steam'] });
    expect(traces.assemblerStatuses.get(3)).toEqual({ missing: [] });
  });

  it('reports a fluid missing when the attached pipe contains another fluid', () => {
    const column: DesignColumn = {
      entities: [
        assembler('source', 0),
        { kind: 'pipe', position: { x: 3, y: 1 } },
        { kind: 'pipe', position: { x: 4, y: 1 } },
        assembler('waterConsumer', 5),
      ],
    };

    const traces = designFluidTraces(column, recipes, {
      ...machines,
      waterConsumer: machines.consumer,
    });

    expect(traces.assemblerStatuses.get(3)).toEqual({ missing: ['fluid:water'] });
  });

  it('pre-fills a wrapped preview input trunk with its expected fluid', () => {
    const column: DesignColumn = {
      entities: [
        { kind: 'pipe', position: { x: 0, y: 0 } },
        { kind: 'pipe', position: { x: 0, y: 1 } },
        { kind: 'pipe', position: { x: 0, y: 2 } },
        assembler('consumer', 1),
      ],
    };

    expect(designFluidTraces(column, recipes, machines).assemblerStatuses.get(3)).toEqual({
      missing: ['fluid:steam'],
    });
    const wrapped = designFluidTraces(column, recipes, machines, true);
    expect(wrapped.assemblerStatuses.get(3)).toEqual({ missing: [] });
    expect(wrapped.pipeTraces.get(0)).toEqual({ fluids: ['fluid:steam'] });
    expect(wrapped.pipeTraces.get(2)).toEqual({ fluids: ['fluid:steam'] });
  });

  it('traces through facing pipe-to-ground endpoints and their exposed sides', () => {
    const column: DesignColumn = {
      entities: [
        assembler('source', 0),
        { kind: 'underground-pipe', position: { x: 3, y: 1 }, direction: 'west' },
        { kind: 'pipe', position: { x: 4, y: 1 } },
        { kind: 'underground-pipe', position: { x: 6, y: 1 }, direction: 'east' },
        { kind: 'pipe', position: { x: 7, y: 1 } },
        assembler('consumer', 8),
      ],
    };

    const traces = designFluidTraces(column, recipes, machines);
    expect(traces.pipeTraces.get(1)).toEqual({ fluids: ['fluid:steam'] });
    expect(traces.pipeTraces.get(3)).toEqual({ fluids: ['fluid:steam'] });
    expect(traces.pipeTraces.get(4)).toEqual({ fluids: ['fluid:steam'] });
    expect(traces.pipeTraces.get(2)).toEqual({ fluids: [] });
    expect(traces.assemblerStatuses.get(5)).toEqual({ missing: [] });
  });

  it('keeps misaligned, misoriented, and out-of-reach endpoints separate', () => {
    for (const [position, direction] of [
      [{ x: 5, y: 2 }, 'east'],
      [{ x: 5, y: 1 }, 'west'],
      [{ x: 14, y: 1 }, 'east'],
    ] as const) {
      const column: DesignColumn = {
        entities: [
          assembler('source', 0),
          { kind: 'underground-pipe', position: { x: 3, y: 1 }, direction: 'west' },
          { kind: 'underground-pipe', position, direction },
          { kind: 'pipe', position: { x: position.x + 1, y: position.y } },
        ],
      };
      const traces = designFluidTraces(column, recipes, machines);
      expect(traces.pipeTraces.get(2)).toEqual({ fluids: [] });
    }
  });
});

function assembler(recipe: string, x: number) {
  return {
    kind: 'assembler' as const,
    recipe,
    position: { x, y: 0 },
    size: { width: 3, height: 3 },
  };
}
