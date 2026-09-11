// @vitest-environment happy-dom

import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { decodeDocument } from '../src/bp/decode.ts';
import { buildRailGraph } from '../src/bp/rail.ts';
import { RailBlueprints } from '../src/components/rail-blueprints.tsx';

describe('RailBlueprints', () => {
  it('renders a radar with the URL-state station counts', () => {
    const { container } = render(<RailBlueprints size={[3, 2]} />);

    expect(screen.getByRole('heading', { name: 'Rail blueprints' })).toBeTruthy();
    expect(screen.getByRole('img', { name: /3 input and 2 output stations/ })).toBeTruthy();
    expect(
      container.querySelector('[data-resource="item:rail-blueprint-input-3"]')?.getAttribute('cx'),
    ).toBe('26');
    expect(container.querySelector('.cell-radar-path')?.getAttribute('d')).not.toContain(
      'M 4 13 c 0 6, 4 7, 4 11 l 0 80',
    );

    const encoded = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Blueprint' }).value;
    const document = decodeDocument(encoded);
    expect(document).toHaveProperty('blueprint.label', '3 input, 2 output rail brick');
    if (!('blueprint' in document)) throw new Error('expected blueprint');

    const graph = buildRailGraph(document.blueprint.entities ?? []);
    expect(graph.nodes.filter((node) => node.entityNumbers.length === 1)).toHaveLength(12);
    expect(
      document.blueprint.entities?.filter(
        (entity) =>
          entity.name === 'straight-rail' &&
          (entity.direction ?? 0) === 0 &&
          [27, 39, 51, 161, 173].includes(entity.position.x),
      ),
    ).not.toHaveLength(0);
  });
});
