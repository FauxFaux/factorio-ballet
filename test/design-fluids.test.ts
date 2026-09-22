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
});

function assembler(recipe: string, x: number) {
  return {
    kind: 'assembler' as const,
    recipe,
    position: { x, y: 0 },
    size: { width: 3, height: 3 },
  };
}
