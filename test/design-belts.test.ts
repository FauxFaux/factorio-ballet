import { describe, expect, it } from 'vitest';
import {
  assemblerInputStatuses,
  beltInputItemTraces,
  beltItemLaneCounts,
} from '../src/components/design/design-belt-traces.ts';
import type { DesignColumn, DesignEntity } from '../src/compute/design.ts';
import type { Recipe, ResourceId } from '../src/types.ts';

const ingredient = (resource: ResourceId): Recipe['ingredients'][number] => ({
  resource,
  amount: 1,
});

const product = (resource: ResourceId): Recipe['products'][number] => ({
  resource,
  amount: { fixed: 1 },
  probability: 1,
});

const recipes: Record<string, Pick<Recipe, 'ingredients' | 'products'>> = {
  iron: { ingredients: [], products: [product('item:iron-plate')] },
  copper: { ingredients: [], products: [product('item:copper-plate')] },
  circuits: {
    ingredients: [
      ingredient('item:iron-plate'),
      ingredient('item:copper-plate'),
      ingredient('fluid:water'),
    ],
    products: [product('item:electronic-circuit')],
  },
  ironUser: {
    ingredients: [ingredient('item:iron-plate')],
    products: [product('item:electronic-circuit')],
  },
};

describe('assembler belt inputs', () => {
  it('reports every missing item ingredient when there is no inward inserter', () => {
    const column: DesignColumn = { entities: [assembler('circuits', { x: 0, y: 0 })] };

    expect(assemblerInputStatuses(column, recipes).get(0)).toEqual({
      satisfied: false,
      missing: ['item:iron-plate', 'item:copper-plate'],
    });
  });

  it('lets one inward inserter take two ingredients from separate belt lanes', () => {
    const entities: DesignEntity[] = [
      { kind: 'belt', position: { x: 0, y: 0 }, direction: 'east' },
      assembler('iron', { x: 0, y: -2 }),
      { kind: 'inserter', position: { x: 0, y: -1 }, direction: 'south' },
      assembler('copper', { x: 0, y: 2 }),
      { kind: 'inserter', position: { x: 0, y: 1 }, direction: 'north' },
      assembler('circuits', { x: 2, y: 0 }),
      { kind: 'inserter', position: { x: 1, y: 0 }, direction: 'east' },
    ];

    expect(assemblerInputStatuses({ entities }, recipes).get(5)).toEqual({
      satisfied: true,
      missing: [],
    });
  });

  it('does not count an outward inserter', () => {
    const entities: DesignEntity[] = [
      { kind: 'belt', position: { x: 0, y: 0 }, direction: 'east' },
      assembler('iron', { x: 0, y: -2 }),
      { kind: 'inserter', position: { x: 0, y: -1 }, direction: 'south' },
      assembler('copper', { x: 1, y: -2 }),
      { kind: 'inserter', position: { x: 1, y: -1 }, direction: 'south' },
      assembler('circuits', { x: 0, y: 2 }),
      { kind: 'inserter', position: { x: 0, y: 1 }, direction: 'north' },
    ];

    expect(assemblerInputStatuses({ entities }, recipes).get(5)).toEqual({
      satisfied: false,
      missing: ['item:iron-plate', 'item:copper-plate'],
    });
  });

  it('seeds a split single input onto both input belts', () => {
    const column: DesignColumn = {
      entities: [
        { kind: 'belt', position: { x: 1, y: 0 }, direction: 'north' },
        { kind: 'belt', position: { x: 7, y: 0 }, direction: 'north' },
        assembler('ironUser', { x: 3, y: 0 }, { width: 3, height: 1 }),
        { kind: 'inserter', position: { x: 2, y: 0 }, direction: 'east' },
        { kind: 'inserter', position: { x: 6, y: 0 }, direction: 'west' },
      ],
    };

    expect(beltInputItemTraces(column, recipes)).toEqual(
      new Map([
        [
          0,
          [
            { item: 'item:iron-plate', side: 'left' },
            { item: 'item:iron-plate', side: 'right' },
          ],
        ],
        [
          1,
          [
            { item: 'item:iron-plate', side: 'left' },
            { item: 'item:iron-plate', side: 'right' },
          ],
        ],
      ]),
    );
  });

  it('seeds a mixed belt once when two inserters read different cells of it', () => {
    const column: DesignColumn = {
      entities: [
        { kind: 'belt', position: { x: 0, y: 0 }, direction: 'north' },
        { kind: 'belt', position: { x: 0, y: 1 }, direction: 'north' },
        { kind: 'belt', position: { x: 0, y: 2 }, direction: 'north' },
        { kind: 'inserter', position: { x: 1, y: 2 }, direction: 'east' },
        { kind: 'inserter', position: { x: 1, y: 0 }, direction: 'east' },
        assembler('circuits', { x: 2, y: 0 }, { width: 3, height: 3 }),
      ],
    };

    const traces = beltInputItemTraces(column, recipes);

    expect(traces).toEqual(
      new Map(
        [0, 1, 2].map((entityIndex) => [
          entityIndex,
          [
            { item: 'item:iron-plate', side: 'left' },
            { item: 'item:copper-plate', side: 'right' },
          ],
        ]),
      ),
    );
    expect(beltItemLaneCounts(column, recipes, traces)).toEqual(
      new Map([
        ['item:iron-plate', 1],
        ['item:copper-plate', 1],
      ]),
    );
  });
});

function assembler(
  recipe: string,
  position: { x: number; y: number },
  size = { width: 1, height: 1 },
): DesignEntity {
  return { kind: 'assembler', recipe, position, size };
}
