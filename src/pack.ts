import type { Cell, CellEntry } from './cell.ts';
import { staticData } from './data/index.ts';
import type { ModuleFill } from './flow.ts';
import type { DesignColumn, DesignDirection, DesignEntity, FactoryDesign } from './design.ts';
import type { ResourceId } from './types.ts';

/**
 * The cells as they go into the URL hash: the same shape, with each recipe and machine prototype
 * id in a recipe entry replaced by its position in the dataset's list of them.
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
  exports?: ResourceId[];
  imports?: ResourceId[];
  name?: string;
  design?: PackedFactoryDesign;
}

interface PackedFactoryDesign {
  columns: PackedDesignColumn[];
}

interface PackedDesignColumn {
  entities: PackedDesignEntity[];
}

/**
 * Entity tags followed by the fields which distinguish them. Belt paths contain one direction
 * character per belt, starting at x/y; each following belt sits one tile along the preceding
 * belt's direction. Keeping these as tuples avoids paying for the very repetitive object keys,
 * while paths additionally avoid paying for every belt position and kind.
 */
type PackedDesignEntity =
  | DesignEntity
  | [0, number, number, number, number, PackedId]
  | [1, number, number, string]
  | [2, number, number, number, number]
  | [3, number, number, number]
  | [4, number, number]
  | [5, number, number, number]
  | [6, number, number, number];

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
  return cells.map((cell) => {
    const { design, ...rest } = cell;
    return {
      ...rest,
      entries: cell.entries.map(packEntry),
      ...(design ? { design: packDesign(design) } : {}),
    };
  });
}

export function unpackCells(cells: PackedCell[]): Cell[] {
  return cells.map((cell) => {
    const { design, ...rest } = cell;
    return {
      ...rest,
      entries: (cell.entries ?? []).map(unpackEntry),
      ...(design ? { design: unpackDesign(design) } : {}),
    };
  });
}

const directions: DesignDirection[] = ['north', 'east', 'south', 'west'];
const directionChars = ['n', 'e', 's', 'w'] as const;

function packDesign(design: FactoryDesign): PackedFactoryDesign {
  return { columns: design.columns.map(packColumn) };
}

function packColumn(column: DesignColumn): PackedDesignColumn {
  const entities: PackedDesignEntity[] = [];
  for (let i = 0; i < column.entities.length; i++) {
    const entity = column.entities[i];
    if (entity.kind !== 'belt') {
      entities.push(packDesignEntity(entity));
      continue;
    }

    const { x, y } = entity.position;
    let path = directionChars[directions.indexOf(entity.direction)];
    let previous = entity;
    while (i + 1 < column.entities.length) {
      const next = column.entities[i + 1];
      if (next.kind !== 'belt' || !beltContinues(previous, next)) break;
      path += directionChars[directions.indexOf(next.direction)];
      previous = next;
      i++;
    }
    entities.push([1, x, y, path]);
  }
  return { entities };
}

function beltContinues(previous: Extract<DesignEntity, { kind: 'belt' }>, next: DesignEntity) {
  if (next.kind !== 'belt') return false;
  const { x, y } = previous.position;
  const [dx, dy] = directionOffset(previous.direction);
  return next.position.x === x + dx && next.position.y === y + dy;
}

function packDesignEntity(entity: Exclude<DesignEntity, { kind: 'belt' }>): PackedDesignEntity {
  const { x, y } = entity.position;
  switch (entity.kind) {
    case 'assembler':
      return [0, x, y, entity.size.width, entity.size.height, recipeIds.toId(entity.recipe)];
    case 'underground-belt':
      return [2, x, y, directions.indexOf(entity.direction), entity.end === 'output' ? 1 : 0];
    case 'splitter':
      return [3, x, y, directions.indexOf(entity.direction)];
    case 'pipe':
      return [4, x, y];
    case 'underground-pipe':
      return [5, x, y, directions.indexOf(entity.direction)];
    case 'inserter':
      return [6, x, y, directions.indexOf(entity.direction)];
  }
}

function unpackDesign(design: PackedFactoryDesign): FactoryDesign {
  return { columns: (design.columns ?? []).map(unpackColumn) };
}

function unpackColumn(column: PackedDesignColumn): DesignColumn {
  // Object entities are the packed representation used before design packing was introduced.
  const entities = (column.entities ?? []).flatMap((entity) =>
    Array.isArray(entity) ? unpackDesignEntity(entity) : [entity as DesignEntity],
  );
  return { entities };
}

function unpackDesignEntity(entity: Exclude<PackedDesignEntity, DesignEntity>): DesignEntity[] {
  const [kind, x, y] = entity;
  const position = { x, y };
  switch (kind) {
    case 0:
      return [
        {
          kind: 'assembler',
          position,
          size: { width: entity[3], height: entity[4] },
          recipe: recipeIds.toName(entity[5]),
        },
      ];
    case 1: {
      const belts: DesignEntity[] = [];
      let beltPosition = position;
      for (const char of entity[3]) {
        const direction =
          directions[directionChars.indexOf(char as (typeof directionChars)[number])];
        belts.push({ kind: 'belt', position: beltPosition, direction });
        const [dx, dy] = directionOffset(direction);
        beltPosition = { x: beltPosition.x + dx, y: beltPosition.y + dy };
      }
      return belts;
    }
    case 2:
      return [
        {
          kind: 'underground-belt',
          position,
          direction: directions[entity[3]],
          end: entity[4] ? 'output' : 'input',
        },
      ];
    case 3:
      return [{ kind: 'splitter', position, direction: directions[entity[3]] }];
    case 4:
      return [{ kind: 'pipe', position }];
    case 5:
      return [{ kind: 'underground-pipe', position, direction: directions[entity[3]] }];
    case 6:
      return [{ kind: 'inserter', position, direction: directions[entity[3]] }];
  }
}

function directionOffset(direction: DesignDirection): [number, number] {
  switch (direction) {
    case 'north':
      return [0, -1];
    case 'east':
      return [1, 0];
    case 'south':
      return [0, 1];
    case 'west':
      return [-1, 0];
  }
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
