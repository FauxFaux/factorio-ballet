// @vitest-environment happy-dom

import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import type { Blueprint } from '../src/bp/decode.ts';
import type { RailPiece } from '../src/bp/rail.ts';
import { RailBlueprintPreview, railPiecePath } from '../src/components/rail-blueprint-preview.tsx';

const blueprint: Blueprint = {
  item: 'blueprint',
  version: 562949955518464,
  label: 'Small rail test',
  entities: [
    { entity_number: 1, name: 'straight-rail', position: { x: 10, y: 20 } },
    { entity_number: 2, name: 'curved-rail-a', position: { x: 30, y: 40 } },
  ],
};

describe('RailBlueprintPreview', () => {
  it('draws the decoded rail entities on a fixed game-unit canvas', () => {
    const { container } = render(<RailBlueprintPreview blueprint={blueprint} />);
    const preview = screen.getByRole('img', {
      name: 'Rail blueprint entities: Small rail test',
    });

    expect(preview.getAttribute('viewBox')).toBe('0 0 192 120');
    expect(container.querySelectorAll('.rail-blueprint-preview-piece')).toHaveLength(2);
    expect(container.querySelector('[data-rail-entity="1"]')?.getAttribute('d')).toBe(
      'M 10 19 L 10 21',
    );
    expect(container.querySelector('[data-rail-entity="2"]')?.getAttribute('d')).toBe(
      'M 30 42 Q 30 40 29 37.5',
    );
  });

  it('returns an empty canvas for a blueprint without rail entities', () => {
    const { container } = render(
      <RailBlueprintPreview blueprint={{ ...blueprint, label: undefined, entities: [] }} />,
    );

    expect(
      screen.getByRole('img', { name: 'Rail blueprint entities: Untitled blueprint' }),
    ).toBeTruthy();
    expect(container.querySelector('.rail-blueprint-preview-piece')).toBeNull();
  });

  it('uses the entity anchor to curve curved rail pieces', () => {
    const piece: RailPiece = {
      entityNumber: 1,
      name: 'curved-rail-b',
      position: { x: 5, y: 7 },
      direction: 0,
      ends: [{ connectionPoints: [{ x2: 12, y2: 19 }] }, { connectionPoints: [{ x2: 6, y2: 10 }] }],
    };

    expect(railPiecePath(piece)).toBe('M 6 9.5 Q 5 7 3 5');
  });
});
