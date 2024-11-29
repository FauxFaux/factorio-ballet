import type { Blueprint } from './blueprints';

// c.f. https://github.com/FauxFaux/factorio-loader/blob/aca1e2a28c69e0ac073391b6498f897d6803d02a/web/pages/recipes.tsx#L247
// c.f. https://github.com/FauxFaux/factorio-loader/blob/aca1e2a28c69e0ac073391b6498f897d6803d02a/web/pages/recipes.tsx#L299
export const mallAssembler = (
  recipeId: string,
  itemId: string,
  itemHumanName: string | undefined,
  inputs: Record<string, number>,
): Blueprint => ({
  entities: [
    {
      entity_number: 1,
      name: 'assembling-machine-2',
      position: {
        x: -124.5,
        y: 130.5,
      },
      recipe: recipeId,
    },
    {
      control_behavior: {
        connect_to_logistic_network: true,
        logistic_condition: {
          comparator: '<',
          constant: 5,
          first_signal: {
            name: itemId,
            type: 'item',
          },
        },
      },
      direction: 6,
      entity_number: 2,
      name: 'fast-inserter',
      position: {
        x: -122.5,
        y: 130.5,
      },
    },
    {
      direction: 2,
      entity_number: 3,
      name: 'fast-inserter',
      position: {
        x: -122.5,
        y: 131.5,
      },
    },
    {
      entity_number: 4,
      name: 'logistic-chest-passive-provider',
      position: {
        x: -121.5,
        y: 130.5,
      },
    },
    {
      entity_number: 5,
      name: 'logistic-chest-requester',
      position: {
        x: -121.5,
        y: 131.5,
      },
      request_filters: Object.entries(inputs).map(([name, count], i) => ({
        count,
        index: i + 1,
        name,
      })),
    },
  ],
  icons: [
    {
      index: 1,
      signal: {
        name: 'assembling-machine-2',
        type: 'item',
      },
    },
    {
      index: 2,
      signal: {
        name: itemId,
        type: 'item',
      },
    },
  ],
  item: 'blueprint',
  label: 'mall' + (itemHumanName ? `: ${itemHumanName}` : ''),
  version: 281479277838336,
});
