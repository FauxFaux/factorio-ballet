// @vitest-environment happy-dom

import { render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { RailBlueprints } from '../src/components/rail-blueprints.tsx';

describe('RailBlueprints', () => {
  it('renders a radar with the URL-state station counts', () => {
    render(<RailBlueprints size={[3, 2]} />);

    expect(screen.getByRole('heading', { name: 'Rail blueprints' })).toBeTruthy();
    expect(screen.getByRole('img', { name: /3 input and 2 output stations/ })).toBeTruthy();
  });
});
