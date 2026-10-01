import { unzlibSync } from 'fflate';

export interface FactorioLabConfiguration {
  source: 'factoriolab';
  /** Dataset and screen are the first two route segments. */
  dataset: string;
  screen: string;
  /** Whether identifiers in the parameters are indexes into the dataset's hash.json. */
  hashed: boolean;
  version: string;
  /** Decoded wire values, preserving repeated parameters as arrays. */
  parameters: Record<string, string | string[]>;
  /** Named records with dataset hash indexes resolved to entity IDs. */
  decoded: FactorioLabDecoded;
}

interface FactorioLabDecoded {
  modules: Record<string, unknown>[];
  beacons: Record<string, unknown>[];
  objectives: Record<string, unknown>[];
  items: Record<string, unknown>[];
  recipes: Record<string, unknown>[];
  machines: Record<string, unknown>[];
  settings: Record<string, unknown>;
}

/** Decode a current FactorioLab calculator URL. */
export function decodeFactorioLabUrl(
  url: string,
  factorioLabHashes: FactorioLabHashes = {},
): FactorioLabConfiguration | null {
  const parsed = new URL(url, 'https://factoriolab.github.io/');
  if (parsed.hostname !== 'factoriolab.github.io') return null;

  const route = parsed.pathname.split('/').filter(Boolean);
  if (route.length < 2) return null;

  const compressed = parsed.searchParams.get('z');
  const parameters = compressed
    ? new URLSearchParams(new TextDecoder().decode(unzlibSync(decodeFactorioLabBase64(compressed))))
    : parsed.searchParams;
  const version = parameters.get('v') ?? parsed.searchParams.get('v');
  if (version !== '11')
    throw new Error(`Unsupported FactorioLab URL version: ${version ?? 'missing'}`);

  return {
    source: 'factoriolab',
    dataset: route.at(-2)!,
    screen: route.at(-1)!,
    hashed: compressed !== null,
    version,
    parameters: collectParameters(parameters),
    decoded: decodeFactorioLabParameters(
      parameters,
      route.at(-2)!,
      compressed !== null,
      factorioLabHashes,
    ),
  };
}

type HashKind =
  | 'beacons'
  | 'belts'
  | 'fuels'
  | 'items'
  | 'locations'
  | 'machines'
  | 'modules'
  | 'recipes'
  | 'technologies'
  | 'wagons';
type HashTable = Record<HashKind, (string | null)[]>;
export type FactorioLabHashes = Record<string, HashTable>;

