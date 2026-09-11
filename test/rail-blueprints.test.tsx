// @vitest-environment happy-dom

import { fireEvent, render, screen, within } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { describe, expect, it } from 'vitest';
import { decodeDocument } from '../src/bp/decode.ts';
import { buildRailGraph } from '../src/bp/rail.ts';
import { RailBlueprints } from '../src/components/rail-blueprints.tsx';

describe('RailBlueprints', () => {
  it('renders a radar with the URL-state station counts', () => {
    const { container } = render(<RailBlueprints size={[3, 2]} onSizeChange={() => [3, 2]} />);

    expect(screen.getByRole('heading', { name: 'Rail blueprints' })).toBeTruthy();
    expect(screen.getByRole('img', { name: /3 input and 2 output stations/ })).toBeTruthy();
    expect(container.querySelector('[data-blueprint-station="input:3"]')?.getAttribute('cx')).toBe(
      '34',
    );
    expect(
      container.querySelector('.rail-blueprint-preview-path')?.getAttribute('d'),
    ).not.toContain('M 4 13 c 0 6, 4 7, 4 11 l 0 80');

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

  it('changes either station count with its ticked slider', () => {
    function TestRailBlueprints() {
      const [size, setSize] = useState<[number, number]>([3, 2]);
      return <RailBlueprints size={size} onSizeChange={setSize} />;
    }

    const { container } = render(<TestRailBlueprints />);
    const view = within(container as HTMLElement);

    const input = view.getByRole<HTMLInputElement>('slider', { name: 'Input stations: 3' });
    const output = view.getByRole<HTMLInputElement>('slider', { name: 'Output stations: 2' });
    expect(input.min).toBe('0');
    expect(input.max).toBe('12');
    expect(input.getAttribute('list')).toBe('rail-blueprints-count-ticks');
    expect(container.querySelectorAll('#rail-blueprints-count-ticks option')).toHaveLength(13);

    fireEvent.input(input, { target: { value: '12' } });
    fireEvent.input(output, { target: { value: '0' } });

    expect(
      view.getByText('Standard rail brick with twelve input and zero output stations.'),
    ).toBeTruthy();
  });
});
