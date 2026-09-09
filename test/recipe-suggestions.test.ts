// @vitest-environment happy-dom

import { cleanup, render, within } from '@testing-library/preact';
import userEvent from '@testing-library/user-event';
import { h } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cellInterface, newCell } from '../src/cell.ts';
import { RecipeSuggestions } from '../src/components/recipe-suggestions/recipe-suggestions.tsx';
import { resourceName } from '../src/data/index.ts';
import { isBarrelling, isUnbarrelling } from '../src/data/recipes.ts';
import { staticData } from '../src/data/decode.ts';
import {
  scoreRecipeSuggestion,
  suggestedResourceChains,
  suggestedRecipePaths,
  suggestedFewProducerInputs,
  suggestedFreeInputs,
  suggestedSoleConsumerOutputs,
  suggestedSoleProducerInputs,
  suggestedVoidResources,
  suggestionScoreWeights,
} from '../src/components/recipe-suggestions/suggestions.ts';

const waste = 'fluid:angels-water-yellow-waste' as const;

afterEach(cleanup);

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

describe('single-recipe interface suggestions', () => {
  it('suggests the sole recipe which can make a required input', () => {
    const suggestions = suggestedSoleProducerInputs({
      entries: [{ recipe: 'speed-module-3' }],
    });

    expect(suggestions).toContainEqual(
      expect.objectContaining({
        target: 'item:speed-module-2',
        recipes: ['speed-module-2'],
      }),
    );
  });

  it('does not count fluid unbarrelling as a competing producer', () => {
    const nitrogen = 'fluid:angels-gas-nitrogen' as const;
    const suggestions = suggestedSoleProducerInputs({
      entries: [{ recipe: 'bob-silicon-nitride' }],
    });

    expect(cellInterface({ entries: [{ recipe: 'bob-silicon-nitride' }] }).inputs).toContain(
      nitrogen,
    );
    expect(suggestions).toContainEqual(
      expect.objectContaining({ target: nitrogen, recipes: ['angels-air-separation'] }),
    );
  });

  it('suggests the sole recipe which can use an output', () => {
    const suggestions = suggestedSoleConsumerOutputs({
      entries: [{ recipe: 'bob-speed-processor' }],
    });

    expect(suggestions).toContainEqual(
      expect.objectContaining({
        target: 'item:bob-speed-processor',
        recipes: ['speed-module-2'],
      }),
    );
  });

  it('gives a sole consumer a high certainty score', () => {
    const paths = suggestedRecipePaths('', { entries: [{ recipe: 'bob-speed-processor' }] });
    const soleConsumer = paths.find(
      (path) => path.kind === 'output' && path.resource === 'item:bob-speed-processor',
    );

    expect(soleConsumer?.scoreFactors.certainty).toBe(suggestionScoreWeights.soleProducer);
  });
});

describe('free input suggestions', () => {
  it('suggests the no-cost recipe chain for water and steam inputs', () => {
    expect(suggestedFreeInputs({ entries: [{ recipe: 'angels-steam-water' }] })).toContainEqual({
      target: 'fluid:water',
      recipes: ['synthetic:pumping-water'],
      inputs: [],
      outputs: [],
    });
    expect(
      suggestedFreeInputs({ entries: [{ recipe: 'angels-water-gas-shift-1' }] }),
    ).toContainEqual(
      expect.objectContaining({
        target: 'fluid:steam',
        recipes: ['synthetic:pumping-water', 'angels-steam-water'],
        inputs: [],
      }),
    );
  });

  it('puts a free chain ahead of ordinary ways to supply the same cell input', () => {
    const paths = suggestedRecipePaths('', { entries: [{ recipe: 'angels-water-gas-shift-1' }] });
    const steam = paths.find(
      (path) =>
        path.kind === 'input' &&
        path.resource === 'fluid:steam' &&
        path.plan.recipes.join('|') === 'synthetic:pumping-water|angels-steam-water',
    );

    expect(steam?.scoreFactors.certainty).toBe(suggestionScoreWeights.freeInput);
    expect(steam).toEqual(paths[0]);
  });
});

