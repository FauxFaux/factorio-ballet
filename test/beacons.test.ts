import { describe, expect, it } from 'vitest';
import {
  defaultBoost,
  entryBoost,
  entryEffects,
  entryRun,
  flipBoost,
  parseModules,
  type Cell,
} from '../src/cell.ts';
import { chosenModule, rowBeacon, SPEED_CATEGORY, staticData } from '../src/data.ts';
import { boostedEffects, moduleBoost } from '../src/flow.ts';
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

const boost = (machine: Machine, wanted: number | undefined, free = machine.moduleSlots ?? 0) =>
  moduleBoost(machine, free, SPEED_3, wanted, rowBeacon);

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

  it('builds the vanilla one, whose item is in the data to draw it with', () => {
    expect(rowBeacon).toBe(staticData.beacons['beacon']);
    expect(staticData.resources[`item:${rowBeacon!.item}`]?.human).toBe('Beacon');
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
    expect(moduleBoost(three, 3, undefined, 8, rowBeacon).speed).toBe(0);
    expect(moduleBoost(three, 3, 'no-such-module', 8, rowBeacon).speed).toBe(0);
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
    const picky = { ...rowBeacon!, allowedModuleCategories: ['productivity'] };
    const dropped = moduleBoost(two, 2, SPEED_3, 8, picky);
    expect(dropped).toMatchObject({ wanted: 8, inMachine: 2, inBeacons: 0, beacons: 0 });
    expect(dropped.speed).toBeCloseTo(0.8);
    // and the same for a beacon which takes the module but transmits no speed
    const quiet = { ...rowBeacon!, allowedEffects: ['consumption' as const] };
    expect(moduleBoost(two, 2, SPEED_3, 8, quiet)).toMatchObject({ inBeacons: 0, beacons: 0 });
  });
});

describe('boostedEffects', () => {
  it('multiplies the machine, and leaves what comes out of it alone', () => {
    const { effects } = boostedEffects(two, undefined, gears, SPEED_3, 8, rowBeacon);
    expect(effects.speed).toBeCloseTo(3.8785);
    expect(effects.productivity).toBe(1);
  });

  it('adds to whatever is in the slots already', () => {
    // one productivity module 3 in an assembling machine 3 leaves two slots for speed modules
    const { effects, boost: laid } = boostedEffects(
      three,
      { 'productivity-module-3': 1 },
      gears,
      SPEED_3,
      undefined,
      rowBeacon,
    );
    expect(laid).toMatchObject({ inMachine: 2, beacons: 0 });
    expect(effects.speed).toBeCloseTo(1.65);
    expect(effects.productivity).toBeCloseTo(1.12);
  });

  it('is ignored by a machine which ignores the speed effect', () => {
    // no machine in this pack does, so this is the gate rather than a case from the data
    const deaf: Machine = { ...two, allowedEffects: ['productivity'] };
    expect(boostedEffects(deaf, undefined, gears, SPEED_3, 8, rowBeacon).effects.speed).toBe(1);
  });
});

