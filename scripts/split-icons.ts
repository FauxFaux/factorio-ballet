#!/usr/bin/env node

/**
 * Split the application's 32px icon sheet into one always-needed UI sheet and four sheets ordered
 * by progression complexity. The metadata is deliberately read in insertion order: aliases which
 * point at one source cell stay together, and both cells and keys keep their source ordering inside
 * each output sheet.
 *
 *   npm run split-icons
 *   npm run split-icons -- SCRIPT_OUTPUT_DIR
 *
 * By default this reads ~/ins/factorio-2-73-ab/script-output/icons.png and its adjacent icons.json,
 * then writes all five output pairs beside them.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const CELL_SIZE = 32;
const COMPLEXITY_SHEETS = 4;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDir, '..');

type Coordinate = [number, number];
type Icons = Record<string, Coordinate>;

/** The small subset of static data which decides where an icon belongs. */
export interface IconData {
  recipes: Record<string, { complexity?: number }>;
  resources: Record<string, { complexity?: number }>;
  machines: Record<string, { item?: string }>;
  modules: Record<string, unknown>;
  beacons: Record<string, { item?: string }>;
  belts: Record<string, { item?: string }>;
}

export interface IconCell {
  source: Coordinate;
  keys: string[];
  order: number;
  complexity: number;
}

export interface IconSplit {
  name: string;
  cells: IconCell[];
}

function iconId(key: string): string {
  const colon = key.indexOf(':');
  return colon < 0 ? key : key.slice(colon + 1);
}

function iconKind(key: string): string {
  const colon = key.indexOf(':');
  return colon < 0 ? '' : key.slice(0, colon);
}

/** Every prototype whose icon is needed in controls even when its complexity sheet is not loaded. */
function uiIconIds(data: IconData): Set<string> {
  const ids = new Set<string>();
  const add = (id: string | undefined) => {
    if (id !== undefined) ids.add(id);
  };

  for (const [id, belt] of Object.entries(data.belts)) {
    add(id);
    add(belt.item);
  }
  for (const id of Object.keys(data.modules)) add(id);
  for (const [id, beacon] of Object.entries(data.beacons)) {
    add(id);
    add(beacon.item);
  }
  for (const [id, machine] of Object.entries(data.machines)) {
    add(id);
    add(machine.item);
  }
  return ids;
}

function complexityOfIcon(key: string, data: IconData): number | undefined {
  const id = iconId(key);
  switch (iconKind(key)) {
    case 'recipe':
      return data.recipes[id]?.complexity;
    case 'item':
      return data.resources[`item:${id}`]?.complexity;
    case 'fluid':
      return data.resources[`fluid:${id}`]?.complexity;
    case 'craft': {
      // The checked-in metadata predates separate item:/fluid: namespaces.
      const values = [
        data.resources[`item:${id}`]?.complexity,
        data.resources[`fluid:${id}`]?.complexity,
      ].filter((value): value is number => value !== undefined);
      return values.length === 0 ? undefined : Math.min(...values);
    }
    default:
      return undefined;
  }
}

function groupCells(icons: Icons, data: IconData): IconCell[] {
  const cells: IconCell[] = [];
  const byCoordinate = new Map<string, IconCell>();

  for (const [key, source] of Object.entries(icons)) {
    const coordinateKey = source.join(',');
    let cell = byCoordinate.get(coordinateKey);
    if (cell === undefined) {
      cell = { source, keys: [], order: cells.length, complexity: Infinity };
      byCoordinate.set(coordinateKey, cell);
      cells.push(cell);
    }
    cell.keys.push(key);
    const complexity = complexityOfIcon(key, data);
    if (complexity !== undefined) cell.complexity = Math.min(cell.complexity, complexity);
  }
  return cells;
}

/**
 * Assign distinct cells to sheets. Shared artwork is assigned once, with UI taking precedence;
 * each complexity sheet differs in size by at most one cell.
 */
export function splitIcons(icons: Icons, data: IconData): IconSplit[] {
  const uiIds = uiIconIds(data);
  const cells = groupCells(icons, data);
  const ui: IconCell[] = [];
  const complexity: IconCell[] = [];

  for (const cell of cells) {
    (cell.keys.some((key) => uiIds.has(iconId(key))) ? ui : complexity).push(cell);
  }

  complexity.sort((a, b) => a.complexity - b.complexity || a.order - b.order);
  const splits: IconSplit[] = [{ name: 'icons-ui', cells: ui }];
  for (let i = 0; i < COMPLEXITY_SHEETS; i++) {
    const start = Math.floor((i * complexity.length) / COMPLEXITY_SHEETS);
    const end = Math.floor(((i + 1) * complexity.length) / COMPLEXITY_SHEETS);
    splits.push({
      name: `icons-${i}`,
      cells: complexity.slice(start, end).sort((a, b) => a.order - b.order),
    });
  }
  return splits;
}

function parseIcons(value: unknown): Icons {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('icons.json must contain an object');
  }
  const icons: Icons = {};
  for (const [key, coordinate] of Object.entries(value)) {
    if (
      !Array.isArray(coordinate) ||
      coordinate.length !== 2 ||
      !coordinate.every((part) => Number.isInteger(part) && part >= 0)
    ) {
      throw new Error(`Invalid coordinate for ${key}: ${JSON.stringify(coordinate)}`);
    }
    icons[key] = coordinate as Coordinate;
  }
  return icons;
}

