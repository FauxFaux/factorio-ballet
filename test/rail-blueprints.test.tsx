// @vitest-environment happy-dom

import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
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
  });
});
