// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  designBounds,
  DesignPreview,
  fitDesignPreview,
} from '../src/components/design/design-preview.tsx';
import type { DesignEntity } from '../src/design.ts';

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
});
