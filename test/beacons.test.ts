import { describe, expect, it } from 'vitest';
import { entryEffects, entryRun, parseModules, type Cell } from '../src/cell.ts';
import {
  beaconTiers,
  chosenBeacon,
  chosenModule,
  defaultBeacon,
  SPEED_CATEGORY,
  staticData,
  type Chosen,
  type ChosenModules, defaultBelt,
} from '../src/data.ts';
import { laidOutEffects, moduleBoost, moduleLayout } from '../src/flow.ts';
import { solveCell } from '../src/solve.ts';
import type { Machine } from '../src/types.ts';

const gears = staticData.recipes['iron-gear-wheel'];
/** Does not allow productivity, which is the ordinary case; see `test/modules.test.ts`. */
const circuits = staticData.recipes['electronic-circuit'];
/** Two module slots, which is the machine the worked example in `docs/beacons.wiki` terms uses. */
const two = staticData.machines['assembling-machine-2'];
const three = staticData.machines['assembling-machine-3'];
const character = staticData.machines['character'];

/** +40% each, and the tier the whole file quotes. */
const SPEED_3 = 'speed-module-3';

/** The two-slot vanilla beacon, which is what `docs/beacons.wiki`'s worked example is tiled with. */
const VANILLA = staticData.beacons['beacon'];

/** What the header comes to: modules of each family, and the beacon they overflow into. */
const kit = (modules: ChosenModules): Chosen => ({ modules, beacon: VANILLA, belt: defaultBelt(0).belt });

const boost = (machine: Machine, wanted: number | undefined, free = machine.moduleSlots ?? 0) =>
  moduleBoost(machine, free, SPEED_3, wanted, VANILLA);

describe('the ingested beacons', () => {
  it('is the three the pack has, with their slots and their transmission', () => {
    expect(Object.keys(staticData.beacons)).toEqual(['beacon', 'bob-beacon-2', 'bob-beacon-3']);
    expect(staticData.beacons['beacon']).toEqual({
      human: 'Beacon',
      item: 'beacon',
      moduleSlots: 2,
      distributionEffectivity: 1.5,
      // the game's own way of saying productivity modules do not go in a beacon
      allowedEffects: ['consumption', 'speed', 'pollution'],
    });
    expect(staticData.beacons['bob-beacon-3'].moduleSlots).toBe(6);
  });

  it('are cheapest first, with an item in the data to draw each of them with', () => {
    expect(beaconTiers.map(({ id }) => id)).toEqual(['beacon', 'bob-beacon-2', 'bob-beacon-3']);
    for (const { id, beacon, complexity } of beaconTiers) {
      expect(staticData.resources[`item:${beacon.item}`]?.human, id).toBeTruthy();
      expect(complexity, id).toBeGreaterThan(0);
    }
  });
});

/**
 * Which beacon a row builds, on `defaultModule`'s rule: the best you could have built by now, and
 * none until that is nothing.
 */
describe('the chosen beacon', () => {
  it('is none at the crash site and the biggest one at the end of the tree', () => {
    expect(defaultBeacon(0)).toBeUndefined();
    expect(defaultBeacon(1)?.id).toBe('bob-beacon-3');
    // and it walks up the tiers in between rather than jumping to the end
    const vanilla = beaconTiers[0]!;
    expect(defaultBeacon(vanilla.complexity!)?.id).toBe('beacon');
  });

  it("is the header's pick, whatever the progress", () => {
    expect(chosenBeacon('beacon', 1)).toBe(VANILLA);
    // `null` is a choice of its own, and the choice is none
    expect(chosenBeacon(null, 1)).toBeUndefined();
    // as is a beacon this dataset does not have, which is a stale URL rather than a choice
    expect(chosenBeacon('no-such-beacon', 1)).toBeUndefined();
  });

  it('follows the slider where the header picked nothing', () => {
    expect(chosenBeacon(undefined, 0)).toBeUndefined();
    expect(chosenBeacon(undefined, 1)).toBe(staticData.beacons['bob-beacon-3']);
  });
});

