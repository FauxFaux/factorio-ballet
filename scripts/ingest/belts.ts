import type { RawData } from 'factorio-raw-types/prototypes';
import type { Belt, Resource, ResourceId } from '../../src/types.ts';
import { entriesOf } from '../../src/ts.ts';
import { resolveLocale } from '../locale.ts';
import { BELT_KEYS } from '../raw-keys.ts';
import type { RLocale } from '../raw-validators.ts';
import { placingItems } from '../synthetic.ts';

/**
 * Ticks per second, and how many items fit along a tile of one lane: the game states a belt's
 * `speed` in tiles per tick, and the app wants items per second. An item occupies a quarter of a
 * tile along the lane it is on, and a belt has two of them.
 */
const TICKS_PER_SECOND = 60;
const ITEMS_PER_TILE = 4;
const BELT_LANES = 2;

/**
 * The transport belts, keyed by prototype id. An underground belt is part of its transport belt's
 * tier, linked by `related_underground_belt`, so its maximum span belongs on this record too.
 * Splitters, loaders and linked belts are `speed` too, but remain deliberately absent: they are the
 * same tier's throughput number written out again (see `checkBelts`), and none is a constraint a
 * plan is measured against.
 *
 * Hidden is dropped as everywhere else, though no transport belt in this pack is hidden — the
 * hidden belt-shaped prototypes are the three vanilla loaders and the two script-only entities
 * (`linked-belt`, `lane-splitter`), which are not transport belts to begin with.
 */
export function handleBelts(v: RawData, locales: Record<string, RLocale>): Record<string, Belt> {
  const belts: Record<string, Belt> = {};
  const placedBy = placingItems(v);
  const round = (x: number) => Math.round(x * 1e4) / 1e4;
  let skipped = 0;

  for (const [id, b] of Object.entries(v['transport-belt'] ?? {})) {
    if (b.hidden) {
      skipped++;
      continue;
    }
    const underground =
      b.related_underground_belt && v['underground-belt']?.[b.related_underground_belt];
    if (!underground) {
      console.log(`Belt with no related underground belt: ${id}`);
      continue;
    }
    belts[id] = {
      human: resolveLocale(id, locales, 'entity'),
      item: placedBy.get(id),
      itemsPerSecond: round(b.speed * TICKS_PER_SECOND * ITEMS_PER_TILE * BELT_LANES),
      undergroundLength: underground.max_distance,
    };
  }

  console.log(`Belts: ${Object.keys(belts).length} (dropped ${skipped} hidden)`);
  return belts;
}

/**
 * The two things ingesting only `transport-belt` assumes.
 *
 * A belt with no placing item would be half a building, as an unplaceable pump is in
 * `scripts/synthetic.ts` — and it would have no name, icon or complexity either, since all three
 * live on the item. None here: every belt is placed by an item of its own id.
 *
 * The other is that a tier is one number. `underground-belt`, `splitter`, `loader`, `loader-1x1`,
 * `linked-belt` and `lane-splitter` each state their own `speed`, and a pack could make a splitter
 * slower than the belt feeding it — 2.0's own lane splitter is the shape of a prototype that might.
 * Every one of the 25 here matches a belt exactly, so quoting the belt covers the line; a report
 * from this means throughput has a second number and `Belt` needs revisiting.
 */
export function checkBelts(
  belts: Record<string, Belt>,
  v: RawData,
  resources: Record<ResourceId, Resource>,
) {
  const itemless = Object.entries(belts).filter(
    ([, b]) => b.item === undefined || !(`item:${b.item}` in resources),
  );
  if (itemless.length > 0) {
    console.log(`Belts with no item: ${itemless.length}`, itemless.map(([id]) => id).slice(0, 20));
  }

  const speeds = new Set(Object.values(v['transport-belt'] ?? {}).map((b) => b.speed));
  const odd: string[] = [];
  for (const key of BELT_KEYS) {
    for (const [id, b] of entriesOf(v[key] ?? {})) {
      if (!speeds.has(b.speed)) odd.push(`${id}=${b.speed}`);
    }
  }
  if (odd.length > 0) {
    console.log(`Belt-shaped entities running at no belt's speed: ${odd.length}`, odd.slice(0, 20));
  }
}
