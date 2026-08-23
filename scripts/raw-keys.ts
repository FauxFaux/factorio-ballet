import type { RawData } from 'factorio-raw-types/prototypes';

/**
 * Key lists for walking `data.raw` a family at a time, `satisfies`-checked so a typo or a renamed
 * prototype type is a compile error.
 *
 * Walk them with `valuesOf` / `entriesOf` from `src/ts.ts`, not the built-ins: `Object.values`
 * cannot infer one element type from a union of unrelated tables and quietly falls back to its
 * `(o: {}) => any[]` overload, so the loop body stops being type-checked with nothing to warn you.
 * The helpers give you the union of prototypes instead.
 */

/**
 * `data.raw` splits items over one key per subtype, so a recipe's `type: "item"` reference may
 * resolve to any of these. They all extend `ItemPrototype`, hence share `stack_size` / `hidden` /
 * `place_result` / `burnt_result` / `rocket_launch_products`.
 */
export const ITEM_KEYS = [
  'ammo',
  'armor',
  'blueprint',
  'blueprint-book',
  'capsule',
  'copy-paste-tool',
  'deconstruction-item',
  'gun',
  'item',
  'item-with-entity-data',
  'item-with-inventory',
  'item-with-label',
  'item-with-tags',
  'module',
  'rail-planner',
  'repair-tool',
  'selection-tool',
  'space-platform-starter-pack',
  'spidertron-remote',
  'tool',
  'upgrade-item',
] as const satisfies ReadonlyArray<keyof RawData>;

/**
 * Everything the game gives a belt's `speed` to. Only `transport-belt` is ingested; the rest are
 * here for `checkBelts`, which asserts each of them runs at some belt's speed — a tier writes its
 * throughput out once per prototype shape, and this app quotes the belt for the lot.
 */
export const BELT_KEYS = [
  'transport-belt',
  'underground-belt',
  'splitter',
  'loader',
  'loader-1x1',
  'linked-belt',
  'lane-splitter',
] as const satisfies ReadonlyArray<keyof RawData>;