describe('moduleBoost', () => {
  it('fills the machine and builds nothing when nobody asked for more', () => {
    const auto = boost(three, undefined);
    expect(auto).toMatchObject({ wanted: 3, inMachine: 3, inBeacons: 0, beacons: 0 });
    expect(auto.speed).toBeCloseTo(1.2);
  });

  /* The worked example: eight asked for, a machine which holds two, and two-slot beacons. */
  it('beacons whatever the machine cannot hold', () => {
    const eight = boost(two, 8);
    expect(eight).toMatchObject({ wanted: 8, inMachine: 2, inBeacons: 6, beacons: 3 });
    // 1.5 / sqrt(3) each, so the three of them come to 1.5 × sqrt(3) = 2.598 beacons' worth
    expect(eight.transmission).toBeCloseTo(0.866);
    expect(eight.beacons * eight.transmission).toBeCloseTo(2.598);
    // (2 in the machine + 6 at 0.866) × 40%
    expect(eight.speed).toBeCloseTo(2.8785);
  });

  it('builds the last beacon whether or not it is full', () => {
    // five over two-slot beacons is three beacons and the penalty of three, not of two and a half
    const seven = boost(two, 7);
    expect(seven).toMatchObject({ inMachine: 2, inBeacons: 5, beacons: 3 });
    expect(seven.transmission).toBeCloseTo(0.866);
  });

  /**
   * The diminishing returns, against the table in `docs/beacons.wiki`: what `n` beacons transmit
   * between them, which is `1.5 × sqrt(n)` and never `1.5 × n`.
   */
  it('agrees with the wiki on what a beacon is worth', () => {
    const totals = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => {
      const asked = boost(two, 2 + 2 * n);
      expect(asked.beacons).toBe(n);
      return Number((asked.beacons * asked.transmission).toFixed(4));
    });
    expect(totals).toEqual([1.5, 2.1213, 2.5981, 3.0, 3.3541, 3.6742, 3.9686, 4.2426]);
  });

  it('is nothing at all with no module chosen', () => {
    expect(moduleBoost(three, 3, undefined, 8, VANILLA).speed).toBe(0);
    expect(moduleBoost(three, 3, 'no-such-module', 8, VANILLA).speed).toBe(0);
  });

  it('reaches no machine which takes no modules', () => {
    // the game's rule, and the reason a pump or a hand cannot be beaconed however many you build
    expect(boost(character, 8)).toMatchObject({ inMachine: 0, inBeacons: 0, beacons: 0, speed: 0 });
  });

  it('leaves the slots the loadout already took', () => {
    // two of the three slots are full of something else, so only one speed module goes in
    expect(boost(three, undefined, 1)).toMatchObject({ wanted: 1, inMachine: 1, beacons: 0 });
    expect(boost(three, 5, 1)).toMatchObject({ inMachine: 1, inBeacons: 4, beacons: 2 });
  });

  /**
   * The two whitelists are asked different questions: what the *machine* takes decides what goes
   * in its slots, and what the *beacon* takes decides what goes in the beacon. Neither machine
   * here is in this pack — every machine which names a list names speed — but the distinction is
   * the game's, so it is worth holding on to.
   */
  it('beacons a machine which will not take the module itself', () => {
    const picky: Machine = { ...three, allowedModuleCategories: ['productivity'] };
    expect(boost(picky, 4)).toMatchObject({ inMachine: 0, inBeacons: 4, beacons: 2 });
    expect(boost(picky, undefined)).toMatchObject({ wanted: 0, speed: 0 });
  });

  it('drops what a beacon will not hold rather than putting it in the machine', () => {
    const picky = { ...VANILLA, allowedModuleCategories: ['productivity'] };
    const dropped = moduleBoost(two, 2, SPEED_3, 8, picky);
    expect(dropped).toMatchObject({ wanted: 8, inMachine: 2, inBeacons: 0, beacons: 0 });
    expect(dropped.speed).toBeCloseTo(0.8);
    // and the same for a beacon which takes the module but transmits no speed
    const quiet = { ...VANILLA, allowedEffects: ['consumption' as const] };
    expect(moduleBoost(two, 2, SPEED_3, 8, quiet)).toMatchObject({ inBeacons: 0, beacons: 0 });
  });
});

describe('laidOutEffects', () => {
  /** Speed asked for and no productivity module in the header, as the early game has it. */
  const fast = { speed: SPEED_3 };

  it('multiplies the machine, and leaves what comes out of it alone', () => {
    const { effects } = laidOutEffects(two, undefined, gears, fast, { speed: 8 }, VANILLA);
    expect(effects.speed).toBeCloseTo(3.8785);
    expect(effects.productivity).toBe(1);
  });

  it('adds to whatever is in the slots already', () => {
    // one productivity module 3 in an assembling machine 3 leaves two slots for speed modules
    const { effects, layout } = laidOutEffects(
      three,
      { 'productivity-module-3': 1 },
      gears,
      fast,
      {},
      VANILLA,
    );
    expect(layout.speed).toMatchObject({ inMachine: 2, beacons: 0 });
    expect(effects.speed).toBeCloseTo(1.65);
    expect(effects.productivity).toBeCloseTo(1.12);
  });

  it('is ignored by a machine which ignores the speed effect', () => {
    // no machine in this pack does, so this is the gate rather than a case from the data
    const deaf: Machine = { ...two, allowedEffects: ['productivity'] };
    expect(laidOutEffects(deaf, undefined, gears, fast, { speed: 8 }, VANILLA).effects.speed).toBe(
      1,
    );
  });
});

