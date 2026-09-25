// @vitest-environment happy-dom

import { cleanup, render, screen } from '@testing-library/preact';
import { afterEach, describe, expect, it } from 'vitest';
import { DatasetProvider, useDataset } from '../src/dataset/context.tsx';
import { createDataset } from '../src/dataset/index.ts';
import { machinesFor } from '../src/data/machines.ts';
import { categoryEffect, chosenModules, modulesIn } from '../src/data/modules.ts';
import { chosenBeacon, chosenBelt, defaultBeacon, defaultBelt } from '../src/data/index.ts';
import { FlowSummary } from '../src/components/recipe-flow-summary.tsx';
import { defaultDataset } from './with-bobang.ts';

afterEach(cleanup);

const { data, iconMap } = defaultDataset;

function DatasetLabel() {
  return <span>{useDataset().id}</span>;
}

describe('useDataset', () => {
  it('returns the provider value', () => {
    const selected = createDataset('example-revision', { staticData: data, iconMap });
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

  it('uses the selected dataset for names in recipe flows', () => {
    const resource = 'item:iron-plate' as const;
    const selected = createDataset('renamed', {
      iconMap,
      staticData: {
        ...data,
        resources: {
          ...data.resources,
          [resource]: { ...data.resources[resource], human: 'Custom iron' },
        },
      },
    });
    render(
      <DatasetProvider value={selected}>
        <FlowSummary ins={[]} outs={[{ resource, amount: '1', fullRate: 1, rate: '1' }]} />
      </DatasetProvider>,
    );

    expect(screen.getByTitle('Custom iron: 1 per craft')).toBeTruthy();
  });
});

describe('createDataset', () => {
  it('precomputes progress landmarks, beacons, and belts for each dataset', () => {
    const beacon = defaultDataset.data.beacons['beacon'];
    const belt = defaultDataset.data.belts['transport-belt'];
    const first = createDataset('first', {
      iconMap,
      staticData: {
        ...data,
        sciencePacks: ['item:automation-science-pack'],
        beacons: { first: { ...beacon, item: 'beacon' } },
        belts: { first: { ...belt, item: 'transport-belt' } },
      },
    });
    const second = createDataset('second', {
      iconMap,
      staticData: {
        ...data,
        sciencePacks: ['item:logistic-science-pack'],
        beacons: { second: { ...beacon, item: 'beacon' } },
        belts: { second: { ...belt, item: 'transport-belt' } },
      },
    });

    expect(first.packLandmarks.map(({ id }) => id)).toEqual(['item:automation-science-pack']);
    expect(second.packLandmarks.map(({ id }) => id)).toEqual(['item:logistic-science-pack']);
    expect(defaultBeacon(first, 1)?.id).toBe('first');
    expect(defaultBeacon(second, 1)?.id).toBe('second');
    expect(chosenBeacon(first, undefined, 1)).toBe(first.data.beacons.first);
    expect(defaultBelt(first, 1).id).toBe('first');
    expect(defaultBelt(second, 1).id).toBe('second');
    expect(chosenBelt(second, undefined, 1)).toBe(second.data.belts.second);
  });

  it('builds module families from each dataset’s modules', () => {
    const speedModule = defaultDataset.data.modules['speed-module'];
    const fasterModule = defaultDataset.data.modules['speed-module-2'];
    const first = createDataset('first', {
      iconMap,
      staticData: {
        ...data,
        modules: { 'speed-module': { ...speedModule, category: 'first-family' } },
      },
    });
    const second = createDataset('second', {
      iconMap,
      staticData: {
        ...data,
        modules: { 'speed-module-2': { ...fasterModule, category: 'second-family' } },
      },
    });

    expect(first.moduleCategories.map(({ id }) => id)).toEqual(['first-family']);
    expect(second.moduleCategories.map(({ id }) => id)).toEqual(['second-family']);
    expect(modulesIn(first, 'first-family').map(({ id }) => id)).toEqual(['speed-module']);
    expect(modulesIn(second, 'first-family')).toEqual([]);
    expect(categoryEffect(first, 'first-family')).toBe('speed');
    expect(chosenModules(first, {}, 1)).toEqual({ 'first-family': 'speed-module' });
    expect(chosenModules(second, {}, 1)).toEqual({ 'second-family': 'speed-module-2' });
  });

  it('indexes machines from the selected dataset', () => {
    const machine = Object.values(defaultDataset.data.machines)[0]!;
    const recipe = { ...defaultDataset.data.recipes['iron-plate'], categories: ['example'] };
    const first = createDataset('first', {
      iconMap,
      staticData: {
        ...data,
        machines: { first: { ...machine, categories: ['example'] } },
      },
    });
    const second = createDataset('second', {
      iconMap,
      staticData: {
        ...data,
        machines: { second: { ...machine, categories: ['example'] } },
      },
    });

    expect(machinesFor(first, recipe).map(({ id }) => id)).toEqual(['first']);
    expect(machinesFor(second, recipe).map(({ id }) => id)).toEqual(['second']);
  });

  it('builds the sole-producer index from each dataset’s recipes', () => {
    const recipe = defaultDataset.data.recipes['iron-plate'];
    const first = createDataset('first', {
      iconMap,
      staticData: {
        ...data,
        recipes: { first: recipe },
      },
    });
    const second = createDataset('second', {
      iconMap,
      staticData: {
        ...data,
        recipes: { second: recipe },
      },
    });

    expect(first.soleProducerByResource.get('item:iron-plate')).toBe('first');
    expect(second.soleProducerByResource.get('item:iron-plate')).toBe('second');
    expect(first.suggestionPlans.soleProducer.get('item:iron-plate')).toBe('first');
    expect(second.suggestionPlans.soleProducer.get('item:iron-plate')).toBe('second');
  });
});
