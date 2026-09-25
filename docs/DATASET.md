# Runtime datasets

## Goal

Allow the user to choose the Factorio data used by the planner before the planner boots. A shared
URL must identify and load its own data without first asking the user, and a URL with no state must
allow the user to choose a dataset.

`StaticData` remains the decoded representation of the generated JSON. `Dataset` is the immutable,
computed value constructed from one `StaticData`: it contains the static data, its icon atlas, and
the indexes or other derived values which currently live at module scope. Dataset-dependent
operations remain free functions which receive a `Dataset` (or the narrower value they need); they
are not methods collected on `Dataset`.

The selected dataset has app-lifetime scope. Changing it starts a fresh planner boot rather than
replacing the value underneath an existing plan.

## Shape

The exact fields can evolve while the migration discovers them, but the boundary should resemble:

```ts
export interface Dataset {
  id: DatasetId;
  data: StaticData;
  icons: IconAtlas;

  machineMatchesByCategory: ReadonlyMap<string, readonly MachineMatch[]>;
  moduleMatchesByCategory: ReadonlyMap<string, readonly ModuleMatch[]>;
  moduleCategories: readonly ModuleCategory[];
  beaconTiers: readonly BeaconMatch[];
  beltTiers: readonly BeltMatch[];
  packLandmarks: readonly Landmark[];
}
```

`DatasetId` identifies an exact generated artifact, not just a family which can silently change. For
example, `bobang-r4q` can name the current Bob's and Angel's data and ID ordering. A separately
displayed label supplies the human-readable pack name.

Use readonly collections at the public boundary. Construction may use mutable maps internally, but
application code must be able to assume that a `Dataset` does not change after boot.

Do not add convenience methods such as `dataset.searchRecipes()` or `dataset.defaultMachine()`. Keep
the existing functional modules and make their dependencies explicit:

```ts
export function machinesFor(dataset: Dataset, recipe: Recipe): MachineMatch[] {
  // Read dataset.machineMatchesByCategory.
}

export function resourceName(dataset: Dataset, id: ResourceId): string {
  return dataset.data.resources[id]?.human ?? id;
}
```

Functions which only need `StaticData`, an index, or an individual model should continue to accept
that narrower argument. `Dataset` is not intended to become a generic bag passed to every pure
calculation.

## Assets and catalogue

Each generated dataset package supplies:

- the packed static-data files;
- its data icon sheets and coordinate maps;
- an exact dataset ID and a display label.

Application artwork such as `icons-ui.avif` is not dataset data and stays outside these packages.
Factorio item, fluid, recipe, and entity artwork belongs to the dataset.

Use an explicit TypeScript catalogue with literal imports so Vite can create a chunk per dataset
without a custom loader or filename convention:

```ts
export const datasetCatalogue = {
  "bobang-r4q": {
    label: "Bob's and Angel's",
    load: () => import("./bobang-r4q.ts"),
  },
  "space-age-...": {
    label: "Space Age",
    load: () => import("./space-age-....ts"),
  },
} satisfies Record<DatasetId, DatasetCatalogueEntry>;
```

The imported module exposes enough packed assets to call `createDataset`. Decoding `StaticData`,
joining sprite maps to emitted image URLs, and building all derived indexes happen there or in
`createDataset`; consumers receive one completed `Dataset`.

The catalogue metadata must be lightweight. Importing the selector must not eagerly import every
dataset's JSON and image sheets.

## React boundary

Provide the completed value once at the root:

```tsx
<DatasetProvider value={dataset}>
  <UrlHandler initialState={state} />
</DatasetProvider>
```

`useDataset()` is the component-level entry point. It should throw a clear error outside the
provider rather than quietly falling back to a particular dataset. Components can pass the value to
free functions or read simple data directly:

```ts
const dataset = useDataset();
const name = resourceName(dataset, id);
```

Non-component code must not call a hook. It receives `Dataset`, `StaticData`, or a narrower
dependency through its ordinary function arguments. Context removes repetitive plumbing through the
component tree; it does not introduce an ambient dependency into computation modules.

Key the mounted planner by `dataset.id`, or otherwise unmount it completely when returning to the
selector. URL state, memoized solutions, and local component selections must never survive a dataset
change accidentally.

## URL boot sequence

The dataset is stored in the compressed JSON object. URL decoding must therefore be split into an
envelope phase, which does not require game data, and a hydration phase, which does:

```text
hash
  -> validate outer format and inflate
  -> parse PackedState
  -> read PackedState.dataset
  -> load and construct Dataset
  -> build dataset-specific ID tables
  -> unpack cells and finish UrlState
  -> mount the planner
```

