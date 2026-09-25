// @vitest-environment happy-dom
import { act, fireEvent, render } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
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
  it('drags a module in tile coordinates while its neighbors follow, then releases it', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    try {
      const port = { edge: 'top' as const, x: 0, transport: 'belt' as const };
      const { container, unmount } = render(
        <ModuleFootprints
          modules={[module('A'), module('B')]}
          connections={[
            {
              producerId: 'A',
              consumerId: 'B',
              resource: 'item:iron',
              rate: 60,
              producerPort: port,
              consumerPort: port,
            },
          ]}
        />,
      );
      const svg = container.querySelector('svg.cell-layout-modules')!;
      vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
        left: 10,
        top: 20,
        width: 384,
        height: 256,
      } as DOMRect);
      const a = container.querySelector('[data-layout-module="A"]')!;
      const aRect = a.querySelector('rect')!;
      const bRect = container.querySelector('[data-layout-module="B"] rect')!;
      const path = container.querySelector('[data-layout-resource="item:iron"]')!;
      const initialB = Number(bRect.getAttribute('x'));
      const initialPath = path.getAttribute('d');

      fireEvent.pointerDown(a, { pointerId: 1, button: 0, clientX: 28, clientY: 74 });
      fireEvent.pointerMove(svg, { pointerId: 1, clientX: 92, clientY: 122 });
      expect(Number(aRect.getAttribute('x'))).toBe(40);
      expect(Number(aRect.getAttribute('y'))).toBe(50);
      expect(path.getAttribute('d')).not.toBe(initialPath);
      act(() => frames.shift()!(0));
      expect(Number(aRect.getAttribute('x'))).toBe(40);
      expect(Number(bRect.getAttribute('x'))).not.toBe(initialB);

      fireEvent.pointerUp(svg, { pointerId: 1 });
      act(() => frames.shift()!(0));
      expect(Number(aRect.getAttribute('x'))).not.toBe(40);
      unmount();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('moves footprints and connected paths on animation frames', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    try {
      const port = { edge: 'top' as const, x: 0, transport: 'belt' as const };
      const { container, unmount } = render(
        <ModuleFootprints
          modules={[module('A'), module('B')]}
          connections={[
            {
              producerId: 'A',
              consumerId: 'B',
              resource: 'item:iron',
              rate: 60,
              producerPort: port,
              consumerPort: port,
            },
          ]}
        />,
      );
      const footprint = container.querySelector('[data-layout-module="A"] rect')!;
      const path = container.querySelector('[data-layout-resource="item:iron"]')!;
      const firstX = Number(footprint.getAttribute('x'));
      const firstPath = path.getAttribute('d');
      expect(frames).toHaveLength(1);
      act(() => frames.shift()!(0));
      expect(Number(footprint.getAttribute('x'))).not.toBe(firstX);
      expect(path.getAttribute('d')).not.toBe(firstPath);
      unmount();
    } finally {
      vi.unstubAllGlobals();
    }
  });

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

  it('highlights connections attached to the hovered module', async () => {
    const user = userEvent.setup();
    const port = { edge: 'top' as const, x: 0, transport: 'belt' as const, lane: 'left' as const };
    const { container } = render(
      <ModuleFootprints
        modules={[module('A'), module('B'), module('C')]}
        connections={[
          {
            producerId: 'A',
            consumerId: 'B',
            resource: 'item:one',
            rate: 1,
            producerPort: port,
            consumerPort: port,
          },
          {
            producerId: 'B',
            consumerId: 'C',
            resource: 'item:two',
            rate: 1,
            producerPort: port,
            consumerPort: port,
          },
        ]}
        inputStationStops={[{ x: 2, y: 50 }]}
        stationConnections={[
          {
            stationId: 'station:A',
            stationIndex: 0,
            moduleId: 'A',
            resource: 'item:three',
            rate: 1,
            side: 'input',
            modulePort: port,
          },
        ]}
      />,
    );
    const highlighted = () =>
      [...container.querySelectorAll('.cell-layout-module-connection.is-highlighted')].map((path) =>
        path.getAttribute('data-layout-resource'),
      );

    await user.hover(container.querySelector('[data-layout-module="B"]')!);
    expect(highlighted()).toEqual(['item:one', 'item:two']);

    await user.hover(container.querySelector('[data-layout-module="A"]')!);
    expect(highlighted()).toEqual(['item:three', 'item:one']);

    await user.unhover(container.querySelector('[data-layout-module="A"]')!);
    expect(highlighted()).toEqual([]);
  });
});
