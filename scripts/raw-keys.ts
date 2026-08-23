import type { RawData } from 'factorio-raw-types/prototypes';

/**
 * Key lists for walking `data.raw` a family at a time, `satisfies`-checked so a typo or a renamed
 * prototype type is a compile error.
 *
 * Beware the trap at the use site: `Object.entries(raw[key] ?? {})` over a list of keys hands you
 * `any`, because `Object.values`/`entries` cannot infer one element type from a union of unrelated
 * tables and falls back to its `(o: {}) => any[]` overload. Nothing warns you — the loop body just
 * stops being checked. Assign the table to its shared base type first, which costs a line and no
 * assertion:
 *
 * ```ts
 * for (const key of ITEM_KEYS) {
 *   const items: Record<string, ItemPrototype> = raw[key] ?? {};
 *   for (const [id, item] of Object.entries(items)) ...
 * ```
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
