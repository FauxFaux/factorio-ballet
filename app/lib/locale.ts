export const keys = [
  'achievement',
  'airborne-pollutant',
  'ammo-category',
  'asteroid-chunk',
  'autoplace-control',
  'damage-type',
  'decorative',
  'entity',
  'equipment',
  'fluid',
  'fuel-category',
  'item-group',
  'item',
  'noise-expression',
  'quality',
  'recipe',
  'shortcut',
  'space-connection',
  'space-location',
  'surface',
  'surface-property',
  'technology',
  'tile',
  'virtual-signal',
] as const;

export type Locales = Record<
  (typeof keys)[number],
  {
    names: Record<string, string>;
    descriptions: Record<string, string>;
  }
>;
