import iconsUrl from '../assets/icons.avif';
import iconsData from '../assets/icons.json';

const icons = iconsData as unknown as Record<string, [number, number]>;

/** CSS for a single sprite from the icon spritesheet; the first key which exists wins. */
export function iconStyle(...keys: string[]): string {
  for (const key of keys) {
    const pos = icons[key];
    if (pos) return `background: url("${iconsUrl}") -${pos[0]}px -${pos[1]}px no-repeat`;
  }
  return `background: url("${iconsUrl}") 0 0 no-repeat`;
}
