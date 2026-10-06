import { describe, expect, it } from 'vitest';
import {
  inserterItemsPerSecond,
  inserterItemsPerSecondAtProgress,
  inserterItemsPerSecondForBeltAtProgress,
} from '../../src/data/inserter-throughput.ts';
import type { Belt, Inserter, InserterCapacityBonus } from '../../src/types.ts';
import { defaultDataset } from '../with-bobang.ts';

import { createDataset } from '../../src/dataset/index.ts';
import { spaceAge } from '../../src/dataset/catalogue/space-age.ts';
import { upstreamInserterPerformance } from '../../src/data/inserter-performance-upstream.ts';

const fastInserter: Inserter = {
  rotationSpeed: 0.04,
  extensionSpeed: 0.1,
  pickupPosition: { x: 0, y: -1 },
  insertPosition: { x: 0, y: 1.2 },
  baseStackSize: 1,
};

const expressBelt: Belt = { itemsPerSecond: 45, undergroundLength: 8 };

describe('inserterItemsPerSecond', () => {
  it('selects bobs and upstream performance profiles in the dataset loaders', async () => {
    expect(defaultDataset.inserterPerformance.style).toBe('bobs');
    const upstream = createDataset('space-age', await spaceAge());
    expect(upstream.inserterPerformance).toBe(upstreamInserterPerformance);
    expect(upstream.inserterPerformance.style).toBe('upstream');
  });

  it('uses dataset-specific measurements for ordinary and bulk inserters at both reaches', () => {
    const capacities = [1, 24].map((capacity) => ({
      capacity,
      byBeltSpeed: [
        [15, 0.1],
        [75, 0.1],
      ] as const,
    }));
    const grid = [0.01, 0.1].map((rotationSpeed) => ({ rotationSpeed, capacities }));
    const selected = createDataset('custom-performance', {
      staticData: defaultDataset.data,
      iconMap: defaultDataset.iconMap,
      inserterPerformance: {
        style: 'upstream',
        chestToBelt: grid,
        beltToChest: grid,
        bulkChestToBelt: capacities,
        bulkBeltToChest: capacities,
        bulkRotationSpeed: 0.04,
      },
    });
    for (const bulk of [false, true]) {
      const inserter: Inserter = { ...fastInserter, bulk: bulk ? true : undefined };
      expect(
        inserterItemsPerSecond(selected.inserterPerformance, inserter, undefined, expressBelt),
      ).toBeCloseTo(0.1);
      expect(
        inserterItemsPerSecond(selected.inserterPerformance, inserter, undefined, expressBelt, 2),
      ).toBeCloseTo(0.05);
    }
    for (const reach of [1, 2]) {
      const rate = inserterItemsPerSecondForBeltAtProgress(selected, 0.55, expressBelt, reach);
      expect(rate).toBeGreaterThan(0);
      expect(rate).toBeLessThan(1);
      expect(inserterItemsPerSecondAtProgress(selected, 0.55, reach)).toBeCloseTo(rate);
      expect(rate).toBeLessThan(
        inserterItemsPerSecondForBeltAtProgress(defaultDataset, 0.55, expressBelt, reach),
      );
    }
  });

  it('matches the wiki fast-inserter example at capacity bonus 2', () => {
    const bonus: InserterCapacityBonus = [0.25, 1, 2];

    expect(
      inserterItemsPerSecond(defaultDataset.inserterPerformance, fastInserter, bonus, expressBelt),
    ).toBeCloseTo(4.8);
  });

  it('accepts the capacity bonus already resolved for game progress', () => {
    const firstBonus: InserterCapacityBonus = [0.25, 1, 1];
    const secondBonus: InserterCapacityBonus = [0.5, 2, 2];

    expect(
      inserterItemsPerSecond(
        defaultDataset.inserterPerformance,
        fastInserter,
        firstBonus,
        expressBelt,
      ),
    ).toBeCloseTo(4.8);
    expect(
      inserterItemsPerSecond(
        defaultDataset.inserterPerformance,
        fastInserter,
        secondBonus,
        expressBelt,
      ),
    ).toBeCloseTo(6.43);
  });

  it('uses the bulk capacity bonus and bulk measurements', () => {
    const bulkInserter: Inserter = { ...fastInserter, baseStackSize: 2, bulk: true };
    const bonus: InserterCapacityBonus = [0, 1, 2];

    expect(
      inserterItemsPerSecond(defaultDataset.inserterPerformance, bulkInserter, bonus, expressBelt),
    ).toBeCloseTo(8);
  });

  it('does not apply ordinary capacity research to an inserter which opts out', () => {
    const inserter = { ...fastInserter, usesInserterStackSizeBonus: false };
    const bonus: InserterCapacityBonus = [0, 2, 0];

    expect(
      inserterItemsPerSecond(defaultDataset.inserterPerformance, inserter, bonus, expressBelt),
    ).toBeCloseTo(2.5);
  });

  it('halves throughput when the inserter has twice the normal reach', () => {
    const bonus: InserterCapacityBonus = [0, 1, 0];
    const bulkInserter: Inserter = { ...fastInserter, baseStackSize: 2, bulk: true };

    expect(
      inserterItemsPerSecond(
        defaultDataset.inserterPerformance,
        fastInserter,
        bonus,
        expressBelt,
        2,
      ),
    ).toBeCloseTo(2.4);
    expect(
      inserterItemsPerSecond(
        defaultDataset.inserterPerformance,
        bulkInserter,
        bonus,
        expressBelt,
        2,
      ),
    ).toBeCloseTo(2.4);
  });

  it('extrapolates modded speeds without exceeding one belt lane', () => {
    const inserter = { ...fastInserter, rotationSpeed: 0.1 };
    const belt = { ...expressBelt, itemsPerSecond: 60 };
    const bonus: InserterCapacityBonus = [0, 4, 0];

    expect(
      inserterItemsPerSecond(defaultDataset.inserterPerformance, inserter, bonus, belt),
    ).toBeLessThanOrEqual(30);
    expect(
      inserterItemsPerSecond(defaultDataset.inserterPerformance, inserter, bonus, belt),
    ).toBeGreaterThan(0);
  });

  it('estimates every inserter and belt tier in the checked-in mod pack', () => {
    for (const inserter of Object.values(defaultDataset.data.inserters)) {
      for (const belt of Object.values(defaultDataset.data.belts)) {
        const rate = inserterItemsPerSecond(
          defaultDataset.inserterPerformance,
          inserter,
          defaultDataset.data.inserterCapacityBonuses.at(-1),
          belt,
        );
        expect(rate).toBeGreaterThan(0);
        expect(rate).toBeLessThanOrEqual(belt.itemsPerSecond / 2);
      }
    }
  });

  it('resolves the inserter, capacity bonus, and belt from game progress', () => {
    const expected = inserterItemsPerSecond(
      defaultDataset.inserterPerformance,
      defaultDataset.data.inserters['bob-red-bulk-inserter'],
      defaultDataset.data.inserterCapacityBonuses.findLast(([complexity]) => complexity <= 0.55),
      defaultDataset.data.belts['express-transport-belt'],
      2,
    );

    expect(inserterItemsPerSecondAtProgress(defaultDataset, 0.55, 2)).toBeCloseTo(expected);
  });

  it('uses a chosen belt while resolving the inserter and capacity bonus from progress', () => {
    const progress = 0.55;
    const belt = defaultDataset.data.belts['bob-basic-transport-belt'];
    const expected = Math.max(
      ...Object.values(defaultDataset.data.inserters)
        .filter(
          (inserter) =>
            (defaultDataset.data.resources[`item:${inserter.item}`]?.complexity ?? Infinity) <=
              progress &&
            inserter.maxBeltStackSize === undefined &&
            inserter.grabLessToMatchBeltStack !== true &&
            inserter.waitForFullHand !== true,
        )
        .map((inserter) =>
          inserterItemsPerSecond(
            defaultDataset.inserterPerformance,
            inserter,
            defaultDataset.data.inserterCapacityBonuses.findLast(
              ([complexity]) => complexity <= progress,
            ),
            belt,
          ),
        ),
    );

    expect(inserterItemsPerSecondForBeltAtProgress(defaultDataset, progress, belt)).toBeCloseTo(
      expected,
    );
  });
});
