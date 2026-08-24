import {
  complexityOf,
  defaultMachine,
  machinesFor,
  NO_CHOICE,
  resourceName,
  staticData,
  type Chosen,
} from './data.ts';
import {
  laidOutEffects,
  NO_EFFECTS,
  NO_LAYOUT,
  type Effects,
  type Layout,
  type ModuleFill,
  type ModuleWants,
} from './flow.ts';
import type { SearchScope } from './search.ts';
import type { MachineId, ModuleId, Recipe, ResourceId } from './types.ts';

/**
 * A unit of work in a factory: a handful of recipes, run in machines, whose inputs and outputs are
 * meant to be closed and understood — a human-sized sub-factory rather than a whole plan. See
 * `CELL.md` for what a cell is for; this file is only its shape and the set arithmetic over it.
 *
 * A cell holds no rates yet. Scaling the recipes against each other is the solver's job, and the
 * solver is not in this repo; `CellEntry.count` is where its answer (or the user's pin) will go.
 */
export interface Cell {
  entries: CellEntry[];
  /** What the user called it, if they bothered; otherwise {@link cellTitle} names it after a recipe. */
  name?: string;
}

/**
 * One recipe running in one kind of machine. Keys are spelled out rather than squeezed to two
 * letters like `UrlState`'s: the hash dictionary only covers the top-level default state, so a
 * nested key pays for itself once and is then a deflate back-reference however many entries there
 * are.
 */
export interface CellEntry {
  /** Key into `StaticData.recipes`. */
  recipe: string;
  /** Which machine runs it; absent means "whichever", i.e. {@link entryMachine}'s default. */
  machine?: MachineId;
  /** How many of that machine. Absent means "not decided" — for the solver to work out. */
  count?: number;
  /**
   * What is in the machine's slots, if anything: how many of each module. Absent is an empty
   * machine, which is {@link NO_EFFECTS} — never a default loadout, because a module is a thing
   * the user has to have built and put there.
   *
   * Kept in the order the user chose them, which is the order they fill the slots in: a loadout
   * outlives the machine it was chosen for, and `moduleEffects` drops whatever no longer
   * fits from the end rather than scaling everything down. The hash packs cells with the key order
   * they have, so that survives a reload.
   */
  modules?: ModuleFill;

  /**
   * How many productivity modules go in the machine. Capped at the slots it has, because that is
   * the only place a productivity module can be — no beacon transmits productivity. Absent is auto:
   * as many as fit on a recipe which pays for them, and none at all on one which does not.
   *
   * A count and not a loadout, because which tier is meant is one decision in the header rather
   * than a repeated one (`Chosen`); the row says how many, never which.
   */
  productivityModules?: number;

  /**
   * How many speed modules this row is to feel, wherever they have to go to get there: whatever
   * slots the productivity modules left, and then as many beacons as the rest of them take. Absent
   * is auto — fill those slots, build no beacons.
   *
   * Not capped, and that is the difference between the two boxes: a beacon reaches a machine whose
   * own slots are full, so "I want this smelter going four times as fast" is a number the user can
   * state and how many beacons it comes to is the answer rather than the question.
   */
  speedModules?: number;
}

/**
 * What a cell looks like from outside: which resources cross its edge, and which never leave.
 *
 * Set arithmetic only — a resource both made and used inside the cell is `internal` whether or not
 * the amounts actually balance, because nothing here knows amounts. Once the solver lands, an
 * unbalanced internal resource becomes a partial input or output; until then "the cell handles this
 * itself" is the honest reading.
 */
export interface CellInterface {
  /** Used by a recipe in the cell, made by none: what the cell must be fed. */
  inputs: ResourceId[];
  /** Made by a recipe in the cell, used by none: what the cell hands on. */
  outputs: ResourceId[];
  /** Both made and used inside; the cell's own business. */
  internal: ResourceId[];
}

export function newCell(recipe?: string): Cell {
  return { entries: recipe ? [{ recipe }] : [] };
}

/** The recipe an entry names, or `undefined` if the data no longer has it (a stale URL). */
export function entryRecipe(entry: CellEntry): Recipe | undefined {
  return staticData.recipes[entry.recipe];
}

/**
 * The machine an entry runs in: the one it names, or — when it names none — whichever machine
 * `defaultMachine` says suits `progress`, the player's way through the game. That default is a
 * display convenience, not a choice: nothing writes it back, and it moves as the slider does.
 */
export function entryMachine(
  entry: CellEntry,
  recipe: Recipe,
  progress: number,
): MachineId | undefined {
  return entry.machine ?? defaultMachine(machinesFor(recipe), progress)?.id;
}

/**
 * What this row's modules do to it: the two multipliers the rates are scaled by, at the machine the
 * row is running in — which decides both how many slots there are and which effects the machine
 * bothers to apply, so the same loadout is worth different things in different machines. Take the
 * machine from {@link entryMachine}, so that an unpinned row's effects move with the slider exactly
 * as its machine does.
 */
export function entryEffects(
  entry: CellEntry,
  recipe: Recipe,
  machine: MachineId | undefined,
  chosen: Chosen = NO_CHOICE,
): Effects {
  return entryRun(entry, recipe, machine, chosen).effects;
}

/** What a row is running at, and where its modules went; see {@link entryRun}. */
export interface EntryRun {
  effects: Effects;
  layout: Layout;
}

/**
 * A row resolved: the two multipliers the solver scales its rates by, and the {@link Layout} which
 * is how the row's two module counts were laid out to get them. Both come out of one pass, because
 * the two families share the machine — how many slots the productivity modules take decides how
 * many are left for speed, and so how many beacons the speed took.
 *
 * `chosen` is what the header means by a module of each family and by a beacon; the row states how
 * many modules of each, never which, so a save that upgrades to speed module 3 — or to a six-slot
 * beacon — upgrades every row at once.
 */
