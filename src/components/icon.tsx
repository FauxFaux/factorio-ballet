import icons0Url from '../assets/icons-0.avif';
import icons0Data from '../assets/icons-0.json';
import icons1Url from '../assets/icons-1.avif';
import icons1Data from '../assets/icons-1.json';
import icons2Url from '../assets/icons-2.avif';
import icons2Data from '../assets/icons-2.json';
import icons3Url from '../assets/icons-3.avif';
import icons3Data from '../assets/icons-3.json';
import iconsUiUrl from '../assets/icons-ui.avif';
import iconsUiData from '../assets/icons-ui.json';
import type { Machine, MachineId, Recipe, ResourceId } from '../types.ts';

type Icon = [url: string, x: number, y: number];
type IconData = Record<string, [number, number]>;

function iconsFromSheet(url: string, data: unknown): Record<string, Icon> {
  return Object.fromEntries(
    Object.entries(data as IconData).map(([key, [x, y]]) => [key, [url, x, y]]),
  );
}

const icons: Record<string, Icon> = {
  ...iconsFromSheet(icons0Url, icons0Data),
  ...iconsFromSheet(icons1Url, icons1Data),
  ...iconsFromSheet(icons2Url, icons2Data),
  ...iconsFromSheet(icons3Url, icons3Data),
  ...iconsFromSheet(iconsUiUrl, iconsUiData),
};

/** CSS for a single sprite from the icon spritesheet; the first key which exists wins. */
export function iconStyle(...keys: string[]): string {
  for (const key of keys) {
    const icon = icons[key];
    if (icon) return `background: url("${icon[0]}") -${icon[1]}px -${icon[2]}px no-repeat`;
  }
  const [url, x, y] = icons['item:item-unknown'];
  return `background: url("${url}") -${x}px -${y}px no-repeat`;
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
