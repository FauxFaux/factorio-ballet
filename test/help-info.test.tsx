// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { useState } from 'preact/hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HelpInfo } from '../src/components/help-info.tsx';

describe('HelpInfo', () => {
  afterEach(cleanup);

  it('opens from its icon and closes on Escape', async () => {
    const user = userEvent.setup();
    render(<HelpInfo label="About widgets">Widget help</HelpInfo>);

    await user.click(screen.getByRole('button', { name: 'About widgets' }));
    expect(screen.getByRole('dialog', { name: 'About widgets' }).textContent).toContain(
      'Widget help',
    );

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'About widgets' }));
    await user.click(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('requires explicit dismissal when opened by application code', async () => {
    const dismissed = vi.fn();
    const user = userEvent.setup();

    function Example() {
      const [open, setOpen] = useState(true);
      return (
        <HelpInfo
          label="Tutorial step"
          open={open}
          onDismiss={() => {
            dismissed();
            setOpen(false);
          }}
        >
          Follow this step
        </HelpInfo>
      );
    }

    render(<Example />);
    await user.keyboard('{Escape}');
    await user.click(document.body);
    expect(screen.getByRole('dialog', { name: 'Tutorial step' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(dismissed).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
