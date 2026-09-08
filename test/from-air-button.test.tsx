// @vitest-environment happy-dom

import { render, screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { useState } from 'preact/hooks';
import { describe, expect, it } from 'vitest';
import { FromAirButton } from '../src/components/from-air-button.tsx';
import type { UrlState } from '../src/url-handler.tsx';

const initialState: UrlState = { v: 1, rs: '', cs: '', gp: 0, cl: [], ci: 0, mo: {} };

function FromAirButtonExample() {
  const uss = useState(initialState);
  return (
    <>
      <FromAirButton uss={uss} />
      <output>{uss[0].fa ? 'from air' : 'normal'}</output>
    </>
  );
}

describe('FromAirButton', () => {
  it('enters from-air mode', async () => {
    const user = userEvent.setup();
    render(<FromAirButtonExample />);

    await user.click(screen.getByTitle('Plan from air'));

    expect(screen.getByRole('status').textContent).toBe('from air');
  });
});
