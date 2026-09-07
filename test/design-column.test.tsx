// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { DesignColumn } from '../src/components/design/design-column.tsx';

afterEach(cleanup);

describe('DesignColumn', () => {
  it('draws assemblers at their tile position and size', () => {
    render(
      <DesignColumn
        index={0}
        column={{
          entities: [
            {
              kind: 'assembler',
              recipe: 'copper-cable',
              position: { x: 8, y: 4 },
              size: { width: 3, height: 2 },
            },
          ],
        }}
        entries={[]}
        counts={[]}
        progress={0}
        onChange={() => undefined}
      />,
    );

    const assembler = screen.getByRole('img', { name: 'Copper wire assembler at 8, 4' });
    expect(assembler.style.gridColumn).toBe('9 / span 3');
    expect(assembler.style.gridRow).toBe('5 / span 2');
    expect(assembler.querySelector('.cell-design-assembler-icon')).not.toBeNull();
  });

  it('does not draw unsupported entity kinds as assemblers', () => {
    render(
      <DesignColumn
        index={0}
        column={{ entities: [{ kind: 'belt', position: { x: 1, y: 2 }, direction: 'east' }] }}
        entries={[]}
        counts={[]}
        progress={0}
        onChange={() => undefined}
      />,
    );

    expect(screen.queryByRole('img')).toBeNull();
  });
});
