// @vitest-environment happy-dom

import { render, screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { useState } from 'preact/hooks';
import { describe, expect, it } from 'vitest';
import { RailBlueprintButton } from '../src/components/rail-blueprint-button.tsx';
import type { UrlState } from '../src/url-handler.tsx';

const initialState: UrlState = { v: 1, cs: '', gp: 0, cl: [], ci: 0, mo: {} };

function RailBlueprintButtonExample() {
  const uss = useState(initialState);
  return (
    <>
      <RailBlueprintButton uss={uss} />
      <output>{uss[0].rb?.join(',') ?? 'normal'}</output>
    </>
  );
}

describe('RailBlueprintButton', () => {
  it('toggles the standard rail-blueprint URL state', async () => {
    const user = userEvent.setup();
    render(<RailBlueprintButtonExample />);

    await user.click(screen.getByTitle('Show rail blueprint'));
    expect(screen.getByRole('status').textContent).toBe('3,2');

    await user.click(screen.getByTitle('Show rail blueprint'));
    expect(screen.getByRole('status').textContent).toBe('normal');
  });
});
