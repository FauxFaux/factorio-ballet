import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import { COMMON_IDS, REFERENCE_STATE } from './common-ids.ts';
import type { PackedCell } from './pack.ts';

/** The legacy prefix remains readable; its fingerprint belongs to the legacy dataset. */
export const HASH_VERSION = `yr4q`;

export interface PackedState {
  dataset?: string;
  v: 1;
  cs: string;
  gp: number;
  cl: PackedCell[];
  ci: number;
  mo: Record<string, string>;
  [key: string]: unknown;
}

export type EnvelopeResult =
  | { kind: 'empty' }
  | { kind: 'ok'; packed: PackedState }
  | { kind: 'version-error' }
  | { kind: 'unpack-error'; hash: string; message: string };

const urlDictionary = strToU8(COMMON_IDS + JSON.stringify(shallowSortKeys(REFERENCE_STATE)));

export function parseEnvelope(hash: string): EnvelopeResult {
  if (hash.length <= 1) return { kind: 'empty' };
  if (!hash.slice(1).startsWith(HASH_VERSION)) return { kind: 'version-error' };
  try {
    const encoded = hash.slice(1 + HASH_VERSION.length);
    const binary = atob(encoded.replace(/-/g, '+').replace(/_/g, '/'));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const json = strFromU8(inflateSync(bytes, { dictionary: urlDictionary }));
    const value: unknown = JSON.parse(json);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('URL state is not an object');
    }
    const packed = value as PackedState;
    if (packed.dataset !== undefined && typeof packed.dataset !== 'string') {
      throw new Error('Invalid dataset ID in URL');
    }
    return { kind: 'ok', packed };
  } catch (error) {
    return {
      kind: 'unpack-error',
      hash,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function packEnvelope(packed: PackedState): string {
  const json = JSON.stringify(shallowSortKeys(packed));
  const bytes = deflateSync(strToU8(json), { level: 9, dictionary: urlDictionary });
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return HASH_VERSION + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function shallowSortKeys<T extends Record<string, any>>(value: T): T {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) as T;
}
