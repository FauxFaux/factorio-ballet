import { describe, expect, it } from 'vitest';
import { beltLaneKey, type BeltLaneRef } from '../src/bp/belt-model.ts';
import { analyzeDesignLanes, singleLaneItem } from '../src/components/design/design-lanes.ts';
import type { DesignColumn, DesignDirection, DesignEntity } from '../src/design.ts';
import type { Recipe, ResourceId } from '../src/types.ts';

const item = (resource: ResourceId): Recipe['products'][number] => ({
  resource,
  amount: { fixed: 1 },
  probability: 1,
});

const recipes: Record<string, Pick<Recipe, 'products'>> = {
  gears: { products: [item('item:iron-gear-wheel')] },
  copper: { products: [item('item:copper-cable')] },
  fluid: { products: [item('fluid:water')] },
  mixed: { products: [item('item:iron-gear-wheel'), item('item:copper-cable')] },
};

const lane = (
  entityNumber: number,
  laneName: 'left' | 'right',
  extra: Partial<BeltLaneRef> = {},
): BeltLaneRef => ({ entityNumber, line: 'left', lane: laneName, ...extra });

const contentsAt = (analysis: ReturnType<typeof analyzeDesignLanes>, ref: BeltLaneRef) =>
  analysis.contents.get(beltLaneKey(ref));

