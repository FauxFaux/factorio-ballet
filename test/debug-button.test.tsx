// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { useState } from 'preact/hooks';
import { afterEach, describe, expect, it } from 'vitest';
import { DebugButton } from '../src/components/debug-button.tsx';
import type { UrlState } from '../src/url-handler.tsx';

const initialState: UrlState = { v: 1, cs: '', gp: 0, cl: [], ci: 0, mo: {} };

function DebugButtonExample() {
  const uss = useState(initialState);
  return (
    <>
      <DebugButton uss={uss} />
      <output>{uss[0].cs}</output>
    </>
  );
}

describe('DebugButton', () => {
  afterEach(cleanup);

  it('replaces the URL state when its JSON is valid', async () => {
    const user = userEvent.setup();
    render(<DebugButtonExample />);

    await user.click(screen.getByTitle('Show UrlState JSON'));
    const json = screen.getByRole('textbox');
    await user.clear(json);
    await user.paste(JSON.stringify({ ...initialState, cs: 'iron-ore' }));

    expect(screen.getByRole('status').textContent).toBe('iron-ore');
  });

  it('does not replace the URL state with malformed JSON', async () => {
    const user = userEvent.setup();
    render(<DebugButtonExample />);

    await user.click(screen.getByTitle('Show UrlState JSON'));
    const json = screen.getByRole('textbox');
    await user.clear(json);
    await user.paste('{');

    expect(screen.getByRole('status').textContent).toBe('');
  });
});
