// @vitest-environment happy-dom
import { render } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { ModuleFootprints } from '../../src/components/layout/module-footprints.tsx';
import type { FactoryModule } from '../../src/compute/modules.ts';

function module(id: string): FactoryModule {
  return {
    id,
    recipe: 'iron-gear-wheel',
    machineCount: 3,
    copies: 3,
    size: { width: 4, height: 12 },
    ports: [],
    inputs: {},
    outputs: {},
  };
}

describe('ModuleFootprints', () => {
  it('draws an allocated resource link between its producer and consumer', () => {
    const { container } = render(
      <ModuleFootprints
        modules={[module('B'), module('A')]}
        connections={[
          {
            producerId: 'B',
            consumerId: 'A',
            resource: 'item:iron-plate',
            rate: 3,
            producerPort: {
              edge: 'top',
              x: 1,
              transport: 'belt',
              direction: 'north',
              lane: 'right',
            },
            consumerPort: {
              edge: 'bottom',
              x: 0,
              transport: 'belt',
              direction: 'north',
              lane: 'left',
            },
          },
        ]}
      />,
    );
    const path = container.querySelector('[data-layout-resource="item:iron-plate"]');
    expect(path?.getAttribute('data-layout-rate')).toBe('3');
    expect(path?.getAttribute('d')).toBe('M 9.75 26 Q 14.25 32 18.75 38');
    expect(path?.getAttribute('data-layout-producer-port')).toBe('top:1:right');
    expect(path?.getAttribute('data-layout-consumer-port')).toBe('bottom:0:left');
    expect(container.querySelectorAll('[data-layout-module]')).toHaveLength(2);
  });

  it('draws imports and exports to their station stops', () => {
    const { container } = render(
      <ModuleFootprints
        modules={[module('A')]}
        inputStationStops={[{ x: 2, y: 50 }]}
        outputStationStops={[{ x: 170, y: 40 }]}
        stationConnections={[
          {
            stationId: 'station:import:item:iron-plate',
            stationIndex: 0,
            moduleId: 'A',
            resource: 'item:iron-plate',
            rate: 2,
            side: 'input',
            modulePort: { edge: 'bottom', x: 0, transport: 'belt', lane: 'left' },
          },
          {
            stationId: 'station:export:item:gear',
            stationIndex: 0,
            moduleId: 'A',
            resource: 'item:gear',
            rate: 3,
            side: 'output',
            modulePort: { edge: 'top', x: 1, transport: 'belt', lane: 'right' },
          },
        ]}
      />,
    );
    expect(
      container.querySelector('[data-layout-station-connection="input"]')?.getAttribute('d'),
    ).toBe('M 10 54.5 L 8.25 38');
    expect(
      container.querySelector('[data-layout-station-connection="output"]')?.getAttribute('d'),
    ).toBe('M 9.75 26 L 162 44');
  });
});
