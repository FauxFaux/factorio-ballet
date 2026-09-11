// @vitest-environment happy-dom

import { fireEvent, render, screen, within } from '@testing-library/preact';
import { useState } from 'preact/hooks';
import { describe, expect, it, vi } from 'vitest';
import { decodeDocument } from '../src/bp/decode.ts';
import { buildRailGraph, findStackedRailLayout } from '../src/bp/rail.ts';
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

  it('copies the blueprint and clears its confirmation when the pointer leaves', () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
    const { container } = render(<RailBlueprints size={[3, 2]} onSizeChange={() => [3, 2]} />);
    const view = within(container as HTMLElement);

    const copy = view.getByRole('button', { name: 'Copy' });
    fireEvent.click(copy);

    expect(writeText).toHaveBeenCalledWith(
      view.getByRole<HTMLTextAreaElement>('textbox', { name: 'Blueprint' }).value,
    );
    expect(view.getByRole('button', { name: 'Copied!' })).toBeTruthy();

    fireEvent.mouseOut(copy);
    expect(view.getByRole('button', { name: 'Copy' })).toBeTruthy();
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
    expect(input.max).toBe('16');
    expect(input.getAttribute('list')).toBe('rail-blueprints-count-ticks');
    expect(container.querySelectorAll('#rail-blueprints-count-ticks option')).toHaveLength(17);

    fireEvent.input(output, { target: { value: '0' } });
    fireEvent.input(input, { target: { value: '16' } });

    expect(
      view.getByText('Standard rail brick with sixteen input and zero output stations.'),
    ).toBeTruthy();
  });

  it('limits the combined input and output station count to sixteen', () => {
    function TestRailBlueprints() {
      const [size, setSize] = useState<[number, number]>([3, 2]);
      return <RailBlueprints size={size} onSizeChange={setSize} />;
    }

    const { container } = render(<TestRailBlueprints />);
    const view = within(container as HTMLElement);
    const input = view.getByRole<HTMLInputElement>('slider', { name: 'Input stations: 3' });
    const output = view.getByRole<HTMLInputElement>('slider', { name: 'Output stations: 2' });

    fireEvent.input(input, { target: { value: '16' } });
    fireEvent.input(output, { target: { value: '16' } });

    expect(
      view.getByText('Standard rail brick with fourteen input and two output stations.'),
    ).toBeTruthy();
  });

  it('stores stacked inputs as negative counts and previews their stations vertically', () => {
    function TestRailBlueprints() {
      const [size, setSize] = useState<[number, number]>([3, 2]);
      return <RailBlueprints size={size} onSizeChange={setSize} />;
    }

    const { container } = render(<TestRailBlueprints />);
    const view = within(container as HTMLElement);
    const stacked = view.getAllByRole<HTMLInputElement>('checkbox', { name: 'Stacked' });

    expect(stacked).toHaveLength(1);
    fireEvent.click(stacked[0]);

    expect(screen.getByRole('img', { name: /3 stacked input and 2 output stations/ })).toBeTruthy();
    expect(container.querySelector('[data-blueprint-station="input:1"]')?.getAttribute('cx')).toBe(
      '48',
    );
    expect(container.querySelector('[data-blueprint-station="input:2"]')?.getAttribute('cy')).toBe(
      '102',
    );
    expect(container.querySelector('[data-blueprint-station="output:1"]')?.getAttribute('cx')).toBe(
      '182',
    );
    const path = container.querySelector('.rail-blueprint-preview-path')?.getAttribute('d');
    expect(path).toContain('M 60 100 l 0 12 c 0 7, 8 11, 16 11');
    expect(path).not.toContain('M 132 110 l 0 2 c 0 7, -8 11, -16 11');

    const encoded = view.getByRole<HTMLTextAreaElement>('textbox', { name: 'Blueprint' }).value;
    const document = decodeDocument(encoded);
    expect(document).toHaveProperty('blueprint.label', '3 stacked input, 2 output rail brick');
    if (!('blueprint' in document)) throw new Error('expected blueprint');
    expect(
      findStackedRailLayout(
        document.blueprint.entities?.filter((entity) => entity.position.x < 100) ?? [],
      ).rows,
    ).toHaveLength(3);
    expect(
      document.blueprint.entities?.some(
        (entity) =>
          entity.name === 'straight-rail' &&
          (entity.direction ?? 0) === 0 &&
          entity.position.x === 197,
      ),
    ).toBe(true);
  });

  it('reads negative URL-state counts as stacked and keeps their sign when sliding', () => {
    function TestRailBlueprints() {
      const [size, setSize] = useState<[number, number]>([-3, 2]);
      return <RailBlueprints size={size} onSizeChange={setSize} />;
    }

    const { container } = render(<TestRailBlueprints />);
    const view = within(container as HTMLElement);
    const input = view.getByRole<HTMLInputElement>('slider', { name: 'Input stations: 3' });

    expect(view.getAllByRole<HTMLInputElement>('checkbox', { name: 'Stacked' })[0].checked).toBe(
      true,
    );
    fireEvent.input(input, { target: { value: '4' } });
    expect(
      screen.getByText('Standard rail brick with four stacked input and two output stations.'),
    ).toBeTruthy();
  });

  it('caps the stacked side at nine and the unstacked side at eleven in a mixed layout', () => {
    function TestRailBlueprints() {
      const [size, setSize] = useState<[number, number]>([-3, 2]);
      return <RailBlueprints size={size} onSizeChange={setSize} />;
    }

    const { container } = render(<TestRailBlueprints />);
    const view = within(container as HTMLElement);
    const input = view.getByRole<HTMLInputElement>('slider', { name: 'Input stations: 3' });
    const output = view.getByRole<HTMLInputElement>('slider', { name: 'Output stations: 2' });

    fireEvent.input(input, { target: { value: '16' } });
    fireEvent.input(output, { target: { value: '16' } });

    expect(
      screen.getByText('Standard rail brick with nine stacked input and eleven output stations.'),
    ).toBeTruthy();
    expect(input.max).toBe('9');
    expect(output.max).toBe('11');
  });

  it('keeps stacked counts between two and nine, including when enabled from zero', () => {
    function TestRailBlueprints() {
      const [size, setSize] = useState<[number, number]>([0, 2]);
      return <RailBlueprints size={size} onSizeChange={setSize} />;
    }

    const { container } = render(<TestRailBlueprints />);
    const view = within(container as HTMLElement);
    const inputStacked = view.getAllByRole<HTMLInputElement>('checkbox', { name: 'Stacked' })[0];

    expect(inputStacked.disabled).toBe(false);
    fireEvent.click(inputStacked);

    const input = view.getByRole<HTMLInputElement>('slider', { name: 'Input stations: 2' });
    expect(input.min).toBe('2');
    expect(input.max).toBe('9');

    fireEvent.input(input, { target: { value: '0' } });
    expect(
      screen.getByText('Standard rail brick with two stacked input and two output stations.'),
    ).toBeTruthy();
    expect(inputStacked.checked).toBe(true);
  });

  it('recommends stacked layout for six or more unstacked stations', () => {
    function TestRailBlueprints() {
      const [size, setSize] = useState<[number, number]>([6, 5]);
      return <RailBlueprints size={size} onSizeChange={setSize} />;
    }

    const { container } = render(<TestRailBlueprints />);
    const view = within(container as HTMLElement);
    const stacked = view.getAllByRole<HTMLInputElement>('checkbox', { name: 'Stacked' });

    expect(stacked[0].closest('label')?.classList).toContain('rail-blueprints-stacked-recommended');

    fireEvent.click(stacked[0]);
    expect(stacked[0].closest('label')?.classList).not.toContain(
      'rail-blueprints-stacked-recommended',
    );
  });
});
