import { strFromU8, unzlibSync } from 'fflate';

export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;

export interface JsonObject {
  [key: string]: JsonValue;
}

export interface Position {
  x: number;
  y: number;
}

export interface Color {
  r: number;
  g: number;
  b: number;
  a?: number;
}

export interface SignalId {
  name: string;
  /** Omitted signals are items in Factorio 2.x. */
  type?: string;
  quality?: string;
}

export interface Icon {
  index: number;
  signal: SignalId;
}

export interface ConnectionData {
  entity_id: number;
  circuit_id?: number;
}

export interface ConnectionPoint {
  red?: ConnectionData[];
  green?: ConnectionData[];
}

export interface Entity {
  entity_number: number;
  name: string;
  position: Position;
  direction?: number;
  orientation?: number;
  connections?: Record<string, ConnectionPoint>;
  neighbours?: number[];
  control_behavior?: JsonObject;
  items?: JsonValue;
  recipe?: string;
  inventory?: JsonObject;
  tags?: JsonObject;
  type?: 'input' | 'output';
}

export interface Tile {
  name: string;
  position: Position;
}

export interface WaitCondition {
  type: string;
  compare_type: 'and' | 'or';
  ticks?: number;
  condition?: JsonObject;
}

export interface ScheduleRecord {
  station: string;
  wait_conditions: WaitCondition[];
  temporary?: boolean;
}

export interface Schedule {
  schedule: ScheduleRecord[];
  locomotives: number[];
}

/**
 * Factorio 2.x stores circuit/copper connections separately from entities. The bundled examples
 * establish this tuple shape even though docs/blueprint.wiki does not yet describe it.
 */
export type Wire = [
  sourceEntity: number,
  sourceConnector: number,
  targetEntity: number,
  targetConnector: number,
];

export interface Blueprint {
  item: 'blueprint';
  version: number;
  label?: string;
  label_color?: Color;
  description?: string;
  entities?: Entity[];
  tiles?: Tile[];
  icons?: Icon[];
  schedules?: Schedule[];
  wires?: Wire[];
  'snap-to-grid'?: Position;
  'absolute-snapping'?: boolean;
  'position-relative-to-grid'?: Position;
}

export interface BlueprintBookEntry {
  index: number;
  blueprint: Blueprint;
}

export interface BlueprintBook {
  item: 'blueprint-book';
  version: number;
  label?: string;
  label_color?: Color;
  description?: string;
  blueprints: BlueprintBookEntry[];
  active_index: number;
  icons?: Icon[];
}

export type BlueprintDocument = { blueprint: Blueprint } | { blueprint_book: BlueprintBook };

/** Decode a Factorio version-0 string while retaining its JSON wrapper. */
export function decodeDocument(data: string): BlueprintDocument {
  const encoded = data.trim();
  if (encoded[0] !== '0') throw new Error(`unsupported version ${encoded[0] ?? '(missing)'}`);

  const compressed = Uint8Array.from(atob(encoded.slice(1)), (character) =>
    character.charCodeAt(0),
  );
  const decoded: unknown = JSON.parse(strFromU8(unzlibSync(compressed)));

  if (!isRecord(decoded)) throw new Error('invalid top level: expected an object');
  const keys = Object.keys(decoded);
  if (keys.length !== 1 || (keys[0] !== 'blueprint' && keys[0] !== 'blueprint_book')) {
    throw new Error(`invalid top level: ${keys.join(',')}`);
  }

  const value = decoded[keys[0]];
  if (!isRecord(value)) throw new Error(`invalid ${keys[0]}: expected an object`);
  return decoded as BlueprintDocument;
}

/** Decode a Factorio blueprint string, matching the archived blueprint importer's API. */
export function decode(data: string): Blueprint {
  const document = decodeDocument(data);
  if (!('blueprint' in document)) throw new Error('invalid top level: blueprint_book');
  return document.blueprint;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
