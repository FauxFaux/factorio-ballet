import { describe, expect, it } from 'vitest';
import { staticData } from '../../src/data/decode.ts';
import {
  inserterItemsPerSecond,
  inserterItemsPerSecondAtProgress,
  inserterItemsPerSecondForBeltAtProgress,
} from '../../src/data/inserter-throughput.ts';
import type { Belt, Inserter, InserterCapacityBonus } from '../../src/types.ts';

const fastInserter: Inserter = {
  rotationSpeed: 0.04,
  extensionSpeed: 0.1,
  pickupPosition: { x: 0, y: -1 },
  insertPosition: { x: 0, y: 1.2 },
  baseStackSize: 1,
};

const expressBelt: Belt = { itemsPerSecond: 45, undergroundLength: 8 };

describe('inserterItemsPerSecond', () => {
  it('matches the wiki fast-inserter example at capacity bonus 2', () => {
    const bonus: InserterCapacityBonus = [0.25, 1, 2];

    expect(inserterItemsPerSecond(fastInserter, bonus, expressBelt)).toBeCloseTo(4.8);
  });

  it('accepts the capacity bonus already resolved for game progress', () => {
    const firstBonus: InserterCapacityBonus = [0.25, 1, 1];
    const secondBonus: InserterCapacityBonus = [0.5, 2, 2];

    expect(inserterItemsPerSecond(fastInserter, firstBonus, expressBelt)).toBeCloseTo(4.8);
    expect(inserterItemsPerSecond(fastInserter, secondBonus, expressBelt)).toBeCloseTo(6.43);
  });

  it('uses the bulk capacity bonus and bulk measurements', () => {
    const bulkInserter: Inserter = { ...fastInserter, baseStackSize: 2, bulk: true };
    const bonus: InserterCapacityBonus = [0, 1, 2];

    expect(inserterItemsPerSecond(bulkInserter, bonus, expressBelt)).toBeCloseTo(8);
  });

  it('does not apply ordinary capacity research to an inserter which opts out', () => {
    const inserter = { ...fastInserter, usesInserterStackSizeBonus: false };
    const bonus: InserterCapacityBonus = [0, 2, 0];

    expect(inserterItemsPerSecond(inserter, bonus, expressBelt)).toBeCloseTo(2.5);
  });

  it('halves throughput when the inserter has twice the normal reach', () => {
    const bonus: InserterCapacityBonus = [0, 1, 0];
    const bulkInserter: Inserter = { ...fastInserter, baseStackSize: 2, bulk: true };

    expect(inserterItemsPerSecond(fastInserter, bonus, expressBelt, 2)).toBeCloseTo(2.4);
    expect(inserterItemsPerSecond(bulkInserter, bonus, expressBelt, 2)).toBeCloseTo(2.4);
  });

  it('extrapolates modded speeds without exceeding one belt lane', () => {
    const inserter = { ...fastInserter, rotationSpeed: 0.1 };
    const belt = { ...expressBelt, itemsPerSecond: 60 };
    const bonus: InserterCapacityBonus = [0, 4, 0];

    expect(inserterItemsPerSecond(inserter, bonus, belt)).toBeLessThanOrEqual(30);
    expect(inserterItemsPerSecond(inserter, bonus, belt)).toBeGreaterThan(0);
  });

  it('estimates every inserter and belt tier in the checked-in mod pack', () => {
    for (const inserter of Object.values(staticData.inserters)) {
      for (const belt of Object.values(staticData.belts)) {
        const rate = inserterItemsPerSecond(
          inserter,
          staticData.inserterCapacityBonuses.at(-1),
          belt,
        );
        expect(rate).toBeGreaterThan(0);
        expect(rate).toBeLessThanOrEqual(belt.itemsPerSecond / 2);
      }
    }
  });

  it('resolves the inserter, capacity bonus, and belt from game progress', () => {
    const expected = inserterItemsPerSecond(
      staticData.inserters['bob-red-bulk-inserter'],
      staticData.inserterCapacityBonuses.findLast(([complexity]) => complexity <= 0.55),
      staticData.belts['express-transport-belt'],
      2,
    );

    expect(inserterItemsPerSecondAtProgress(0.55, 2)).toBeCloseTo(expected);
  });

  it('uses a chosen belt while resolving the inserter and capacity bonus from progress', () => {
    const progress = 0.55;
    const belt = staticData.belts['bob-basic-transport-belt'];
    const expected = Math.max(
      ...Object.values(staticData.inserters)
        .filter(
          (inserter) =>
            (staticData.resources[`item:${inserter.item}`]?.complexity ?? Infinity) <= progress &&
            inserter.maxBeltStackSize === undefined &&
            inserter.grabLessToMatchBeltStack !== true &&
            inserter.waitForFullHand !== true,
        )
        .map((inserter) =>
          inserterItemsPerSecond(
            inserter,
            staticData.inserterCapacityBonuses.findLast(([complexity]) => complexity <= progress),
            belt,
          ),
        ),
    );

    expect(inserterItemsPerSecondForBeltAtProgress(progress, belt)).toBeCloseTo(expected);
  });
});