async function loadIconData(): Promise<IconData> {
  type PackedEntry = { i?: string; x?: number };
  type PackedData = {
    resources: Record<string, PackedEntry>;
    machines: Record<string, PackedEntry>;
    modules: Record<string, unknown>;
    beacons: Record<string, PackedEntry>;
    belts: Record<string, PackedEntry>;
  };
  type PackedRecipes = { recipes: Record<string, PackedEntry> };
  const readJson = async (path: string): Promise<unknown> =>
    JSON.parse(await readFile(path, 'utf8')) as unknown;
  const packed = (await readJson(join(repositoryRoot, 'src/assets/static.json'))) as PackedData;
  const recipeFile = (await readJson(
    join(repositoryRoot, 'src/assets/static-recipes.json'),
  )) as PackedRecipes;
  const complexity = (entries: Record<string, PackedEntry>) =>
    Object.fromEntries(Object.entries(entries).map(([id, entry]) => [id, { complexity: entry.x }]));
  const placed = (entries: Record<string, PackedEntry>) =>
    Object.fromEntries(Object.entries(entries).map(([id, entry]) => [id, { item: entry.i }]));

  return {
    recipes: complexity(recipeFile.recipes),
    resources: complexity(packed.resources),
    machines: placed(packed.machines),
    modules: packed.modules,
    beacons: placed(packed.beacons),
    belts: placed(packed.belts),
  };
}

function copyCell(
  source: Buffer,
  sourceWidth: number,
  from: Coordinate,
  destination: Buffer,
  destinationWidth: number,
  to: Coordinate,
) {
  for (let row = 0; row < CELL_SIZE; row++) {
    const sourceStart = ((from[1] + row) * sourceWidth + from[0]) * 4;
    const destinationStart = ((to[1] + row) * destinationWidth + to[0]) * 4;
    source.copy(destination, destinationStart, sourceStart, sourceStart + CELL_SIZE * 4);
  }
}

async function writeSplit(
  split: IconSplit,
  icons: Icons,
  pixels: Buffer,
  sourceWidth: number,
  outputDir: string,
) {
  if (split.cells.length === 0) throw new Error(`${split.name} has no cells`);
  const columns = Math.ceil(Math.sqrt(split.cells.length));
  const rows = Math.ceil(split.cells.length / columns);
  const width = columns * CELL_SIZE;
  const height = rows * CELL_SIZE;
  const sheet = Buffer.alloc(width * height * 4);
  const destinations = new Map<string, Coordinate>();

  for (const [index, cell] of split.cells.entries()) {
    const destination: Coordinate = [
      (index % columns) * CELL_SIZE,
      Math.floor(index / columns) * CELL_SIZE,
    ];
    copyCell(pixels, sourceWidth, cell.source, sheet, width, destination);
    destinations.set(cell.source.join(','), destination);
  }

  const outputIcons: Icons = {};
  // Iterating the original object is what preserves icons.json's key order.
  for (const [key, source] of Object.entries(icons)) {
    const destination = destinations.get(source.join(','));
    if (destination !== undefined) outputIcons[key] = destination;
  }

  await Promise.all([
    sharp(sheet, { raw: { width, height, channels: 4 } })
      .png()
      .toFile(join(outputDir, `${split.name}.png`)),
    writeFile(join(outputDir, `${split.name}.json`), JSON.stringify(outputIcons)),
  ]);

  const finite = split.cells.map((cell) => cell.complexity).filter(Number.isFinite);
  const range =
    finite.length === 0
      ? ''
      : `, complexity ${Math.min(...finite).toFixed(4)}–${Math.max(...finite).toFixed(4)}`;
  console.log(
    `${split.name}: ${split.cells.length} cells, ${Object.keys(outputIcons).length} keys${range}`,
  );
}

async function main() {
  if (process.argv.length > 3) {
    console.error(`usage: ${process.argv[1]} [SCRIPT_OUTPUT_DIR]`);
    process.exit(2);
  }
  const defaultSourceDir = join(homedir(), 'ins/factorio-2-73-ab/script-output');
  const sourceDir = resolve(process.argv[2] ?? defaultSourceDir);
  const sourceImage = join(sourceDir, 'icons.png');
  const iconsJson = join(sourceDir, 'icons.json');

  const icons = parseIcons(JSON.parse(await readFile(iconsJson, 'utf8')) as unknown);
  const { data: pixels, info } = await sharp(sourceImage)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width % CELL_SIZE !== 0 || info.height % CELL_SIZE !== 0) {
    throw new Error(
      `${sourceImage} is ${info.width}×${info.height}, not a grid of ${CELL_SIZE}px cells`,
    );
  }
  for (const [key, [x, y]] of Object.entries(icons)) {
    if (
      x % CELL_SIZE !== 0 ||
      y % CELL_SIZE !== 0 ||
      x + CELL_SIZE > info.width ||
      y + CELL_SIZE > info.height
    ) {
      throw new Error(`${key} points outside the ${info.width}×${info.height} source: ${x},${y}`);
    }
  }

  const splits = splitIcons(icons, await loadIconData());
  for (const split of splits) {
    await writeSplit(split, icons, pixels, info.width, sourceDir);
  }
  console.log(`Wrote ${splits.length} sprite sheets and metadata files to ${sourceDir}`);
}

const invokedPath = process.argv[1] && resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) await main();
