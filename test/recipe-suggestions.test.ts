import { describe, expect, it } from 'vitest';
import { newCell } from '../src/cell.ts';
import {
  scoreRecipeSuggestion,
  suggestedResourceChains,
  suggestedRecipePaths,
  suggestedVoidResources,
} from '../src/components/recipe-suggestions/recipe-suggestions.tsx';

const waste = 'fluid:angels-water-yellow-waste' as const;

describe('suggestedVoidResources', () => {
  it('includes the resource targeted by a uses search', () => {
    expect(suggestedVoidResources(`uses:${waste}`)).toEqual([waste]);
  });

  it('includes cell outputs, including those named by uses:@out only once', () => {
    const cell = newCell('empty-angels-water-yellow-waste-barrel');
    const suggestions = suggestedVoidResources('uses:@out', cell);

    expect(suggestions).toContain(waste);
    expect(suggestions.filter((resource) => resource === waste)).toHaveLength(1);
  });
});

describe('suggestedResourceChains', () => {
  it('turns a cell output into one of its current inputs', () => {
    const cell = {
      entries: [{ recipe: 'angels-ore1-chunk' }, { recipe: 'angels-ore1-crystal' }],
    };

    const chains = suggestedResourceChains(cell).get(waste) ?? [];

    expect(chains).toContainEqual({
      target: 'fluid:angels-liquid-sulfuric-acid',
      recipes: [
        'angels-yellow-waste-water-purification',
        'angels-gas-sulfur-dioxide',
        'angels-liquid-sulfuric-acid',
      ],
      inputs: ['fluid:angels-gas-oxygen'],
      outputs: ['fluid:angels-water-mineralized'],
    });
  });
});

describe('scoreRecipeSuggestion', () => {
  it('rewards a chain for supplying an input the cell currently needs', () => {
    const plan = {
      target: 'item:iron-plate',
      recipes: ['first', 'second', 'third'],
      inputs: [],
      outputs: [],
    };

    expect(scoreRecipeSuggestion(plan, new Set(['item:iron-plate']), new Set())).toBeGreaterThan(
      scoreRecipeSuggestion(plan, new Set(), new Set()),
    );
  });

  it('rewards chains which join the cell interface over equally long alternatives', () => {
    const connected = {
      target: 'item:iron-plate',
      recipes: ['first', 'second'],
      inputs: ['item:coal'],
      outputs: ['item:stone'],
    };
    const disconnected = { ...connected, inputs: ['item:wood'], outputs: ['item:fish'] };

    expect(
      scoreRecipeSuggestion(connected, new Set(['item:coal']), new Set(['item:stone'])),
    ).toBeGreaterThan(scoreRecipeSuggestion(disconnected, new Set(), new Set()));
  });
});

describe('suggestedRecipePaths', () => {
  it('puts a chain which supplies a cell input ahead of a shorter void route', () => {
    const paths = suggestedRecipePaths(`uses:${waste}`, {
      entries: [{ recipe: 'angels-ore1-chunk' }, { recipe: 'angels-ore1-crystal' }],
    });

    const sulfuricAcid = paths.find(
      (path) =>
        path.kind === 'chain' &&
        'target' in path.plan &&
        path.plan.target === 'fluid:angels-liquid-sulfuric-acid',
    );
    const clarifier = paths.find((path) => path.kind === 'void' && path.plan.recipes.length === 1);

    expect(sulfuricAcid?.score).toBeGreaterThan(clarifier?.score ?? Infinity);
  });

  it('treats products one free air-processing step away as available inputs', () => {
    const paths = suggestedRecipePaths(`uses:${waste}`, {
      entries: [{ recipe: 'angels-ore1-chunk' }, { recipe: 'angels-ore1-crystal' }],
    });
    const sulfuricAcid = paths.find(
      (path) =>
        path.kind === 'chain' &&
        'target' in path.plan &&
        path.plan.target === 'fluid:angels-liquid-sulfuric-acid',
    );

    expect(sulfuricAcid?.plan).toMatchObject({ inputs: ['fluid:angels-gas-oxygen'] });
    expect(sulfuricAcid?.score).toBeCloseTo(3.36);
  });

  it('limits the combined path suggestions to the ten best candidates', () => {
    const paths = suggestedRecipePaths(`uses:${waste}`);

    expect(paths.length).toBeLessThanOrEqual(10);
    expect(paths.map((path) => path.score)).toEqual(
      [...paths.map((path) => path.score)].sort((a, b) => b - a),
    );
  });
});