describe('a cell row with beacons', () => {
  /* Only a speed module chosen in the header, so the whole machine is the row's speed request; the
     layout block below is what happens once there is a productivity module to compete for slots. */
  const entry = { recipe: 'iron-gear-wheel', machine: 'assembling-machine-2', speedModules: 8 };

  it("is the row's own count of the header's module", () => {
    expect(
      entryRun(entry, gears, entry.machine, kit({ speed: SPEED_3 })).layout.speed,
    ).toMatchObject({
      module: SPEED_3,
      inMachine: 2,
      beacons: 3,
    });
    // and nothing at all until the header names one
    expect(entryEffects(entry, gears, entry.machine)).toEqual({ speed: 1, productivity: 1 });
  });

  it('fills the machine when the row asks for nothing', () => {
    const auto = { ...entry, speedModules: undefined };
    expect(entryRun(auto, gears, auto.machine, kit({ speed: SPEED_3 })).effects.speed).toBeCloseTo(
      1.8,
    );
  });

  it('scales what the rest of the cell has to keep up with', () => {
    const cell = (speedModules?: number): Cell => ({
      entries: [{ ...entry, speedModules, count: 1 }, { recipe: 'iron-plate' }],
    });
    const plates = (c: Cell) => solveCell(c, 0, kit({ speed: SPEED_3 })).counts[1]!;
    // a machine going 2.16× as fast eats its ingredients 2.16× as fast, and the row feeding it
    // has to be that much bigger: 3.8785 / 1.8, the beaconed row against the auto one
    expect(plates(cell(8)) / plates(cell(undefined))).toBeCloseTo(2.1547);
    // with no speed module chosen at all, the count is the unmodded one
    expect(solveCell(cell(8), 0).counts[1]).toBeCloseTo(plates(cell(0)));
  });
});

describe('parseModules', () => {
  it('is a whole number of modules, or auto', () => {
    expect(parseModules('4')).toBe(4);
    // nothing you can build: a fraction of a module, or fewer than none
    expect(parseModules('4.7')).toBe(4);
    expect(parseModules('-2')).toBe(0);
    expect(parseModules('')).toBeUndefined();
    expect(parseModules('lots')).toBeUndefined();
  });
});

describe('chosenModule', () => {
  it("is the header's pick, whatever the progress", () => {
    expect(chosenModule({ speed: SPEED_3 }, SPEED_CATEGORY, 0)).toBe(SPEED_3);
    // `null` is a choice of its own, and the choice is none
    expect(chosenModule({ speed: null }, SPEED_CATEGORY, 1)).toBeUndefined();
  });

  it('follows the slider where the header picked nothing', () => {
    expect(chosenModule({}, SPEED_CATEGORY, 0)).toBeUndefined();
    expect(chosenModule({}, SPEED_CATEGORY, 1)).toBe('bob-speed-module-5');
  });
});

/**
 * The two families over one machine: which slots each gets, and what is left for beacons. The tier
 * is the header's, so everything here is against the resolved pair a cell is handed.
 */
