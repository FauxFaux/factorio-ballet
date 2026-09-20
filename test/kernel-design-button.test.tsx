// @vitest-environment happy-dom

import { render, screen } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { useState } from 'preact/hooks';
import { describe, expect, it } from 'vitest';
import { KernelDesignButton } from '../src/components/kernel-design-button.tsx';
import type { UrlState } from '../src/url-handler.tsx';

const initialState: UrlState = { v: 1, cs: '', gp: 0, cl: [], ci: 0, mo: {} };

function KernelDesignButtonExample() {
  const uss = useState(initialState);
  return (
    <>
      <KernelDesignButton uss={uss} />
      <output>{uss[0].kd ? 'kernel design' : 'normal'}</output>
    </>
  );
}

describe('KernelDesignButton', () => {
  it('toggles the kernel-design URL state', async () => {
    const user = userEvent.setup();
    render(<KernelDesignButtonExample />);

    await user.click(screen.getByTitle('Design kernel'));
    expect(screen.getByRole('status').textContent).toBe('kernel design');

    await user.click(screen.getByTitle('Design kernel'));
    expect(screen.getByRole('status').textContent).toBe('normal');
  });
});
