import { describe, expect, it } from 'vitest';
import { allowsEffect, modulesFor, staticData } from '../src/data.ts';
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