describe('a cell row with beacons', () => {
  /* Gears allow productivity, so the row is spending speed only because it says so; see the
     family block below for what it does when nobody has said. */
  const entry = {
    recipe: 'iron-gear-wheel',
    machine: 'assembling-machine-2',
    boostModules: 8,
    boost: 'speed' as const,
  };

  it("is the row's own count of the header's module", () => {
    expect(entryRun(entry, gears, entry.machine, { speed: SPEED_3 }).boost).toMatchObject({
      module: SPEED_3,
      inMachine: 2,
      beacons: 3,
    });
    // and nothing at all until the header names one
    expect(entryEffects(entry, gears, entry.machine)).toEqual({ speed: 1, productivity: 1 });
  });

  it('fills the machine when the row asks for nothing', () => {
    const auto = { ...entry, boostModules: undefined };
    expect(entryRun(auto, gears, auto.machine, { speed: SPEED_3 }).effects.speed).toBeCloseTo(1.8);
  });

  it('scales what the rest of the cell has to keep up with', () => {
    const cell = (boostModules?: number): Cell => ({
      entries: [{ ...entry, boostModules, count: 1 }, { recipe: 'iron-plate' }],
    });
    const plates = (c: Cell) => solveCell(c, 0, { speed: SPEED_3 }).counts[1]!;
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
 * Which family a row spends its count on. The choice is the row's and the tier is the header's, so
 * everything here is against the resolved pair a cell is handed rather than a `ModuleChoice`.
 */
describe("a row's module family", () => {
  const prod3 = 'productivity-module-3';
  /** Both families chosen in the header, as a save with the tier-3 modules researched would have. */
  const both = { speed: SPEED_3, productivity: prod3 };
  const row = { recipe: 'iron-gear-wheel', machine: 'assembling-machine-2' };

  it('is productivity where the recipe allows it, and speed where it does not', () => {
    expect(defaultBoost(gears)).toBe('productivity');
    expect(defaultBoost(circuits)).toBe('speed');
    expect(entryBoost({ recipe: 'iron-gear-wheel' }, gears)).toBe('productivity');
    // a productivity module on a recipe which cannot use it is nothing but its own speed malus
    expect(entryBoost({ recipe: 'electronic-circuit' }, circuits)).toBe('speed');
  });

  it('is whichever the row pinned', () => {
    expect(entryBoost({ ...row, boost: 'speed' }, gears)).toBe('speed');
    expect(entryBoost({ ...row, boost: 'productivity' }, circuits)).toBe('productivity');
  });

  it('flips, and stores nothing when it lands back on the default', () => {
    const flipped = flipBoost(row, gears);
    expect(flipped.boost).toBe('speed');
    // the default cannot move, so pinning it would be a byte nothing could tell apart
    expect(flipBoost(flipped, gears).boost).toBeUndefined();
    expect(flipBoost(row, circuits).boost).toBe('productivity');
  });

  it('spends the family it names out of the pair the header resolved', () => {
    // two slots filled with productivity module 3: +12% each, at −15% speed each
    const auto = entryRun(row, gears, row.machine, both);
    expect(auto.boost).toMatchObject({ module: prod3, wanted: 2, inMachine: 2, beacons: 0 });
    expect(auto.effects.productivity).toBeCloseTo(1.24);
    expect(auto.effects.speed).toBeCloseTo(0.7);
    // and the same row flipped is the speed module the other picker names
    const fast = entryRun(flipBoost(row, gears), gears, row.machine, both);
    expect(fast.boost).toMatchObject({ module: SPEED_3, inMachine: 2 });
    expect(fast.effects).toEqual({ speed: 1.8, productivity: 1 });
  });

  it('builds no beacons for productivity, however many are asked for', () => {
    // the game's rule, stated by the beacon's own `allowedEffects`: the overflow goes nowhere
    const eight = entryRun({ ...row, boostModules: 8 }, gears, row.machine, both);
    expect(eight.boost).toMatchObject({ wanted: 8, inMachine: 2, inBeacons: 0, beacons: 0 });
    expect(eight.effects.productivity).toBeCloseTo(1.24);
  });

  it('pays the speed malus on a recipe which will not take the productivity', () => {
    const pinned = {
      recipe: 'electronic-circuit',
      machine: 'assembling-machine-2',
      boost: 'productivity' as const,
    };
    const run = entryRun(pinned, circuits, pinned.machine, both);
    expect(run.boost.productivity).toBeCloseTo(0.24);
    expect(run.effects).toEqual({ speed: 0.7, productivity: 1 });
  });

  it('is nothing at all where the header has picked no module of that family', () => {
    expect(entryRun(row, gears, row.machine, { speed: SPEED_3 }).effects).toEqual({
      speed: 1,
      productivity: 1,
    });
  });
});
