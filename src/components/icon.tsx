import iconsUrl from '../assets/icons.avif';
import iconsData from '../assets/icons.json';
import { bareName } from '../search.ts';
import type { Machine, MachineId, Recipe, ResourceId } from '../types.ts';

const icons = iconsData as unknown as Record<string, [number, number]>;

/** CSS for a single sprite from the icon spritesheet; the first key which exists wins. */
export function iconStyle(...keys: string[]): string {
  for (const key of keys) {
    const pos = icons[key];
    if (pos) return `background: url("${iconsUrl}") -${pos[0]}px -${pos[1]}px no-repeat`;
  }
  return `background: url("${iconsUrl}") 0 0 no-repeat`;
}

/** Machines with no item of their own to borrow an icon from, and what stands in instead. */
const MACHINE_ICON_STANDIN: Record<MachineId, ResourceId> = {
  character: 'item:light-armor',
};

/**
 * A synthetic recipe has no `recipe:` artwork of its own — the game has no recipe to draw — so it
 * borrows its first product's. Real recipes all have their own key and never reach the fallback.
 */
export function recipeIconStyle(id: string, recipe: Recipe): string {
  const product = recipe.products[0]?.resource;
  return iconStyle(
    `recipe:${id}`,
    ...(product ? [`craft:${bareName(product)}`] : []),
    'recipe:recipe-unknown',
  );
}

/**
 * The spritesheet is keyed by item and recipe, not by entity, so a machine's icon is really its
 * item's. Those share a name for nearly every machine, but not all — Angel's heavy offshore pump is
 * the entity `angels-sea-pump-placeable` placed by the item `angels-sea-pump` — hence the second
 * try. See `INGEST.md`: a regenerated sheet would carry `entity:` keys and settle this properly.
 */
export function machineIconStyle(id: MachineId, machine: Machine): string {
  const standin = MACHINE_ICON_STANDIN[id];
  return iconStyle(
    `craft:${id}`,
    ...(machine.item ? [`craft:${machine.item}`] : []),
    ...(standin ? [`craft:${bareName(standin)}`] : []),
    'craft:item-unknown',
  );
}

/** The sprite for a resource, for places which label it themselves. */
export function resourceIconStyle(id: ResourceId): string {
  const colon = id.indexOf(':');
  const kind = id.slice(0, colon);
  const name = id.slice(colon + 1);
  return iconStyle(
    `craft:${name}`,
    kind === 'fluid' ? 'craft:fluid-unknown' : 'craft:item-unknown',
  );
}