describe('moduleLayout', () => {
  const prod3 = 'productivity-module-3';
  /** Both families chosen in the header, as a save with the tier-3 modules researched would have. */
  const both = { speed: SPEED_3, productivity: prod3 };
  const row = { recipe: 'iron-gear-wheel', machine: 'assembling-machine-2' };

  it('fills the slots with productivity where the recipe pays for it', () => {
    // two slots of productivity module 3: +12% output each, at −15% speed each
    const auto = entryRun(row, gears, row.machine, kit(both));
    expect(auto.layout.productivity).toMatchObject({ module: prod3, wanted: 2, inMachine: 2 });
    expect(auto.layout.speed).toMatchObject({ wanted: 0, inMachine: 0, beacons: 0 });
    expect(auto.effects.productivity).toBeCloseTo(1.24);
    expect(auto.effects.speed).toBeCloseTo(0.7);
  });

  it('asks for no productivity where the recipe would ignore it, and fills up with speed', () => {
    // a productivity module here would be nothing but its speed malus, so auto is none of them
    const auto = entryRun(
      { ...row, recipe: 'electronic-circuit' },
      circuits,
      row.machine,
      kit(both),
    );
    expect(auto.layout.productivity).toMatchObject({ wanted: 0, inMachine: 0 });
    expect(auto.layout.speed).toMatchObject({ module: SPEED_3, wanted: 2, inMachine: 2 });
    expect(auto.effects).toEqual({ speed: 1.8, productivity: 1 });
  });

  it('asks for none of it in a machine which ignores productivity either', () => {
    // no machine in this pack runs a productivity recipe and ignores productivity; the gate is the
    // game's all the same, and getting it wrong is a machine slowed for nothing
    const deaf: Machine = { ...two, allowedEffects: ['speed'] };
    const laid = moduleLayout(deaf, 2, gears, both, {}, VANILLA);
    expect(laid.productivity).toMatchObject({ wanted: 0, inMachine: 0 });
    expect(laid.speed).toMatchObject({ wanted: 2, inMachine: 2 });
  });

  it('gives speed whatever slots the productivity modules left', () => {
    const one = entryRun({ ...row, productivityModules: 1 }, gears, row.machine, kit(both));
    expect(one.layout.productivity.inMachine).toBe(1);
    expect(one.layout.speed).toMatchObject({ wanted: 1, inMachine: 1, beacons: 0 });
    // +12% output, and the speed module's +40% against the productivity module's −15%
    expect(one.effects.productivity).toBeCloseTo(1.12);
    expect(one.effects.speed).toBeCloseTo(1.25);
  });

  it('beacons the speed a full machine has no room for', () => {
    // the point of the redesign: a machine full of productivity modules is still beaconable, and
    // eight speed modules over two-slot beacons is four of them at 1.5/sqrt(4) = 75% each
    const eight = entryRun({ ...row, speedModules: 8 }, gears, row.machine, kit(both));
    expect(eight.layout.productivity.inMachine).toBe(2);
    expect(eight.layout.speed).toMatchObject({ inMachine: 0, inBeacons: 8, beacons: 4 });
    expect(eight.layout.speed.transmission).toBeCloseTo(0.75);
    // 8 × 75% × 40% of speed, less the 2 × 15% the productivity modules cost
    expect(eight.effects.speed).toBeCloseTo(3.1);
    expect(eight.effects.productivity).toBeCloseTo(1.24);
  });

  it('caps productivity at the slots there are, having nowhere else to put it', () => {
    const asked = entryRun({ ...row, productivityModules: 8 }, gears, row.machine, kit(both));
    expect(asked.layout.productivity).toMatchObject({ wanted: 2, inMachine: 2, beacons: 0 });
    expect(asked.effects.productivity).toBeCloseTo(1.24);
  });

  it('grows a farm with the agricultural modules', () => {
    // the case this was got wrong on: Arumbiphila in a desert farm, which takes both families and
    // wants the bio-yield one — two slots of pure +50% yield, and no speed malus to show for it
    const farm = { recipe: 'angels-desert-5', machine: 'angels-desert-farm' };
    const grown = staticData.recipes['angels-desert-5'];
    const run = entryRun(
      farm,
      grown,
      farm.machine,
      kit({ ...both, 'angels-bio-yield': 'angels-bio-yield-module-5' }),
    );
    expect(run.layout.families.productivity).toBe('angels-bio-yield');
    expect(run.layout.productivity).toMatchObject({
      module: 'angels-bio-yield-module-5',
      inMachine: 2,
    });
    expect(run.effects).toEqual({ speed: 1, productivity: 2 });
  });

  it('says what could reach the machine at all, which is what a row draws a box for', () => {
    // a pump has no slots, so nothing reaches it — not a module, and not a beacon either
    const pump = staticData.recipes['synthetic:pumping-water'];
    expect(
      entryRun({ recipe: 'synthetic:pumping-water' }, pump, 'offshore-pump', kit(both)).layout,
    ).toMatchObject({ reaches: { speed: false, productivity: false } });
    // an ordinary recipe reaches for speed and not productivity, and gears for both
    expect(
      entryRun({ ...row, recipe: 'electronic-circuit' }, circuits, row.machine, kit(both)).layout
        .reaches,
    ).toEqual({ speed: true, productivity: false });
    expect(entryRun(row, gears, row.machine, kit(both)).layout.reaches).toEqual({
      speed: true,
      productivity: true,
    });
  });

  it('is nothing at all where the header has picked no module of that family', () => {
    const speedOnly = entryRun(row, gears, row.machine, kit({ speed: SPEED_3 }));
    // no productivity module to fill the slots with, so the speed request has them instead
    expect(speedOnly.layout.productivity.module).toBeUndefined();
    expect(speedOnly.effects).toEqual({ speed: 1.8, productivity: 1 });
    expect(entryRun(row, gears, row.machine, kit({})).effects).toEqual({
      speed: 1,
      productivity: 1,
    });
  });
});