describe('design belt lane analysis', () => {
  it.each([
    ['north', { x: 0, y: 2 }, { x: 0, y: 1 }, { x: 0, y: 0 }],
    ['east', { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
    ['south', { x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }],
    ['west', { x: 2, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }],
  ] as const)(
    'connects an assembler and belt with a %s-facing inserter',
    (direction, assemblerPosition, inserterPosition, beltPosition) => {
      const column: DesignColumn = {
        entities: [
          {
            kind: 'assembler',
            recipe: 'gears',
            position: assemblerPosition,
            size: { width: 1, height: 1 },
          },
          { kind: 'inserter', position: inserterPosition, direction },
          { kind: 'belt', position: beltPosition, direction },
        ],
      };

      const analysis = analyzeDesignLanes(column, recipes);

      expect(analysis.injections).toEqual([
        {
          assemblerIndex: 0,
          inserterIndex: 1,
          item: 'item:iron-gear-wheel',
          target: lane(2, 'right'),
        },
      ]);
      expect(singleLaneItem(contentsAt(analysis, lane(2, 'right')))).toBe('item:iron-gear-wheel');
      expect(analysis.issues).toEqual([]);
    },
  );

  it('accepts an inserter next to any tile of a multi-tile assembler', () => {
    const analysis = analyzeDesignLanes(
      {
        entities: [
          {
            kind: 'assembler',
            recipe: 'gears',
            position: { x: 0, y: 0 },
            size: { width: 3, height: 3 },
          },
          { kind: 'inserter', position: { x: 2, y: 3 }, direction: 'south' },
          { kind: 'belt', position: { x: 2, y: 4 }, direction: 'east' },
        ],
      },
      recipes,
    );

    expect(analysis.injections).toHaveLength(1);
    expect(analysis.issues).toEqual([]);
  });

  it('places on the lane farthest from an inserter beside the belt', () => {
    const makeColumn = (direction: DesignDirection): DesignColumn => ({
      entities: [
        {
          kind: 'assembler',
          recipe: 'gears',
          position: direction === 'south' ? { x: 0, y: -2 } : { x: 0, y: 2 },
          size: { width: 1, height: 1 },
        },
        {
          kind: 'inserter',
          position: direction === 'south' ? { x: 0, y: -1 } : { x: 0, y: 1 },
          direction,
        },
        { kind: 'belt', position: { x: 0, y: 0 }, direction: 'east' },
      ],
    });

    expect(analyzeDesignLanes(makeColumn('south'), recipes).injections[0].target.lane).toBe(
      'right',
    );
    expect(analyzeDesignLanes(makeColumn('north'), recipes).injections[0].target.lane).toBe('left');
  });

  it('starts availability at the target lane and propagates it downstream, not upstream', () => {
    const entities: DesignEntity[] = [
      { kind: 'belt', position: { x: -1, y: 0 }, direction: 'east' },
      { kind: 'belt', position: { x: 0, y: 0 }, direction: 'east' },
      { kind: 'belt', position: { x: 1, y: 0 }, direction: 'east' },
      {
        kind: 'assembler',
        recipe: 'gears',
        position: { x: 0, y: -2 },
        size: { width: 1, height: 1 },
      },
      { kind: 'inserter', position: { x: 0, y: -1 }, direction: 'south' },
    ];

    const analysis = analyzeDesignLanes({ entities }, recipes);

    expect(contentsAt(analysis, lane(0, 'right'))?.size).toBe(0);
    expect(singleLaneItem(contentsAt(analysis, lane(1, 'right')))).toBe('item:iron-gear-wheel');
    expect(singleLaneItem(contentsAt(analysis, lane(2, 'right')))).toBe('item:iron-gear-wheel');
  });

  it('propagates an item down both splitter outputs', () => {
    const analysis = analyzeDesignLanes(
      {
        entities: [
          { kind: 'belt', position: { x: 0, y: 0 }, direction: 'east' },
          { kind: 'splitter', position: { x: 1, y: 0 }, direction: 'east' },
          { kind: 'belt', position: { x: 2, y: 0 }, direction: 'east' },
          { kind: 'belt', position: { x: 2, y: 1 }, direction: 'east' },
          {
            kind: 'assembler',
            recipe: 'gears',
            position: { x: 0, y: -2 },
            size: { width: 1, height: 1 },
          },
          { kind: 'inserter', position: { x: 0, y: -1 }, direction: 'south' },
        ],
      },
      recipes,
    );

    expect(singleLaneItem(contentsAt(analysis, lane(2, 'right')))).toBe('item:iron-gear-wheel');
    expect(singleLaneItem(contentsAt(analysis, lane(3, 'right')))).toBe('item:iron-gear-wheel');
  });

  it('unions provenance for same-item merges without making the lane mixed', () => {
    const analysis = analyzeDesignLanes(mergeColumn('gears', 'gears'), recipes);
    const merged = contentsAt(analysis, lane(4, 'left'))!;

    expect([...merged.keys()]).toEqual(['item:iron-gear-wheel']);
    expect(merged.get('item:iron-gear-wheel')).toEqual(new Set([6, 8]));
    expect(analysis.issues.filter(({ kind }) => kind === 'mixed-lane')).toEqual([]);
  });

  it('marks a different-item merge and every affected downstream lane as mixed', () => {
    const analysis = analyzeDesignLanes(mergeColumn('gears', 'copper'), recipes);
    const mixed = analysis.issues.flatMap((issue) => (issue.kind === 'mixed-lane' ? [issue] : []));

    expect(mixed.map(({ lane: ref }) => ref.entityNumber)).toEqual([4, 5]);
    expect(contentsAt(analysis, lane(5, 'left'))?.size).toBe(2);
  });

  it.each([
    ['fluid', []],
    ['mixed', ['item:iron-gear-wheel', 'item:copper-cable']],
  ] as const)('rejects an assembler with unsupported %s results', (recipe, items) => {
    const analysis = analyzeDesignLanes(
      {
        entities: [
          {
            kind: 'assembler',
            recipe,
            position: { x: 0, y: 0 },
            size: { width: 1, height: 1 },
          },
          { kind: 'inserter', position: { x: 1, y: 0 }, direction: 'east' },
          { kind: 'belt', position: { x: 2, y: 0 }, direction: 'east' },
        ],
      },
      recipes,
    );

    expect(analysis.injections).toEqual([]);
    expect(analysis.issues).toContainEqual({
      kind: 'ambiguous-assembler-result',
      inserterIndex: 1,
      assemblerIndex: 0,
      items,
    });
  });

  it('reports belt cycles instead of attempting to propagate through them', () => {
    const analysis = analyzeDesignLanes(
      {
        entities: [
          { kind: 'belt', position: { x: 0, y: 0 }, direction: 'east' },
          { kind: 'belt', position: { x: 1, y: 0 }, direction: 'south' },
          { kind: 'belt', position: { x: 1, y: 1 }, direction: 'west' },
          { kind: 'belt', position: { x: 0, y: 1 }, direction: 'north' },
        ],
      },
      recipes,
    );

    expect(analysis.issues.some(({ kind }) => kind === 'belt-cycle')).toBe(true);
    expect(analysis.contents.size).toBe(0);
  });
});

function mergeColumn(firstRecipe: string, secondRecipe: string): DesignColumn {
  return {
    entities: [
      { kind: 'belt', position: { x: 1, y: 0 }, direction: 'east' },
      { kind: 'belt', position: { x: 2, y: -1 }, direction: 'south' },
      {
        kind: 'assembler',
        recipe: firstRecipe,
        position: { x: 1, y: 2 },
        size: { width: 1, height: 1 },
      },
      {
        kind: 'assembler',
        recipe: secondRecipe,
        position: { x: 4, y: -1 },
        size: { width: 1, height: 1 },
      },
      { kind: 'belt', position: { x: 2, y: 0 }, direction: 'east' },
      { kind: 'belt', position: { x: 3, y: 0 }, direction: 'east' },
      { kind: 'inserter', position: { x: 1, y: 1 }, direction: 'north' },
      { kind: 'pipe', position: { x: 20, y: 20 } },
      { kind: 'inserter', position: { x: 3, y: -1 }, direction: 'west' },
    ],
  };
}