`PackedState` gains an optional dataset field:

```ts
interface PackedState {
  dataset?: DatasetId;
  // Existing packed URL state follows.
}
```

Absence means the legacy built-in Bob's and Angel's revision. This makes existing URLs readable. A
URL containing a recognized dataset loads it without showing the selector. With no hash, use a
remembered preference if that policy is desired, or show the selector; do not write planner state
until a dataset has been selected.

An unknown or unavailable dataset must produce a specific recovery screen. It must not decode the
numeric IDs using another dataset. The screen should retain the original URL and offer selection of
a fresh dataset separately from any future mechanism for locating an archived dataset.

After hydration, hash changes need the same two-stage treatment. A hash naming the currently loaded
dataset can be unpacked in place. A hash naming another dataset triggers a fresh boot/remount after
loading it.

## URL versions and fingerprints

The current `HASH_VERSION` combines two independent concerns:

1. whether the outer representation and compression dictionary can be decoded;
2. which ordered recipe, machine, and module ID tables numeric values refer to.

Keep the outer marker for the first concern. Move the second concern into the exact `DatasetId`. The
dataset fingerprint is still computed from the ordered ID tables, but it validates the dataset
artifact/catalogue entry rather than extending one global `HASH_VERSION`.

No new URL version is required merely to add the optional `dataset` property. Existing hashes have
no property and select the legacy dataset; new hashes carry an exact dataset ID before any numeric
IDs are interpreted. The current full prefix can continue to be accepted as the legacy envelope
marker. Once dataset IDs carry the ordering fingerprint, future changes to one dataset do not change
the outer URL version or invalidate URLs belonging to other datasets.

Refactor `scripts/check-hash-version.ts` accordingly. It should verify that each generated dataset's
declared ID/revision agrees with the fingerprint of its recipe, machine, and module key order. It
should separately check the outer URL marker only when the envelope or compression dictionary
changes.

## Packing API

`src/boot/pack.ts` must not import `staticData` or construct tables at module evaluation time. Build
a codec from the selected dataset:

```ts
export interface CellCodec {
  packCells(cells: Cell[]): PackedCell[];
  unpackCells(cells: PackedCell[]): Cell[];
}

export function createCellCodec(dataset: Dataset): CellCodec;
```

The closures returned by `createCellCodec` own the recipe, machine, and module ID tables. The URL
envelope functions accept the codec, or the selected `Dataset` from which to create it. They do not
read context or a process-wide current dataset.

Preserve the current stale-name behavior: an unknown string ID round-trips as a string, and an
out-of-range numeric ID becomes a visibly missing name rather than resolving to a different
prototype. An exact dataset ID should make the latter exceptional, but it remains the safe failure
mode for damaged state.

## Icons

Replace the global `icons` export with an `IconAtlas` constructed for the dataset. Keep sprite
lookup and CSS formatting as free functions:

```ts
export type IconSprite = readonly [url: string, x: number, y: number, sheetSize: number];

export interface IconAtlas {
  readonly sprites: Readonly<Record<string, IconSprite>>;
}

export function iconSprite(atlas: IconAtlas, ...keys: string[]): IconSprite;
export function iconStyle(atlas: IconAtlas, ...keys: string[]): string;
```

`ResourceIcon` and other leaf components obtain the atlas through `useDataset()`. Helpers such as
`recipeIconStyle` and `machineIconStyle` receive the atlas explicitly. Their model arguments remain
unchanged.

Preloading begins only after selection. Preload the shared UI sheet independently, then the selected
dataset's first/high-value sheet followed by its remaining sheets. `preload-icons.ts` should accept
sheet URLs rather than importing the current five files. The Vite HTML injection should preload only
shared assets; it cannot know which data sheets an unbooted user will select.

## Derived data migration

Move every value computed from `staticData` at module scope into `createDataset` or a helper it
calls. The initial known set is:

- `data/machines.ts`: machines by crafting category;
- `data/modules.ts`: modules by category and the available module categories;
- `data/index.ts`: science-pack landmarks, beacon tiers, and belt tiers;
- `boot/pack.ts`: ordered ID tables;
- `data/decode-icons.ts`: the combined sprite lookup.

Ordinary lookups currently hidden inside functions must also become explicit arguments, including
resource and recipe names, search, module selection and effects, inserter throughput, and the cell
helpers which resolve recipe or machine IDs.

