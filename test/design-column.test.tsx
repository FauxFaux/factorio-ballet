// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DesignColumn,
  entityPositionStatuses,
  worldToViewport,
} from '../src/components/design/design-column.tsx';
import type { DesignColumn as DesignColumnData } from '../src/design.ts';

afterEach(cleanup);

describe('DesignColumn', () => {
  it('draws assemblers at their tile position and size', () => {
    render(
      <DesignColumn
        index={0}
        column={{
          entities: [
            {
              kind: 'assembler',
              recipe: 'copper-cable',
              position: { x: 8, y: 4 },
              size: { width: 3, height: 2 },
            },
          ],
        }}
        entries={[]}
        counts={[]}
        progress={0}
        onChange={() => undefined}
      />,
    );

    const assembler = screen.getByRole('img', { name: 'Copper wire assembler at 8, 4' });
    expect(assembler.style.left).toBe('96px');
    expect(assembler.style.top).toBe('48px');
    expect(assembler.style.width).toBe('36px');
    expect(assembler.style.height).toBe('24px');
    expect(assembler.querySelector('.cell-design-assembler-icon')).not.toBeNull();
  });

  it('maps negative world coordinates relative to the viewport world origin', () => {
    expect(worldToViewport({ x: -3, y: -2 }, { x: 100, y: 80 })).toEqual({ x: 64, y: 56 });
  });

  it('marks every entity whose tile rectangle overlaps another entity', () => {
    expect(
      entityPositionStatuses([
        {
          kind: 'assembler',
          recipe: 'copper-cable',
          position: { x: 0, y: 0 },
          size: { width: 3, height: 2 },
        },
        { kind: 'belt', position: { x: 2, y: 1 }, direction: 'east' },
        { kind: 'pipe', position: { x: 3, y: 0 } },
      ]),
    ).toEqual(['overlap', 'overlap', 'valid']);
  });

  it('colours overlapping assemblers as errors', () => {
    render(
      <DesignColumn
        index={0}
        column={{
          entities: [
            {
              kind: 'assembler',
              recipe: 'copper-cable',
              position: { x: 0, y: 0 },
              size: { width: 3, height: 2 },
            },
            {
              kind: 'assembler',
              recipe: 'copper-cable',
              position: { x: 2, y: 1 },
              size: { width: 3, height: 2 },
            },
          ],
        }}
        entries={[]}
        counts={[]}
        progress={0}
        onChange={() => undefined}
      />,
    );

    expect(screen.getAllByRole('img', { name: /overlaps another entity/ })).toHaveLength(2);
    expect(document.querySelectorAll('.cell-design-assembler-error')).toHaveLength(2);
  });

  it('scrolls the grid and entities through the same viewport transform', () => {
    render(
      <DesignColumn
        index={0}
        column={{
          entities: [
            {
              kind: 'assembler',
              recipe: 'copper-cable',
              position: { x: 8, y: 4 },
              size: { width: 3, height: 2 },
            },
          ],
        }}
        entries={[]}
        counts={[]}
        progress={0}
        onChange={() => undefined}
      />,
    );

    const viewport = screen.getByRole('region', { name: 'Design viewport for column 1' });
    const assembler = screen.getByRole('img', { name: 'Copper wire assembler at 8, 4' });

    fireEvent.wheel(viewport, { deltaX: 12, deltaY: -24 });

    expect(viewport.style.backgroundPosition).toBe('-12px 24px');
    expect(assembler.style.left).toBe('84px');
    expect(assembler.style.top).toBe('72px');
  });

  it('pans the grid and entities together by dragging', () => {
    render(
      <DesignColumn
        index={0}
        column={{
          entities: [
            {
              kind: 'assembler',
              recipe: 'copper-cable',
              position: { x: 0, y: 0 },
              size: { width: 3, height: 2 },
            },
          ],
        }}
        entries={[]}
        counts={[]}
        progress={0}
        onChange={() => undefined}
      />,
    );

    const viewport = screen.getByRole('region', { name: 'Design viewport for column 1' });
    const assembler = screen.getByRole('img', { name: 'Copper wire assembler at 0, 0' });
    viewport.setPointerCapture = () => undefined;
    viewport.releasePointerCapture = () => undefined;

    fireEvent.pointerDown(viewport, { button: 0, pointerId: 1, clientX: 10, clientY: 20 });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 34, clientY: 8 });

    expect(viewport.style.backgroundPosition).toBe('24px -12px');
    expect(assembler.style.left).toBe('24px');
    expect(assembler.style.top).toBe('-12px');
  });

  it('moves an assembler to snapped integer tile coordinates without panning', () => {
    let column: DesignColumnData = {
      entities: [
        {
          kind: 'assembler' as const,
          recipe: 'copper-cable',
          position: { x: 8, y: 4 },
          size: { width: 3, height: 2 },
        },
      ],
    };
    render(
      <DesignColumn
        index={0}
        column={column}
        entries={[]}
        counts={[]}
        progress={0}
        onChange={(update) => {
          column = update(column);
        }}
      />,
    );

    const viewport = screen.getByRole('region', { name: 'Design viewport for column 1' });
    const assembler = screen.getByRole('img', { name: 'Copper wire assembler at 8, 4' });
    assembler.setPointerCapture = () => undefined;
    assembler.releasePointerCapture = () => undefined;

    fireEvent.pointerDown(assembler, { button: 0, pointerId: 1, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(assembler, { pointerId: 1, clientX: 44, clientY: 8 });
    fireEvent.pointerUp(assembler, { pointerId: 1 });

    expect(column.entities[0].position).toEqual({ x: 10, y: 3 });
    expect(viewport.style.backgroundPosition).toBe('0px 0px');
  });

  it('erases an entity when erase mode is active', () => {
    let column: DesignColumnData = {
      entities: [
        {
          kind: 'assembler',
          recipe: 'copper-cable',
          position: { x: 8, y: 4 },
          size: { width: 3, height: 2 },
        },
      ],
    };
    render(
      <DesignColumn
        index={0}
        column={column}
        entries={[]}
        counts={[]}
        progress={0}
        onChange={(update) => {
          column = update(column);
        }}
      />,
    );

    const erase = screen.getByRole('button', { name: 'Erase' });
    fireEvent.click(erase);
    expect(erase.getAttribute('aria-pressed')).toBe('true');

    fireEvent.pointerDown(screen.getByRole('img', { name: 'Copper wire assembler at 8, 4' }), {
      button: 0,
      pointerId: 1,
    });

    expect(column.entities).toEqual([]);
  });

  it('erases entities as the primary pointer moves over them in erase mode', () => {
    let column: DesignColumnData = {
      entities: [
        {
          kind: 'assembler',
          recipe: 'copper-cable',
          position: { x: 8, y: 4 },
          size: { width: 3, height: 2 },
        },
      ],
    };
    render(
      <DesignColumn
        index={0}
        column={column}
        entries={[]}
        counts={[]}
        progress={0}
        onChange={(update) => {
          column = update(column);
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Erase' }));
    fireEvent.pointerMove(screen.getByRole('img', { name: 'Copper wire assembler at 8, 4' }), {
      buttons: 1,
      pointerId: 1,
    });

    expect(column.entities).toEqual([]);
  });

  it('draws belts as directional one-tile entities', () => {
    render(
      <DesignColumn
        index={0}
        column={{ entities: [{ kind: 'belt', position: { x: 1, y: 2 }, direction: 'east' }] }}
        entries={[]}
        counts={[]}
        progress={0}
        onChange={() => undefined}
      />,
    );

    const belt = screen.getByRole('img', {
      name: 'Transport belt at 1, 2, pointing east',
    });
    expect(belt.style.left).toBe('12px');
    expect(belt.style.top).toBe('24px');
    expect(belt.style.width).toBe('12px');
    expect(belt.querySelector('[data-direction="east"]')).not.toBeNull();
  });

  it('keeps a belt drag straight until the cursor is three tiles off track', () => {
    let column: DesignColumnData = { entities: [] };
    render(
      <DesignColumn
        index={0}
        column={column}
        entries={[]}
        counts={[]}
        progress={0}
        onChange={(update) => {
          column = update(column);
        }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Draw belts' }));
    const viewport = screen.getByRole('region', { name: 'Design viewport for column 1' });
    viewport.setPointerCapture = () => undefined;
    viewport.releasePointerCapture = () => undefined;

    fireEvent.pointerDown(viewport, { button: 0, pointerId: 1, clientX: 13, clientY: 25 });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 37, clientY: 25 });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 37, clientY: 49 });

    expect(column.entities).toEqual([
      { kind: 'belt', position: { x: 1, y: 2 }, direction: 'east' },
      { kind: 'belt', position: { x: 2, y: 2 }, direction: 'east' },
      { kind: 'belt', position: { x: 3, y: 2 }, direction: 'east' },
    ]);

    fireEvent.pointerUp(viewport, { pointerId: 1, clientX: 37, clientY: 61 });

    expect(column.entities).toEqual([
      { kind: 'belt', position: { x: 1, y: 2 }, direction: 'east' },
      { kind: 'belt', position: { x: 2, y: 2 }, direction: 'east' },
      { kind: 'belt', position: { x: 3, y: 2 }, direction: 'south' },
      { kind: 'belt', position: { x: 3, y: 3 }, direction: 'south' },
      { kind: 'belt', position: { x: 3, y: 4 }, direction: 'south' },
      { kind: 'belt', position: { x: 3, y: 5 }, direction: 'south' },
    ]);
  });

  it('makes belt and erase modes mutually exclusive', () => {
    render(
      <DesignColumn
        index={0}
        column={{ entities: [] }}
        entries={[]}
        counts={[]}
        progress={0}
        onChange={() => undefined}
      />,
    );

    const belt = screen.getByRole('button', { name: 'Draw belts' });
    const erase = screen.getByRole('button', { name: 'Erase' });
    fireEvent.click(belt);
    expect(belt.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(erase);
    expect(belt.getAttribute('aria-pressed')).toBe('false');
    expect(erase.getAttribute('aria-pressed')).toBe('true');
  });
});