describe('few-recipe interface suggestions', () => {
  it('suggests each producer for inputs with two or three possible recipes', () => {
    const copperCable = suggestedFewProducerInputs({
      entries: [{ recipe: 'small-electric-pole' }],
    });
    const ironPlate = suggestedFewProducerInputs({ entries: [{ recipe: 'gun-turret' }] });

    expect(copperCable).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: 'item:copper-cable', recipes: ['copper-cable'] }),
        expect.objectContaining({
          target: 'item:copper-cable',
          recipes: ['angels-wire-copper-2'],
        }),
      ]),
    );
    expect(ironPlate).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: 'item:iron-plate', recipes: ['iron-plate'] }),
        expect.objectContaining({
          target: 'item:iron-plate',
          recipes: ['angels-plate-iron'],
        }),
        expect.objectContaining({
          target: 'item:iron-plate',
          recipes: ['angels-plate-iron-2'],
        }),
      ]),
    );
  });
});

describe('scoreRecipeSuggestion', () => {
  it('gives two- and three-recipe alternatives progressively lower certainty scores', () => {
    const plan = { recipes: ['first'] };
    const base = scoreRecipeSuggestion(plan, new Set(), new Set());

    expect(scoreRecipeSuggestion(plan, new Set(), new Set(), undefined, 2) - base).toBe(
      suggestionScoreWeights.twoRecipes,
    );
    expect(scoreRecipeSuggestion(plan, new Set(), new Set(), undefined, 3) - base).toBe(
      suggestionScoreWeights.threeRecipes,
    );
    expect(suggestionScoreWeights.twoRecipes).toBeGreaterThan(suggestionScoreWeights.threeRecipes);
    expect(suggestionScoreWeights.twoRecipes).toBeLessThan(suggestionScoreWeights.soleProducer);
  });

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

  it('charges every required input, including zero-complexity resources', () => {
    const plan = {
      target: 'item:electronic-circuit' as const,
      recipes: [],
      inputs: [
        'item:bob-wooden-board' as const,
        'item:bob-basic-electronic-components' as const,
        'item:bob-solder' as const,
      ],
      outputs: [],
    };

    expect(scoreRecipeSuggestion(plan, new Set(), new Set())).toBeCloseTo(-19.935);
  });

  it('shows the supplied-input bonus as an output score factor', () => {
    const paths = suggestedRecipePaths('', { entries: [{ recipe: 'speed-module-3' }] });
    const suggestion = paths.find(
      (path) => path.kind === 'input' && path.resource === 'item:speed-module-2',
    );

    expect(suggestion?.scoreFactors.outputs).toBe(suggestionScoreWeights.suppliedInput);
    expect(suggestion?.scoreFactors.inputs).toBeLessThan(0);
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

  it('does not penalize a side product which can be voided in one step', () => {
    const plan = {
      target: 'item:iron-plate',
      recipes: ['first'],
      inputs: [],
      outputs: [waste],
    };

    expect(scoreRecipeSuggestion(plan, new Set(), new Set())).toBe(
      scoreRecipeSuggestion({ ...plan, outputs: [] }, new Set(), new Set()),
    );
  });

  it('penalizes a returned catalyst that is not already at the cell boundary', () => {
    const plan = { recipes: ['angels-ore8-powder'] };
    const catalyst = 'item:angels-milling-drum';

    expect(scoreRecipeSuggestion(plan, new Set(), new Set())).toBeLessThan(
      scoreRecipeSuggestion(plan, new Set(), new Set([catalyst])),
    );
  });

  it('recognizes a returned ingredient as a catalyst even without productivity metadata', () => {
    const plan = { recipes: ['angels-water-enriched-cooling-1'] };
    const catalyst = 'fluid:angels-liquid-water-semiheavy-1';

    expect(scoreRecipeSuggestion(plan, new Set(), new Set())).toBeLessThan(
      scoreRecipeSuggestion(plan, new Set(), new Set([catalyst])),
    );
  });
});

describe('suggestedRecipePaths', () => {
  it('gives void suggestions an additional certainty score', () => {
    const paths = suggestedRecipePaths(`uses:${waste}`);
    const voidSuggestion = paths.find((path) => path.kind === 'void');

    expect(voidSuggestion?.scoreFactors.certainty).toBe(suggestionScoreWeights.void);
  });

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

    expect(sulfuricAcid).toBeDefined();
    if (clarifier) expect(sulfuricAcid!.score).toBeGreaterThan(clarifier.score);
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
    expect(sulfuricAcid?.score).toBeCloseTo(1.36);
  });

  it('limits the combined path suggestions to the ten best candidates', () => {
    const paths = suggestedRecipePaths(`uses:${waste}`);

    expect(paths.length).toBeLessThanOrEqual(10);
    expect(paths.map((path) => path.score)).toEqual(
      [...paths.map((path) => path.score)].sort((a, b) => b - a),
    );
  });

  it('excludes barrel conversion recipes from void recommendations', () => {
    const water = 'fluid:water' as const;
    const paths = suggestedRecipePaths(`uses:${water}`);

    expect(paths.flatMap((path) => path.plan.recipes)).not.toContain('water-barrel');
    expect(paths.flatMap((path) => path.plan.recipes)).not.toContain('empty-water-barrel');
    expect(
      paths
        .flatMap((path) => path.plan.recipes)
        .some((id) => {
          const recipe = staticData.recipes[id]!;
          return isBarrelling(recipe) || isUnbarrelling(recipe);
        }),
    ).toBe(false);
  });
});