Avoid duplicating derived data in both `Dataset` and module-local caches. Construction owns the
indexes; free functions consume them. If an index is only useful to one module, its exported type
may remain opaque, but it still belongs to the dataset instance rather than the ES module instance.

### Current module-scope audit

The following application values are currently computed from the built-in `staticData` while their
modules are evaluated. They need to be constructed from the selected dataset as the migration
proceeds:

- `src/boot/pack.ts:104-106`: recipe, machine, and module ID tables.
- `src/data/index.ts:45-47`: science-pack landmarks; `:72-83`: sorted beacon tiers; and `:137-146`:
  sorted belt tiers.
- `src/data/machines.ts:29-40`: machines indexed by crafting category.
- `src/data/modules.ts:61-83`: modules indexed by module category and the derived module-category
  list.
- `src/dataset/index.ts:20`: the built-in `defaultDataset` is constructed from `staticData` at
  module scope. This is legacy default-dataset wiring rather than a reusable derived index.

The recipe-suggestion indexes and resource-chain finder now come from `src/dataset/precompute.ts`
when `createDataset` constructs a dataset.

Other `staticData` references found in application source are inside functions and do not currently
produce a module-scope derived value: `src/cell.ts:114,168,213,363`,
`src/compute/kernel-problems.ts:121`, `src/compute/modules.ts:175,184,187,347`,
`src/data/inserter-throughput.ts:144-153`, `src/data/machines.ts:13-26`,
`src/data/module-effects.ts:41,94`, `src/data/modules.ts:5-11,125`, and
`src/data/search.ts:67-87,141-183`. These still bind those operations to the built-in dataset; they
need explicit dataset inputs for multi-dataset operation, but are not eager module-scope
derivations.

`src/data/decode.ts:10-178` loads and decodes the generated artifact and exports `staticData`; this
is the source value rather than a derived index. `src/dataset/index.ts:20` currently consumes it to
create the legacy dataset.

## Incremental implementation

Implement this in stages while retaining the current dataset as a compatibility fixture:

1. Export the static decoder and introduce the `Dataset`, `IconAtlas`, `DatasetId`, and
   `createDataset` types/functions. Construct a `defaultDataset` from today's assets.
2. Move module-scope derived values into `createDataset`. Change their consuming free functions to
   accept `Dataset`; update tests to pass `defaultDataset`.
3. Change remaining data-dependent computation and cell helpers to explicit arguments. Pure
   functions which do not inspect dataset data remain unchanged.
4. Introduce `DatasetProvider` and migrate components from direct `staticData`/global-icon imports
   to `useDataset()` plus free functions.
5. Split URL envelope parsing from cell hydration and replace `pack.ts`'s global tables with
   `createCellCodec(dataset)`. Preserve legacy URLs by defaulting a missing dataset field.
6. Add the lightweight catalogue and boot selector, then package a second dataset to exercise the
   complete path. Do not expose selection while any production path still reads the old globals.
7. Make icon loading and preloading dataset-specific. Confirm the initial bundle does not contain
   every dataset's data or sprites.
8. Remove the compatibility `staticData` and global `icons` exports after `rg` finds no production
   imports. Tests may import `defaultDataset` as a fixture, but should use the same public free
   functions as the application.
9. Update architecture documentation and ingestion output paths once the final package layout is
   established.

Prefer mechanical signature changes in separate commits from boot behavior changes. That keeps the
large dependency-injection migration reviewable and lets tests demonstrate that calculations are
unchanged before multiple datasets are introduced.

## Validation

Add focused coverage for:

- constructing two datasets in one test process without shared indexes;
- machine, module, search, and naming functions returning results from the argument supplied;
- icon lookup using only the selected atlas, including unknown fallbacks;
- old hashes with no dataset selecting the legacy dataset;
- new hashes loading their named dataset before unpacking numeric IDs;
- the same numeric packed ID resolving differently under two deliberately different fixture ID
  tables, proving the envelope chooses the table first;
- unknown dataset IDs failing without attempting hydration;
- packing and unpacking round-tripping independently for each dataset;
- switching datasets performing a full remount with fresh URL and component state;
- production build output keeping non-selected dataset assets out of the initial eager chunk.

Run formatting, lint, the focused boot/data tests, and the complete test suite before enabling the
selector.

## Non-goals

- Runtime ingestion of arbitrary Factorio dumps in the browser.
- A mutable global current dataset or an initialization-order-dependent service locator.
- Making `Dataset` a class or turning existing calculations into methods.
- Hot-swapping datasets underneath an existing `UrlState`.
- Guessing that a plan belongs to a similarly named or newer dataset when its exact artifact is
  unavailable.
