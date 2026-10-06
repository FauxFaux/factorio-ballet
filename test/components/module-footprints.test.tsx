// @vitest-environment happy-dom
import { act, fireEvent } from '@testing-library/preact';
import { render } from '../render-with-dataset.tsx';
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
  it('draws estimated modules with a warning color and keeps their connections', () => {
    const estimated = { ...module('A'), estimated: true };
    const { container } = render(
      <ModuleFootprints
        modules={[estimated]}
        inputStationStops={[{ x: 2, y: 50 }]}
        stationConnections={[
          {
            stationId: 'station:iron',
            stationIndex: 0,
            moduleId: 'A',
            resource: 'item:iron',
            rate: 2,
            side: 'input',
            modulePort: { edge: 'bottom', x: 1, transport: 'belt', lane: 'left' },
          },
        ]}
      />,
    );
    expect(
      container.querySelector('[data-layout-module="A"] rect')?.classList.contains('is-estimated'),
    ).toBe(true);
    expect(container.querySelector('[data-layout-station-connection="input"]')).not.toBeNull();
  });
  it('drags a module in tile coordinates while keeping its neighbors fixed until the next frame', () => {
    const port = { edge: 'top' as const, x: 0, transport: 'belt' as const };
    const { container } = render(
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
    const initialA = Number(aRect.getAttribute('x'));
    const initialY = Number(aRect.getAttribute('y'));
    const initialPath = path.getAttribute('d');

    fireEvent.pointerDown(a, { pointerId: 1, button: 0, clientX: 28, clientY: 74 });
    fireEvent.pointerMove(svg, { pointerId: 1, clientX: 92, clientY: 122 });
    expect(Number(aRect.getAttribute('x'))).toBe(initialA + 32);
    expect(Number(aRect.getAttribute('y'))).toBe(initialY + 24);
    expect(path.getAttribute('d')).not.toBe(initialPath);
    expect(Number(bRect.getAttribute('x'))).toBe(initialB);

    fireEvent.pointerUp(svg, { pointerId: 1 });
    expect(Number(aRect.getAttribute('x'))).toBe(initialA + 32);
  });

  it('freezes released modules across frames and unfreezes only the clicked module', () => {
    const frames: FrameRequestCallback[] = [];
    let frameId = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return ++frameId;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    try {
      const onFrozenModulesChange = vi.fn();
      const { container, unmount } = render(
        <ModuleFootprints
          modules={[module('A'), module('B'), module('C')]}
          onFrozenModulesChange={onFrozenModulesChange}
        />,
      );
      const svg = container.querySelector('svg.cell-layout-modules')!;
      vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
        left: 0,
        top: 0,
        width: 192,
        height: 128,
      } as DOMRect);
      const a = container.querySelector('[data-layout-module="A"]')!;
      const b = container.querySelector('[data-layout-module="B"]')!;
      const position = (node: Element) => {
        const rect = node.querySelector('rect')!;
        return [Number(rect.getAttribute('x')), Number(rect.getAttribute('y'))];
      };
      const move = (node: Element, pointerId: number, x: number, y: number) => {
        const [startX, startY] = position(node);
        fireEvent.pointerDown(node, { pointerId, button: 0, clientX: startX, clientY: startY });
        fireEvent.pointerMove(svg, { pointerId, clientX: x, clientY: y });
        fireEvent.pointerUp(node, { pointerId });
        // Browsers also dispatch a click after releasing a drag.
        fireEvent.click(node);
      };
      move(a, 1, 50, 50);
      move(b, 2, 70, 50);
      expect(onFrozenModulesChange).toHaveBeenLastCalledWith({
        A: { x: 50, y: 50 },
        B: { x: 70, y: 50 },
      });
      const free = container.querySelector('[data-layout-module="C"]')!;
      const initialFree = position(free);
      for (let i = 0; i < 5; i++) act(() => frames.shift()!(i));
      expect(position(a)).toEqual([50, 50]);
      expect(position(b)).toEqual([70, 50]);
      expect(position(free)).not.toEqual(initialFree);

      // A small pointer wobble still counts as a click.
      fireEvent.pointerDown(a, { pointerId: 3, button: 0, clientX: 50, clientY: 50 });
      fireEvent.pointerMove(svg, { pointerId: 3, clientX: 51, clientY: 51 });
      fireEvent.pointerUp(a, { pointerId: 3 });
      fireEvent.click(a);
      expect(onFrozenModulesChange).toHaveBeenLastCalledWith({ B: { x: 70, y: 50 } });
      act(() => frames.shift()!(6));
      expect(position(a)).not.toEqual([50, 50]);
      expect(position(b)).toEqual([70, 50]);
      unmount();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('restores shared frozen positions and responds to URL state changes', () => {
    const modules = [module('A'), module('B')];
    const frames: FrameRequestCallback[] = [];
    let frameId = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return ++frameId;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    try {
      const { container, rerender, unmount } = render(
        <ModuleFootprints modules={modules} frozenModules={{ A: { x: 50, y: 50 } }} />,
      );
      const rect = container.querySelector('[data-layout-module="A"] rect')!;
      act(() => frames.shift()!(0));
      expect(Number(rect.getAttribute('x'))).toBe(50);
      expect(Number(rect.getAttribute('y'))).toBe(50);
      rerender(<ModuleFootprints modules={modules} frozenModules={{ A: { x: 80, y: 30 } }} />);
      act(() => frames.shift()!(1));
      expect(Number(rect.getAttribute('x'))).toBe(80);
      expect(Number(rect.getAttribute('y'))).toBe(30);
      rerender(<ModuleFootprints modules={modules} frozenModules={{}} />);
      act(() => frames.shift()!(2));
      expect(Number(rect.getAttribute('x'))).not.toBe(80);
      unmount();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('starts at the pre-layout position and advances spring refinement on animation frames', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    try {
      const { container, unmount } = render(<ModuleFootprints modules={[module('A')]} />);
      const footprint = container.querySelector('[data-layout-module="A"] rect')!;
      const startingX = Number(footprint.getAttribute('x'));
      expect(frames).toHaveLength(1);
      act(() => frames.shift()!(0));
      expect(Number(footprint.getAttribute('x'))).not.toBe(startingX);
      unmount();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('replaces placement and paths when its module graph changes', () => {
    const port = { edge: 'top' as const, x: 0, transport: 'belt' as const };
    const { container, rerender } = render(
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
    rerender(<ModuleFootprints modules={[module('A')]} />);
    expect(container.querySelector('[data-layout-resource="item:iron"]')).toBeNull();
    expect(
      Number(container.querySelector('[data-layout-module="A"] rect')?.getAttribute('x')),
    ).toBe(firstX);
    expect(firstPath).toBeTruthy();
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
    expect(path?.getAttribute('d')).toMatch(/^M [\d.]+ [\d.]+ Q [\d.]+ [\d.]+ [\d.]+ [\d.]+$/);
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
    ).toMatch(/^M 10 54\.5 L [\d.]+ [\d.]+$/);
    expect(
      container.querySelector('[data-layout-station-connection="output"]')?.getAttribute('d'),
    ).toMatch(/^M [\d.]+ [\d.]+ L 162 44$/);
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
