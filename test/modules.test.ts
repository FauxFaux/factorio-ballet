import { describe, expect, it } from 'vitest';
import {
  allowsEffect,
  categoryName,
  defaultModule,
  familyFor,
  moduleCategories,
  moduleFor,
  modulesFor,
  modulesIn,
} from '../src/data/modules.ts';
import { staticData } from '../src/data/index.ts';
import { fillSlots, moduleEffects } from '../src/flow.ts';

/** Allows productivity; runs in an assembler. */
const gears = staticData.recipes['iron-gear-wheel'];
/** Does not allow productivity, and is the ordinary case: 1995 of the 2330 recipes are. */
const circuits = staticData.recipes['electronic-circuit'];
/** One of Angel's farm recipes — the only place the bio-yield modules can go. */
const garden = staticData.recipes['angels-temperate-garden'];

const assembler = staticData.machines['assembling-machine-3'];
const farm = staticData.machines['angels-crop-farm'];
const character = staticData.machines['character'];
/** Eight slots, and a drill restricts nothing, so this is where the speed floor is reachable. */
const drill = staticData.machines['bob-mining-drill-4'];

/**
 * Against the shipped `static.json`, so as much a check on the ingest as on the app.
 */
describe('the ingested modules', () => {
  it('keeps what changes throughput and nothing else', () => {
    expect(staticData.modules['speed-module-3']).toEqual({
      category: 'speed',
      tier: 3,
      speed: 0.4,
    });
    // the trade productivity makes: more out, slower
    expect(staticData.modules['productivity-module-3']).toEqual({
      category: 'productivity',
      tier: 3,
      speed: -0.15,
      productivity: 0.12,
    });
    // efficiency and pollution modules do neither, so they are not here at all
    expect(staticData.modules['efficiency-module-3']).toBeUndefined();
    expect(staticData.modules['bob-pollution-clean-module-1']).toBeUndefined();
  });

  it('leaves the name and the icon on the item, which is the same id', () => {
    for (const id of Object.keys(staticData.modules)) {
      expect(staticData.resources[`item:${id}`]?.human).toBeTruthy();
    }
  });
});

describe('modulesFor', () => {
  const ids = (...args: Parameters<typeof modulesFor>) => modulesFor(...args).map(({ id }) => id);

  it('offers speed and productivity where the recipe allows productivity', () => {
    const found = ids(assembler, gears);
    expect(found).toContain('speed-module-3');
    expect(found).toContain('productivity-module-3');
    // cheapest first: the tier 1s come before their own tier 3s
    expect(found.indexOf('speed-module')).toBeLessThan(found.indexOf('speed-module-3'));
  });

  it('drops productivity modules on a recipe which does not allow it', () => {
    const found = ids(assembler, circuits);
    expect(found).toContain('speed-module-3');
    expect(found.filter((id) => id.includes('productivity'))).toEqual([]);
  });

  it('offers a module only where its category is allowed', () => {
    // no machine's whitelist names `angels-bio-yield`; the farms name no whitelist at all
    expect(ids(assembler, gears)).not.toContain('angels-bio-yield-module');
    expect(ids(farm, garden)).toContain('angels-bio-yield-module');
  });

  it('offers nothing to a machine with no slots', () => {
    expect(ids(character, gears)).toEqual([]);
  });

  it('reads a missing allowed_effects as no restriction', () => {
    // and a stated one as one: Angel's barreling pump takes speed, but applies no productivity.
    // Nothing exercises that second gate on real data — every machine which refuses productivity
    // only runs recipes which disallow it anyway — so the recipe gate is what does the work.
    expect(allowsEffect(drill, 'productivity')).toBe(true);
    expect(allowsEffect(staticData.machines['angels-barreling-pump'], 'speed')).toBe(true);
    expect(allowsEffect(staticData.machines['angels-barreling-pump'], 'productivity')).toBe(false);
  });
});

describe('moduleEffects', () => {
  it('is 1× on both counts for an empty machine', () => {
    expect(moduleEffects(assembler, {}, gears)).toEqual({ speed: 1, productivity: 1 });
  });

  it('adds a module up once per slot, not compounding', () => {
    // three speed module 3s at +40% each: 2.2×, and an assembling machine 3 is 1.25 to start with
    const effects = moduleEffects(assembler, fillSlots(assembler, 'speed-module-3'), gears);
    expect(fillSlots(assembler, 'speed-module-3')).toEqual({ 'speed-module-3': 3 });
    expect(effects.speed).toBeCloseTo(2.2);
    expect(effects.productivity).toBe(1);
    expect(assembler.speed * effects.speed).toBeCloseTo(2.75);
  });

  it('pays for productivity in speed', () => {
    const effects = moduleEffects(assembler, fillSlots(assembler, 'productivity-module-3'), gears);
    expect(effects.productivity).toBeCloseTo(1.36);
    expect(effects.speed).toBeCloseTo(0.55);
  });

  it('gives no productivity on a recipe which does not allow it, and still charges the speed', () => {
    const fill = fillSlots(assembler, 'productivity-module-3');
    expect(moduleEffects(assembler, fill, circuits)).toEqual({
      ...moduleEffects(assembler, fill, gears),
      productivity: 1,
    });
  });

  it('mixes modules, and ignores one we did not ingest', () => {
    const effects = moduleEffects(
      assembler,
      { 'speed-module-3': 2, 'productivity-module-3': 1, 'efficiency-module-3': 1 },
      gears,
    );
    expect(effects.speed).toBeCloseTo(1.65);
    expect(effects.productivity).toBeCloseTo(1.12);
  });

  it('takes only as many modules as the machine has slots', () => {
    // five named, three slots: the loadout outlived a change of machine, and the answer must not
    expect(moduleEffects(assembler, { 'speed-module-3': 5 }, gears).speed).toBeCloseTo(2.2);
  });

  it('fills those slots in the order the modules were chosen', () => {
    // two speed and two productivity into three slots: the last one named is the one left out
    const effects = moduleEffects(
      assembler,
      { 'productivity-module-3': 2, 'speed-module-3': 2 },
      gears,
    );
    expect(effects.productivity).toBeCloseTo(1.24);
    expect(effects.speed).toBeCloseTo(1.1);
  });

  it('ignores a module the machine will not take, slot and all', () => {
    const fill = { 'angels-bio-yield-module-5': 2 };
    expect(moduleEffects(assembler, fill, gears)).toEqual({ speed: 1, productivity: 1 });
    // the same two modules in the machine which is their only home
    expect(moduleEffects(farm, fill, garden)).toEqual({ speed: 1, productivity: 2 });
  });

  it('will not slow a machine below a fifth of its speed', () => {
    // eight bob productivity module 5s is −200%, which the game floors at 20%
    const effects = moduleEffects(
      drill,
      fillSlots(drill, 'bob-productivity-module-5'),
      staticData.recipes['synthetic:mining-coal'],
    );
    expect(effects.speed).toBe(0.2);
  });
});