function decodeFactorioLabParameters(
  parameters: URLSearchParams,
  dataset: string,
  hashed: boolean,
  factorioLabHashes: FactorioLabHashes,
): FactorioLabDecoded {
  const hash = factorioLabHashes[dataset];
  if (hashed && hash === undefined)
    throw new Error(`No bundled FactorioLab hash table for dataset: ${dataset}`);
  const id = (value: string | undefined, kind: HashKind): string | undefined => {
    if (value === undefined || value === '') return undefined;
    if (!hashed) return value;
    const resolved = hash![kind][factorioLabIdToNumber(value)];
    if (resolved == null) throw new Error(`Unknown FactorioLab ${kind} index: ${value}`);
    return resolved;
  };
  const indexes = (value: string | undefined): number[] | undefined =>
    value === undefined ? undefined : value === '_' ? [] : value.split('~').map(Number);
  const records = (key: string): string[][] =>
    parameters.getAll(key).map((value) => value.split('*'));

  const modules = records('e').map(([count, moduleId]) =>
    compact({ count, moduleId: id(moduleId, 'modules') }),
  );
  const beacons = records('b').map(([count, moduleIndexes, beaconId, total]) =>
    compact({
      count,
      moduleIndexes: indexes(moduleIndexes),
      beaconId: id(beaconId, 'beacons'),
      total,
    }),
  );
  const objectives = records('o').map(
    ([targetId, value, unit, type, machineId, moduleIndexes, beaconIndexes, overclock, fuelId]) =>
      compact({
        targetId: id(targetId, unit === '3' ? 'recipes' : 'items'),
        value,
        unit,
        type,
        machineId: id(machineId, 'machines'),
        moduleIndexes: indexes(moduleIndexes),
        beaconIndexes: indexes(beaconIndexes),
        overclock,
        fuelId: id(fuelId, 'fuels'),
      }),
  );
  const items = records('i').map(([itemId, beltId, wagonId, stack, excludeRockets]) =>
    compact({
      itemId: id(itemId, 'items'),
      beltId: id(beltId, 'belts'),
      wagonId: id(wagonId, 'wagons'),
      stack,
      excludeRockets: booleanValue(excludeRockets),
    }),
  );
  const recipes = records('r').map(
    ([recipeId, machineId, moduleIndexes, beaconIndexes, overclock, cost, fuelId, productivity]) =>
      compact({
        recipeId: id(recipeId, 'recipes'),
        machineId: id(machineId, 'machines'),
        moduleIndexes: indexes(moduleIndexes),
        beaconIndexes: indexes(beaconIndexes),
        overclock,
        cost,
        fuelId: id(fuelId, 'fuels'),
        productivity,
      }),
  );
  const machines = records('m').map(
    ([machineId, moduleIndexes, beaconIndexes, fuelId, overclock]) =>
      compact({
        machineId: id(machineId, 'machines'),
        moduleIndexes: indexes(moduleIndexes),
        beaconIndexes: indexes(beaconIndexes),
        fuelId: id(fuelId, 'fuels'),
        overclock,
      }),
  );

  const settings: Record<string, unknown> = {};
  const idSettings: Partial<Record<string, HashKind>> = {
    ibe: 'belts',
    ipi: 'belts',
    icw: 'wagons',
    ifw: 'wagons',
    mps: 'modules',
  };
  const arraySettings: Partial<Record<string, HashKind>> = {
    mmr: 'machines',
    mfr: 'fuels',
    mer: 'modules',
  };
  const setSettings: Partial<Record<string, HashKind>> = {
    iex: 'items',
    ich: 'items',
    rex: 'recipes',
    rch: 'recipes',
    tre: 'technologies',
    loc: 'locations',
  };
  for (const [key, kind] of Object.entries(idSettings)) {
    if (kind === undefined) continue;
    const value = parameters.get(key);
    if (value !== null) settings[key] = id(value, kind);
  }
  for (const [key, kind] of Object.entries(arraySettings)) {
    if (kind === undefined) continue;
    const value = parameters.get(key);
    if (value !== null)
      settings[key] = value === '_' ? [] : value.split('~').map((part) => id(part, kind));
  }
  for (const [key, kind] of Object.entries(setSettings)) {
    if (kind === undefined) continue;
    const value = parameters.get(key);
    if (value !== null) settings[key] = decodeFactorioLabSet(value, hash?.[kind], hashed);
  }

  return { modules, beacons, objectives, items, recipes, machines, settings };
}

function compact(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined && value !== ''),
  );
}

function booleanValue(value: string | undefined): boolean | undefined {
  return value === undefined || value === '' ? undefined : value === '1';
}

function factorioLabIdToNumber(value: string): number {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-.';
  let result = 0;
  for (const character of value) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error(`Invalid FactorioLab hash index: ${value}`);
    result = result * 64 + digit;
  }
  return result;
}

function decodeFactorioLabSet(
  value: string,
  hash: (string | null)[] | undefined,
  hashed: boolean,
): string[] {
  if (value === '_') return [];
  if (!hashed) return value.split('*');
  const result: string[] = [];
  for (const run of value.split('*')) {
    const [startValue, endValue = startValue] = run.split('~');
    const start = factorioLabIdToNumber(startValue);
    const end = factorioLabIdToNumber(endValue);
    for (let index = start; index <= end; index++) {
      const resolved = hash?.[index];
      if (resolved != null) result.push(resolved);
    }
  }
  return result;
}

function collectParameters(parameters: URLSearchParams): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of parameters) {
    const previous = result[key];
    result[key] =
      previous === undefined
        ? value
        : Array.isArray(previous)
          ? [...previous, value]
          : [previous, value];
  }
  return result;
}

function decodeFactorioLabBase64(value: string): Uint8Array {
  const base64 = value.replaceAll('-', '+').replaceAll('.', '/').replaceAll('_', '=');
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
