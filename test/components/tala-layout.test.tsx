// @vitest-environment happy-dom

import { cleanup, screen, waitFor } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '../render-with-dataset.tsx';
import type { FactoryModule } from '../../src/compute/modules.ts';
import type {
  AttachedModuleConnection,
  AttachedStationConnection,
} from '../../src/compute/module-port-connections.ts';
import { CellLayoutSurface } from '../../src/components/layout/layout.tsx';
import { talaGraph } from '../../src/components/layout/tala-graph.ts';

const { layout } = vi.hoisted(() => ({
  layout: vi.fn(async () => ({
    nodes: [{ id: 'module_0', x: 10, y: 20, width: 8, height: 12 }],
    edges: [
      {
        id: 'edge_0',
        points: [
          { x: 18, y: 26 },
          { x: 36, y: 26 },
        ],
      },
    ],
  })),
}));

vi.mock('../../src/assets/tala/index.js', () => ({
  TALA: class {
    ready = Promise.resolve();
    layout = layout;
  },
}));

afterEach(() => {
  cleanup();
  layout.mockClear();
});

const module: FactoryModule = {
  id: 'recipe.with.dots:0',
  recipe: 'copper-cable',
  machineCount: 1,
  copies: 1,
  size: { width: 8, height: 12 },
  ports: [],
  inputs: {},
  outputs: {},
};

describe('TALA layout bridge', () => {
  it('preserves module sizes and station flow direction with safe unique IDs', () => {
    const connection: AttachedModuleConnection = {
      producerId: module.id,
      consumerId: 'other',
      resource: 'item:copper-cable',
      rate: 1,
      producerPort: { edge: 'top', x: 0, transport: 'belt' },
      consumerPort: { edge: 'bottom', x: 0, transport: 'belt' },
    };
    const stationConnections: AttachedStationConnection[] = [
      {
        stationId: 'input',
        stationIndex: 0,
        moduleId: module.id,
        resource: 'item:copper-plate',
        rate: 1,
        side: 'input',
        modulePort: { edge: 'bottom', x: 0, transport: 'belt' },
      },
      {
        stationId: 'output',
        stationIndex: 0,
        moduleId: 'other',
        resource: 'item:copper-cable',
        rate: 1,
        side: 'output',
        modulePort: { edge: 'top', x: 0, transport: 'belt' },
      },
    ];
    const graph = talaGraph(
      [module, { ...module, id: 'other' }],
      [connection],
      stationConnections,
      [{ x: 9, y: 89 }],
      [{ x: 183, y: 39 }],
    );

    expect(graph).toEqual({
      direction: 'right',
      nodes: [
        { id: 'module_0', width: 8, height: 12 },
        { id: 'module_1', width: 8, height: 12 },
        { id: 'input_0', width: 12, height: 25.5 },
        { id: 'output_0', width: 5, height: 18.5 },
      ],
      edges: [
        { id: 'edge_0', source: 'module_0', target: 'module_1' },
        { id: 'edge_1', source: 'input_0', target: 'module_0' },
        { id: 'edge_2', source: 'module_1', target: 'output_0' },
      ],
    });
  });

  it('sends the graph to TALA and draws its nodes and edge routes below the layout', async () => {
    render(<CellLayoutSurface layout={{}} inputs={[]} outputs={[]} modules={[module]} />);

    await waitFor(() => expect(layout).toHaveBeenCalledOnce());
    expect(layout).toHaveBeenCalledWith({
      direction: 'right',
      nodes: [{ id: 'module_0', width: 8, height: 12 }],
      edges: [],
    });
    const output = await screen.findByRole('img', { name: 'TALA layout' });
    const [left, top, width, height] = output.getAttribute('viewBox')!.split(' ').map(Number);
    expect(left).toBeLessThan(10);
    expect(top).toBeLessThan(20);
    expect(left! + width!).toBeGreaterThan(36);
    expect(top! + height!).toBeGreaterThan(32);
    expect(output.querySelector('[data-tala-node="module_0"] rect')?.getAttribute('x')).toBe('10');
    expect(output.querySelector('[data-tala-node="module_0"] rect')?.getAttribute('height')).toBe(
      '12',
    );
    expect(output.querySelector('[data-tala-edge="edge_0"]')?.getAttribute('points')).toBe(
      '18,26 36,26',
    );
    expect(output.querySelector('[data-tala-node="module_0"] text')?.textContent).toBe(
      'Copper wire',
    );
    expect(output.querySelector('[data-tala-node="module_0"] title')?.textContent).toContain(
      '8×12 tiles',
    );
  });
});