export function entryRun(
  entry: CellEntry,
  recipe: Recipe,
  machine: MachineId | undefined,
  chosen: Chosen = NO_CHOICE,
): EntryRun {
  const found = machine === undefined ? undefined : staticData.machines[machine];
  if (!found) return { effects: NO_EFFECTS, layout: NO_LAYOUT };
  return laidOutEffects(
    found,
    entry.modules,
    recipe,
    chosen.modules,
    entryWants(entry),
    chosen.beacon,
  );
}

/** What the row is asking for, as {@link moduleLayout} takes it. */
export function entryWants(entry: CellEntry): ModuleWants {
  return { productivity: entry.productivityModules, speed: entry.speedModules };
}

/** How many slots a loadout asks for, which is not necessarily how many the machine has. */
export function slotsUsed(fill: ModuleFill | undefined): number {
  return Object.values(fill ?? {}).reduce((a, b) => a + b, 0);
}

/**
 * The entry with `count` of `module` in its slots; zero or fewer takes it out. A module already in
 * there keeps its place in the queue for the slots, and a new one joins the back of it.
 *
 * Nothing here checks the machine has the slots: which machine a row is in is a separate decision
 * which the user can change afterwards, so the loadout is what they asked for and `moduleEffects`
 * in `src/flow.ts` is where it meets what will fit.
 */
export function withModule(entry: CellEntry, module: ModuleId, count: number): CellEntry {
  const modules = { ...entry.modules };
  if (count > 0) modules[module] = count;
  else delete modules[module];
  return Object.keys(modules).length > 0 ? { ...entry, modules } : { ...entry, modules: undefined };
}

export function cellTitle(cell: Cell): string {
  if (cell.name) return cell.name;
  const first = cell.entries[0];
  if (!first) return 'Empty cell';
  return staticData.recipes[first.recipe]?.human ?? first.recipe;
}

export function hasRecipe(cell: Cell, recipe: string): boolean {
  return cell.entries.some((entry) => entry.recipe === recipe);
}

/** The cell with `recipe` in it; unchanged if it already is, as a cell runs each recipe once. */
export function withRecipe(cell: Cell, recipe: string): Cell {
  if (hasRecipe(cell, recipe)) return cell;
  return { ...cell, entries: [...cell.entries, { recipe }] };
}

export function withEntry(cell: Cell, index: number, entry: CellEntry): Cell {
  return { ...cell, entries: cell.entries.map((old, i) => (i === index ? entry : old)) };
}

export function withoutEntry(cell: Cell, index: number): Cell {
  return { ...cell, entries: cell.entries.filter((_, i) => i !== index) };
}

/** The cell with `entries[from]` moved to sit at `to`, shifting whatever was between them. */
export function moveEntry(cell: Cell, from: number, to: number): Cell {
  if (from === to) return cell;
  const entries = [...cell.entries];
  const [moved] = entries.splice(from, 1);
  entries.splice(to, 0, moved);
  return { ...cell, entries };
}

/**
 * How many of the entry's machine, read off what was typed into the count box. Anything which is
 * not a number — including the empty box — is "not decided", which is what `CellEntry.count`'s
 * absence means.
 */
export function parseCount(raw: string): number | undefined {
  const count = Number(raw);
  return raw && Number.isFinite(count) ? count : undefined;
}

/**
 * How many modules were asked for, off the box they were typed into. Whole and not negative, which
 * a count of machines is not: half a module is not a thing you can build, and the empty box is
 * "auto" exactly as it is for a count.
 */
export function parseModules(raw: string): number | undefined {
  const count = Number(raw);
  return raw && Number.isFinite(count) ? Math.max(0, Math.floor(count)) : undefined;
}

export function withoutCell(list: Cell[], index: number): Cell[] {
  return list.filter((_, i) => i !== index);
}

/**
 * Which cell is being worked on once `removed` has gone: the same one, which has shifted down the
 * list if it sat after the hole, and clamped into what is left when the cell being worked on was
 * itself the last one. `remaining` is the length after the removal.
 */
export function activeAfterRemoval(active: number, removed: number, remaining: number): number {
  return Math.min(active > removed ? active - 1 : active, Math.max(0, remaining - 1));
}

export function cellInterface(cell: Cell): CellInterface {
  const used = new Set<ResourceId>();
  const made = new Set<ResourceId>();
  for (const entry of cell.entries) {
    const recipe = entryRecipe(entry);
    if (!recipe) continue;
    for (const ingredient of recipe.ingredients) used.add(ingredient.resource);
    for (const product of recipe.products) made.add(product.resource);
  }
  return {
    inputs: simplestFirst([...used].filter((id) => !made.has(id))),
    outputs: simplestFirst([...made].filter((id) => !used.has(id))),
    internal: simplestFirst([...made].filter((id) => used.has(id))),
  };
}

/** The cell's open edges, as the recipe search's `makes:@in` / `uses:@out` read them. */
export function scopeOf(iface: CellInterface): SearchScope {
  return { in: new Set(iface.inputs), out: new Set(iface.outputs) };
}

/**
 * Simplest first, which down a column of ores and plates reads like the chain does; the progress
 * slider deliberately does not come into it, because where the player is says nothing about which
 * end of a cell's own interface to show first.
 */
function simplestFirst(ids: ResourceId[]): ResourceId[] {
  return ids.toSorted(
    (a, b) =>
      complexityOf(staticData.resources[a] ?? {}) - complexityOf(staticData.resources[b] ?? {}) ||
      resourceName(a).localeCompare(resourceName(b)),
  );
}
