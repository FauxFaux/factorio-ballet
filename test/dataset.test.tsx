// @vitest-environment happy-dom

import { render, screen, cleanup } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { DatasetProvider, useDataset } from '../src/dataset/context.tsx';
import { createDataset, defaultDataset } from '../src/dataset/index.ts';
import { machinesFor } from '../src/data/machines.ts';

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

describe('createDataset', () => {
  it('indexes machines from the selected dataset', () => {
    const machine = Object.values(defaultDataset.data.machines)[0]!;
    const recipe = { ...defaultDataset.data.recipes['iron-plate'], categories: ['example'] };
    const first = createDataset('first', {
      ...defaultDataset.data,
      machines: { first: { ...machine, categories: ['example'] } },
    });
    const second = createDataset('second', {
      ...defaultDataset.data,
      machines: { second: { ...machine, categories: ['example'] } },
    });

    expect(machinesFor(first, recipe).map(({ id }) => id)).toEqual(['first']);
    expect(machinesFor(second, recipe).map(({ id }) => id)).toEqual(['second']);
  });

  it('builds the sole-producer index from each dataset’s recipes', () => {
    const recipe = defaultDataset.data.recipes['iron-plate'];
    const first = createDataset('first', {
      ...defaultDataset.data,
      recipes: { first: recipe },
    });
    const second = createDataset('second', {
      ...defaultDataset.data,
      recipes: { second: recipe },
    });

    expect(first.soleProducerByResource.get('item:iron-plate')).toBe('first');
    expect(second.soleProducerByResource.get('item:iron-plate')).toBe('second');
    expect(first.suggestionPlans.soleProducer.get('item:iron-plate')).toBe('first');
    expect(second.suggestionPlans.soleProducer.get('item:iron-plate')).toBe('second');
  });
});
