// @vitest-environment happy-dom

import { cleanup, screen } from '@testing-library/preact';
import { render } from '../../render-with-dataset.tsx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  designBounds,
  DesignPreview,
  fitDesignPreview,
} from '../../../src/components/design/design-preview.tsx';
import type { DesignEntity } from '../../../src/compute/design.ts';

const entities: DesignEntity[] = [
  {
    kind: 'assembler',
    recipe: 'copper-cable',
    position: { x: -2, y: -1 },
    size: { width: 4, height: 2 },
  },
  { kind: 'belt', position: { x: 4, y: 3 }, direction: 'east' },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DesignPreview', () => {
  it('shows both assigned lanes of a tile-design belt without guessing from recipes', () => {
    render(
      <DesignPreview
        label="Assigned lanes"
        recipes={{}}
        column={{ entities: [{ kind: 'belt', position: { x: 0, y: 0 }, direction: 'north' }] }}
        lanes={[
          { entityIndex: 0, lane: 'left', resource: 'item:3' },
          { entityIndex: 0, lane: 'right', resource: 'item:1' },
        ]}
        items={{
          'item:1': { name: 'input', rate: 30.8, colour: '#fff' },
          'item:3': { name: 'output', rate: 1.2, colour: '#000' },
        }}
      />,
    );
    expect(
      screen.getByRole('img', {
        name: /Transport belt at 0, 0, pointing north, left side: output.*right side: input/,
      }),
    ).toBeTruthy();
  });

  it('includes entity sizes and negative positions in its bounds', () => {
    expect(designBounds(entities)).toEqual({ minX: -2, maxX: 5, minY: -1, maxY: 4 });
  });

  it('fits and centres the complete entity bounds', () => {
    expect(fitDesignPreview(entities, { x: 168, y: 144 })).toEqual({
      origin: { x: 31, y: 24 },
      scale: 12 / 7,
    });
  });

  it('renders status information without editor controls', () => {
    render(
      <DesignPreview
        label="Read-only design"
        recipes={{}}
        column={{
          entities: [
            { kind: 'belt', position: { x: 0, y: 0 }, direction: 'east' },
            { kind: 'belt', position: { x: 0, y: 0 }, direction: 'south' },
          ],
        }}
      />,
    );

    expect(screen.getByRole('region', { name: 'Read-only design' })).toBeTruthy();
    expect(screen.getAllByRole('img', { name: /overlaps another entity/ })).toHaveLength(2);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('fits the grid and entities through the same preview world', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 168,
      height: 144,
    } as DOMRect);
    const { container } = render(
      <DesignPreview
        label="Fitted design"
        recipes={{}}
        column={{
          entities: [{ kind: 'belt', position: { x: 0, y: 0 }, direction: 'east' }],
        }}
      />,
    );

    const world = container.querySelector<HTMLElement>('.design-preview-world');
    const belt = screen.getByRole('img', { name: 'Transport belt at 0, 0, pointing east' });

    expect(world?.contains(belt)).toBe(true);
    expect(world?.style.transform).toBe('scale(3)');
    expect(world?.style.backgroundPosition).toBe('22px 18px');
    expect(belt.style.left).toBe('22px');
    expect(belt.style.top).toBe('18px');
  });

  it('highlights a machine whose fluid input is not attached to a filled pipe', () => {
    render(
      <DesignPreview
        label="Missing fluid design"
        recipes={{
          consumer: { ingredients: [{ resource: 'fluid:water' }], products: [] },
        }}
        machinesByRecipe={{
          consumer: {
            fluidBoxes: [
              {
                productionType: 'input',
                connections: [
                  { position: { x: -1, y: 0 }, direction: 'west', flowDirection: 'input' },
                ],
              },
            ],
          },
        }}
        column={{
          entities: [
            {
              kind: 'assembler',
              recipe: 'consumer',
              position: { x: 1, y: 0 },
              size: { width: 3, height: 3 },
            },
          ],
        }}
      />,
    );

    expect(document.querySelector('.cell-design-assembler-all-inputs-missing')).not.toBeNull();
  });

  it('pre-fills and validates a fluid input pipe at the preview boundary', () => {
    render(
      <DesignPreview
        label="Wrapped fluid design"
        recipes={{
          consumer: { ingredients: [{ resource: 'fluid:water' }], products: [] },
        }}
        machinesByRecipe={{
          consumer: {
            fluidBoxes: [
              {
                productionType: 'input',
                connections: [
                  { position: { x: -1, y: 0 }, direction: 'west', flowDirection: 'input' },
                ],
              },
            ],
          },
        }}
        items={{
          'fluid:water': { name: 'water', rate: 200, colour: '#369dcc' },
        }}
        column={{
          entities: [
            { kind: 'pipe', position: { x: 0, y: 1 } },
            {
              kind: 'assembler',
              recipe: 'consumer',
              position: { x: 1, y: 0 },
              size: { width: 3, height: 3 },
            },
          ],
        }}
      />,
    );

    expect(document.querySelector('.cell-design-assembler-all-inputs-missing')).toBeNull();
    expect(document.querySelector('.cell-design-pipe')?.getAttribute('data-fluid-status')).toBe(
      'filled',
    );
  });
});
