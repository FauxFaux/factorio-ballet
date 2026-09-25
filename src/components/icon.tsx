import { type IconMap } from '../data/icon-map.ts';
import type { Machine, MachineId, Recipe, ResourceId } from '../types.ts';

/** A plain fluid droplet for fluids which have a colour, but no icon artwork. */
export function GenericFluidIcon({ color }: { color: string }) {
  return (
    <svg width="32" height="32" viewBox="0 0 48 56" role="img" aria-label="Fluid" focusable="false">
      <path
        fill={color}
        d="M21.5 7.5C20.1 13.4 9.5 28.6 9.5 36.5c0 7.5 5.4 13 12.5 13s12.5-5.5 12.5-13c0-7.9-10.7-23.1-13-29Z"
      />
    </svg>
  );
}

/** A plain, top-lit cube for solids which have a colour, but no icon artwork. */
export function GenericSolidIcon({ color }: { color: string }) {
  return (
    <svg width="32" height="32" viewBox="0 0 54 54" role="img" aria-label="Solid" focusable="false">
      <path fill={color} d="M27 4 48 16 27 28 6 16Z" />
      <path fill={color} fill-opacity="0.72" d="m6 16 21 12v23L6 39Z" />
      <path fill={color} fill-opacity="0.46" d="m27 28 21-12v23L27 51Z" />
    </svg>
  );
}

/** Look up an icon sprite without exposing the decoded sprite table to eager modules. */
export function iconSprite(iconMap: IconMap, ...keys: string[]): [string, number, number, number] {
  for (const key of keys) {
    const icon = iconMap[key];
    if (icon) return icon;
  }
  return iconMap['item:item-unknown'];
}

/**
 * CSS for a single sprite from the icon spritesheet; the first key which exists wins.
 *
 * The background offsets and size describe the sheet's 32px grid. Apply this to a source-sized
 * 1.7778rem (32px at the 18px root) element. If an icon needs a smaller layout box, keep this
 * styled element at that size inside a wrapper and scale it from `top left`; shrinking this element
 * itself changes the crop rather than scaling the sprite.
 */
export function iconStyle(iconMap: IconMap, ...keys: string[]): string {
  return spriteStyle(iconSprite(iconMap, ...keys));
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
export function recipeIconStyle(iconMap: IconMap, id: string, recipe: Recipe): string {
  const product = recipe.products[0]?.resource;
  return iconStyle(iconMap, `recipe:${id}`, ...(product ? [product] : []), 'recipe:recipe-unknown');
}

/**
 * Prefer the entity's own artwork, then the item which places it. Those share a name for nearly
 * every machine, but not all — Angel's heavy offshore pump is the entity
 * `angels-sea-pump-placeable` placed by the item `angels-sea-pump`.
 */
export function machineIconStyle(iconMap: IconMap, id: MachineId, machine: Machine): string {
  const standin = MACHINE_ICON_STANDIN[id];
  return iconStyle(
    iconMap,
    `entity:${id}`,
    ...(machine.item ? [`item:${machine.item}`] : []),
    ...(standin ? [standin] : []),
    'item:item-unknown',
  );
}

/** The sprite for a resource, for places which label it themselves. */
export function resourceIconStyle(iconMap: IconMap, id: ResourceId): string {
  return iconStyle(
    iconMap,
    id,
    id.startsWith('fluid:') ? 'fluid:fluid-unknown' : 'item:item-unknown',
  );
}