describe('RecipeSuggestions', () => {
  it('hides recipes which make an explicitly imported resource', () => {
    const cell = {
      entries: [{ recipe: 'speed-module-3' }],
      imports: ['item:speed-module-2' as const],
    };
    const { queryByRole } = render(h(RecipeSuggestions, { search: '', cell, progress: 0 }));

    expect(
      queryByRole('heading', { name: `Make ${resourceName('item:speed-module-2')}` }),
    ).toBeNull();
  });

  it('hides recipes which consume an explicitly exported resource', () => {
    const cell = {
      entries: [{ recipe: 'bob-speed-processor' }],
      exports: ['item:bob-speed-processor' as const],
    };
    const { queryByRole } = render(h(RecipeSuggestions, { search: '', cell, progress: 0 }));

    expect(
      queryByRole('heading', { name: `Use ${resourceName('item:bob-speed-processor')}` }),
    ).toBeNull();
  });

  it('shows the effects of a suggested output recipe', () => {
    const cell = { entries: [{ recipe: 'bob-speed-processor' }] };
    const suggestion = suggestedRecipePaths('', cell).find(
      (path) => path.kind === 'output' && path.resource === 'item:bob-speed-processor',
    );
    expect(suggestion).toBeDefined();
    if (!suggestion || !('target' in suggestion.plan)) return;

    const { getByRole } = render(h(RecipeSuggestions, { search: '', cell, progress: 0 }));
    const card = getByRole('heading', {
      name: `Use ${resourceName(suggestion.resource)}`,
    }).closest('article');
    expect(card).not.toBeNull();
    if (!card) return;

    const { plan } = suggestion;
    expect(
      within(card).getByLabelText(
        `Needs: ${[plan.target, ...plan.inputs].map(resourceName).join(', ')}`,
      ),
    ).toBeTruthy();
    expect(
      within(card).getByLabelText(`Makes: ${plan.outputs.map(resourceName).join(', ')}`),
    ).toBeTruthy();
  });

  it('adds every recipe in a suggested path from its card button', async () => {
    const user = userEvent.setup();
    const cell = { entries: [{ recipe: 'bob-speed-processor' }] };
    const path = suggestedRecipePaths('', cell)[0]!;
    const onAdd = vi.fn();
    const { container } = render(h(RecipeSuggestions, { search: '', cell, progress: 0, onAdd }));

    await user.click(container.querySelector('.void-path-card-head .recipe-add')!);

    expect(onAdd.mock.calls.map(([id]) => id)).toEqual(path.plan.recipes);
  });
});
