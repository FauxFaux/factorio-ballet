const { icons } = await import('../data/decode-icons.ts');
import type { Machine, MachineId, Recipe, ResourceId } from '../types.ts';

/** Look up an icon sprite without exposing the decoded sprite table to eager modules. */
export function iconSprite(...keys: string[]): [string, number, number, number] {
  for (const key of keys) {
    const icon = icons[key];
    if (icon) return icon;
  }
  return icons['item:item-unknown'];
}

/**
 * CSS for a single sprite from the icon spritesheet; the first key which exists wins.
 *
 * The background offsets and size describe the sheet's 32px grid. Apply this to a source-sized
 * 1.7778rem (32px at the 18px root) element. If an icon needs a smaller layout box, keep this
 * styled element at that size inside a wrapper and scale it from `top left`; shrinking this element
 * itself changes the crop rather than scaling the sprite.
 */
export function iconStyle(...keys: string[]): string {
  return spriteStyle(iconSprite(...keys));
}

function spriteStyle([url, x, y, sheetSize]: [string, number, number, number]): string {
  return `background: url("${url}") ${-x / 18}rem ${-y / 18}rem / ${sheetSize / 18}rem no-repeat`;
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
  return iconStyle(`recipe:${id}`, ...(product ? [product] : []), 'recipe:recipe-unknown');
}

/**
 * Prefer the entity's own artwork, then the item which places it. Those share a name for nearly
 * every machine, but not all — Angel's heavy offshore pump is the entity
 * `angels-sea-pump-placeable` placed by the item `angels-sea-pump`.
 */
export function machineIconStyle(id: MachineId, machine: Machine): string {
  const standin = MACHINE_ICON_STANDIN[id];
  return iconStyle(
    `entity:${id}`,
    ...(machine.item ? [`item:${machine.item}`] : []),
    ...(standin ? [standin] : []),
    'item:item-unknown',
  );
}

/** The sprite for a resource, for places which label it themselves. */
export function resourceIconStyle(id: ResourceId): string {
  return iconStyle(id, id.startsWith('fluid:') ? 'fluid:fluid-unknown' : 'item:item-unknown');
}
