// @vitest-environment happy-dom

import { render, screen, cleanup } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { DatasetProvider, useDataset } from '../src/dataset/context.tsx';
import { createDataset, defaultDataset } from '../src/dataset/index.ts';

afterEach(cleanup);

function DatasetLabel() {
  return <span>{useDataset().id}</span>;
}

describe('useDataset', () => {
  it('returns the provider value', () => {
    const selected = createDataset('example-revision', defaultDataset.data);
    render(
      <DatasetProvider value={selected}>
        <DatasetLabel />
      </DatasetProvider>,
    );

    expect(screen.getByText(selected.id)).toBeTruthy();
  });

  it('throws a clear error without a provider', () => {
    expect(() => render(<DatasetLabel />)).toThrow(
      'useDataset must be used inside DatasetProvider',
    );
  });
});
