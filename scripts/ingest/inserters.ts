import type { RawData } from 'factorio-raw-types/prototypes';
import type {
  Inserter,
  InserterCapacityBonus,
  InserterPosition,
  Resource,
  ResourceId,
} from '../../src/types.ts';
import { resolveLocale } from '../locale.ts';
import { arr, type RLocale } from '../raw-validators.ts';
import { placingItems } from '../synthetic.ts';

/**
 * Short-range item movers. The speed fields remain in the game's turns/tiles-per-tick units: a
 * rate calculator needs the tick-level values because the game rounds a completed swing to an
 * even number of ticks. `baseStackSize` is deliberately only the unresearched hand; research is a
 * force property, while `stack_size_bonus` is the Space Age stack inserter's prototype addition.
 */
export function handleInserters(
  v: RawData,
  locales: Record<string, RLocale>,
): Record<string, Inserter> {
  const inserters: Record<string, Inserter> = {};
  const placedBy = placingItems(v);
  const round = (value: number) => Number.parseFloat(value.toPrecision(3));
  let hidden = 0;
  let unplaceable = 0;

  for (const [id, inserter] of Object.entries(v.inserter ?? {})) {
    if (inserter.hidden) {
      hidden++;
      continue;
    }
    const item = placedBy.get(id);
    // Bob's leaves the old long-handed entity visible but repoints its item at bob-red-inserter.
    // A blueprint generator cannot construct that orphan, so unlike `entities` it is not an option.
    if (!item) {
      unplaceable++;
      continue;
    }
    const stackSizeBonus = inserter.stack_size_bonus;
    inserters[id] = {
      human: resolveLocale(id, locales, 'entity'),
      item,
      rotationSpeed: round(inserter.rotation_speed),
      extensionSpeed: round(inserter.extension_speed),
      pickupPosition: inserterPosition(inserter.pickup_position, round),
      insertPosition: inserterPosition(inserter.insert_position, round),
      // The game gives a bulk hand one extra item, then a stack inserter adds its prototype bonus.
      baseStackSize: 1 + (inserter.bulk ? 1 : 0) + (stackSizeBonus ?? 0),
      bulk: inserter.bulk || undefined,
      stackSizeBonus,
      maxBeltStackSize: inserter.max_belt_stack_size,
      grabLessToMatchBeltStack: inserter.grab_less_to_match_belt_stack || undefined,
      waitForFullHand: inserter.wait_for_full_hand || undefined,
      startingDistance:
        inserter.starting_distance === undefined ? undefined : round(inserter.starting_distance),
      usesInserterStackSizeBonus: inserter.uses_inserter_stack_size_bonus,
    };
  }

  console.log(
    `Inserters: ${Object.keys(inserters).length}` +
      ` (dropped ${hidden} hidden, ${unplaceable} with no placing item)`,
  );
  return inserters;
}

function inserterPosition(
  position: { x: number; y: number } | [number, number],
  round: (value: number) => number,
): InserterPosition {
  return Array.isArray(position)
    ? { x: round(position[0]), y: round(position[1]) }
    : { x: round(position.x), y: round(position.y) };
}

/** An inserter without its placing item is a half-entity a generated blueprint cannot build. */
export function checkInserters(
  inserters: Record<string, Inserter>,
  resources: Record<ResourceId, Resource>,
) {
  const itemless = Object.entries(inserters).filter(
    ([, inserter]) => inserter.item === undefined || !(`item:${inserter.item}` in resources),
  );
  if (itemless.length > 0) {
    console.log(
      `Inserters with no item: ${itemless.length}`,
      itemless.map(([id]) => id).slice(0, 20),
    );
  }
}

/**
 * Each finite research which changes an inserter hand, in the same 0..1 progress scale as recipes
 * and resources. Effects with the same rounded progress are one step for the slider, so combine
 * them, then accumulate the results. Infinite research has no one-time hand capacity to unlock and
 * is deliberately excluded.
 */
export function inserterCapacityBonuses(
  v: RawData,
  techCost: Map<string, number>,
  maxCost: number,
): InserterCapacityBonus[] {
  const byProgress = new Map<number, InserterCapacityBonus>();
  const round = (value: number) => Math.round(value * 1e4) / 1e4;

  for (const [id, tech] of Object.entries(v.technology)) {
    if (tech.hidden || tech.unit?.count === undefined) continue;
    let ordinary = 0;
    let bulk = 0;
    for (const effect of arr(tech.effects ?? [])) {
      if (effect.type === 'inserter-stack-size-bonus') ordinary += effect.modifier;
      if (effect.type === 'bulk-inserter-capacity-bonus') bulk += effect.modifier;
    }
    if (ordinary === 0 && bulk === 0) continue;
    const cost = techCost.get(id);
    if (cost === undefined || !isFinite(cost)) continue;
    const progress = round(Math.log10(1 + cost) / Math.log10(1 + maxCost));
    const previous = byProgress.get(progress);
    byProgress.set(progress, [
      progress,
      ordinary + (previous?.[1] ?? 0),
      bulk + (previous?.[2] ?? 0),
    ]);
  }

  let ordinary = 0;
  let bulk = 0;
  return [...byProgress.values()]
    .sort(([a], [b]) => a - b)
    .map(([progress, ordinaryBonus, bulkBonus]) => {
      ordinary += ordinaryBonus;
      bulk += bulkBonus;
      return [progress, ordinary, bulk];
    });
}
