import type { Cell, CellEntry } from './cell.ts';
import { staticData } from './data/index.ts';
import type { ModuleFill } from './flow.ts';

/**
 * The cells as they go into the URL hash: the same shape, with every prototype id replaced by its
 * position in the dataset's list of them.
 *
 * A recipe id is a name — the game has no numeric ids, and `data.raw` keys everything by prototype
 * name — which at 26 characters apiece is most of what a full plan's hash is made of. Deflate can
 * only do so much with them: the dictionary covers the key names, but the *values* are ~2300 names
 * a state picks a dozen of, so each one is paid for in full the first time it appears. An index
 * into `Object.keys` costs three digits instead, and a plan of a hundred recipes packs to a
 * third of what it did.
 *
 * The index is a fact about one dataset and not about the game, which is why {@link fingerprint} is
 * in the hash's version prefix: regenerating `static.json` renumbers everything, and an old hash
 * read against the new numbering would quietly name the wrong recipes. It is checked rather than
 * bumped by hand because the ingest is a script and the version letter is in another file.
 */
export interface PackedCell {
  entries: PackedEntry[];
  name?: string;
}

/** {@link CellEntry} with its ids packed; see {@link PackedId} for why the types are unions. */
export interface PackedEntry {
  recipe: PackedId;
  machine?: PackedId;
  count?: number;
  /**
   * The module fill as pairs rather than an object, because the order of a loadout is the order it
   * fills the slots in (`CellEntry.modules`) and JavaScript enumerates integer-like keys of an
   * object in numeric order however they were inserted — so `{"7":1,"3":2}` would come back the
   * other way round and quietly re-slot the machine.
   */
  modules?: [PackedId, number][];
  productivityModules?: number;
  speedModules?: number;
  beacons?: number;
}

/**
 * An index into the dataset's ids, or the id itself when the dataset does not have it — which is
 * what a hash written against an older `static.json` leaves behind, and which the app already
 * tolerates (`entryRecipe` returns `undefined`, the row draws as missing). Packing a name we cannot
 * number keeps it rather than dropping the row, so a stale URL survives a round trip through the
 * app unchanged.
 */
export type PackedId = number | string;

/** A list of prototype ids, and the two ways of crossing it. */
interface IdTable {
  toId(name: string): PackedId;
  toName(id: PackedId): string;
}

function idTable(names: string[]): IdTable {
  const indices = new Map(names.map((name, i) => [name, i]));
  return {
    toId: (name) => indices.get(name) ?? name,
    // An index the dataset no longer reaches becomes a name nothing matches, which is the same
    // thing as a recipe the dataset dropped: visibly missing rather than silently something else.
    toName: (id) => (typeof id === 'number' ? (names[id] ?? `#${id}`) : id),
  };
}

const recipeIds = idTable(Object.keys(staticData.recipes));
const machineIds = idTable(Object.keys(staticData.machines));
const moduleIds = idTable(Object.keys(staticData.modules));

export function packCells(cells: Cell[]): PackedCell[] {
  return cells.map((cell) => ({
    ...cell,
    entries: cell.entries.map(packEntry),
  }));
}

export function unpackCells(cells: PackedCell[]): Cell[] {
  return cells.map((cell) => ({
    ...cell,
    entries: (cell.entries ?? []).map(unpackEntry),
  }));
}

function packEntry(entry: CellEntry): PackedEntry {
  const packed: PackedEntry = { recipe: recipeIds.toId(entry.recipe) };
  if (entry.machine !== undefined) packed.machine = machineIds.toId(entry.machine);
  if (entry.count !== undefined) packed.count = entry.count;
  const modules = packModules(entry.modules);
  if (modules) packed.modules = modules;
  if (entry.productivityModules !== undefined) {
    packed.productivityModules = entry.productivityModules;
  }
  if (entry.speedModules !== undefined) packed.speedModules = entry.speedModules;
  if (entry.beacons !== undefined) packed.beacons = entry.beacons;
  return packed;
}

function unpackEntry(packed: PackedEntry): CellEntry {
  const entry: CellEntry = { recipe: recipeIds.toName(packed.recipe) };
  if (packed.machine !== undefined) entry.machine = machineIds.toName(packed.machine);
  if (packed.count !== undefined) entry.count = packed.count;
  const modules = unpackModules(packed.modules);
  if (modules) entry.modules = modules;
  if (packed.productivityModules !== undefined) {
    entry.productivityModules = packed.productivityModules;
  }
  if (packed.speedModules !== undefined) entry.speedModules = packed.speedModules;
  if (packed.beacons !== undefined) entry.beacons = packed.beacons;
  return entry;
}

function packModules(fill: ModuleFill | undefined): [PackedId, number][] | undefined {
  const entries = Object.entries(fill ?? {});
  if (entries.length === 0) return undefined;
  return entries.map(([module, count]) => [moduleIds.toId(module), count]);
}

function unpackModules(packed: [PackedId, number][] | undefined): ModuleFill | undefined {
  if (!packed?.length) return undefined;
  return Object.fromEntries(packed.map(([module, count]) => [moduleIds.toName(module), count]));
}

/**
 * A short digest of every id {@link packCells} numbers, in the order it numbers them. Two datasets
 * agreeing on this agree on what every index means; two which do not must not read each other's
 * hashes, so this goes in the hash's version prefix and an old URL fails the way an unrecognised
 * one does — a page saying to start fresh, rather than a plan of the wrong recipes.
 */
export const fingerprint: string = (() => {
  // FNV-1a, over the ids with a separator so that reordering or resplitting them shows up.
  let hash = 0x811c9dc5;
  for (const names of [staticData.recipes, staticData.machines, staticData.modules]) {
    for (const name of Object.keys(names)) {
      for (let i = 0; i < name.length; i++) {
        hash = Math.imul(hash ^ name.charCodeAt(i), 0x01000193);
      }
      hash = Math.imul(hash ^ 0x1f, 0x01000193);
    }
  }
  return (hash >>> 0).toString(36).padStart(3, '0').slice(-3);
})();
