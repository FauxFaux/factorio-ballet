import type { RLocale } from './raw-validators.ts';

/** What the game writes for a prototype whose localised_name it could not resolve. */
const SENTINELS = new Set([
  'Something went wrong',
  'Unknown entity',
  'Unknown fluid',
  'Unknown item',
  'Unknown',
  'Unknown recipe',
  'Unknown tile',
  'Unknown signal',
]);

/**
 * The display name for a prototype, or undefined if the game could not produce one.
 *
 * The game resolves every prototype's `localised_name` when it writes the `*-locale.json` dumps,
 * keyed by prototype id, so there is nothing for us to interpret: parameterised templates
 * (`["item-name.filled-gas-canister", ["fluid-name.angels-gas-dinitrogen-tetroxide"]]` against
 * `filled-gas-canister=Bottled __1__`) arrive already expanded to "Bottled Dinitrogen tetroxide
 * gas". We used to reconstruct the string from `localised_name` ourselves; measured against the
 * dumps that resolved nothing they lacked, missed hundreds they had, and got 37 names wrong.
 */
export function resolveLocale(
  id: string,
  locales: Record<string, RLocale>,
  type: string,
): string | undefined {
  const name = locales[type]?.names[id];
  return name === undefined || SENTINELS.has(name) ? undefined : name;
}
