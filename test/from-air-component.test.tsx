// @vitest-environment happy-dom

import { render, screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { useState } from 'preact/hooks';
import { describe, expect, it } from 'vitest';
import { FromAir } from '../src/components/from-air.tsx';
import type { UrlState } from '../src/url-handler.tsx';

function FromAirExample() {
  const mode = useState<UrlState['fa']>(true);
  return (
    <>
      <FromAir mode={mode} />
      <output>{mode[0] === true ? 'ordinary' : mode[0]}</output>
    </>
  );
}

describe('FromAir', () => {
  it('stores infinite mining as a from-air URL mode', async () => {
    const user = userEvent.setup();
    render(<FromAirExample />);

    const checkbox = screen.getByRole('checkbox', { name: 'Allow infinite mining recipes' });
    await user.click(checkbox);
    expect(screen.getByRole('status').textContent).toBe('infinite-mining');

    await user.click(checkbox);
    expect(screen.getByRole('status').textContent).toBe('ordinary');
  });
});