describe('the module families', () => {
  it('is the three the pack has, in the order the header shows them', () => {
    expect(moduleCategories).toEqual([
      { id: 'speed', human: 'speed', effect: 'speed' },
      { id: 'productivity', human: 'productivity', effect: 'productivity' },
      { id: 'angels-bio-yield', human: 'agricultural', effect: 'productivity' },
    ]);
  });

  it('lists a family cheapest first, whatever machine or recipe', () => {
    // every tier, unlike `modulesFor`: which of them a machine would take is a later question
    expect(modulesIn('speed').map(({ id }) => id)).toEqual([
      'speed-module',
      'speed-module-2',
      'speed-module-3',
      'bob-speed-module-4',
      'bob-speed-module-5',
    ]);
    expect(modulesIn('no-such-category')).toEqual([]);
  });

  it('defaults to the best tier the progress slider has unlocked', () => {
    const at = (progress: number) => defaultModule(modulesIn('productivity'), progress)?.id;
    // none until tier 1 is actually craftable, which is 0.3556 in this pack: unlike a machine, a
    // module has an honest answer to fall back to, and empty slots is it
    expect(at(0)).toBeUndefined();
    expect(at(0.35)).toBeUndefined();
    expect(at(0.36)).toBe('productivity-module');
    // 0.4954, and tier 3 is 0.6727 — the best one you have, not the nearest one there is
    expect(at(0.5)).toBe('productivity-module-2');
    expect(at(1)).toBe('bob-productivity-module-5');
  });
});

/**
 * Which family a machine reaches for, given the header has chosen one of each. Two families are
 * picked for productivity — the ordinary modules and Angel's bio-yield ones — so "the productivity
 * module" is not a question the header alone can answer.
 */
describe('moduleFor', () => {
  const chosen = {
    speed: 'speed-module-3',
    productivity: 'productivity-module-3',
    'angels-bio-yield': 'angels-bio-yield-module-5',
  };
  /** Where Arumbiphila is grown: two slots, and no `allowed_module_categories` at all. */
  const desert = staticData.machines['angels-desert-farm'];

  it('gives a farm the agricultural modules, which is what a farm is for', () => {
    // the farm names no whitelist, so it takes the ordinary productivity modules too — but +50% of
    // pure yield beats +12% at −15% speed, and that is what decides it
    expect(desert.allowedModuleCategories).toBeUndefined();
    expect(moduleFor(desert, 'productivity', chosen)).toBe('angels-bio-yield-module-5');
    expect(familyFor(desert, 'productivity')).toBe('angels-bio-yield');
  });

  it('gives every other machine the productivity modules, being all they will take', () => {
    expect(assembler.allowedModuleCategories).toContain('productivity');
    expect(assembler.allowedModuleCategories).not.toContain('angels-bio-yield');
    expect(moduleFor(assembler, 'productivity', chosen)).toBe('productivity-module-3');
    expect(familyFor(assembler, 'productivity')).toBe('productivity');
  });

  it('falls through to a family the header has actually chosen', () => {
    // a player not using the bio-yield modules at all still has the ordinary ones in a farm
    const noBio = { ...chosen, 'angels-bio-yield': undefined };
    expect(moduleFor(desert, 'productivity', noBio)).toBe('productivity-module-3');
    expect(moduleFor(desert, 'productivity', {})).toBeUndefined();
  });

  it('is the one speed family either way, and reaches a machine which will not hold it', () => {
    expect(moduleFor(desert, 'speed', chosen)).toBe('speed-module-3');
    // the machine refusing the category is the beacons' business, not this: a module is still named
    const picky = { ...assembler, allowedModuleCategories: ['angels-bio-yield'] };
    expect(moduleFor(picky, 'speed', chosen)).toBe('speed-module-3');
    expect(familyFor(picky, 'speed')).toBe('speed');
  });

  it('is named on a row as the picker names it', () => {
    expect(categoryName('angels-bio-yield')).toBe('agricultural');
    expect(categoryName('productivity')).toBe('productivity');
  });
});
