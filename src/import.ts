import { decode } from '@msgpack/msgpack';

export interface DataSetConfiguration {
  id: string;
  style: string;
}

export interface Requirement {
  i: string;
  q: number;
}

export interface ImportExport {
  i: string;
}

export interface ActiveProcess {
  p: string;
  f: string;
  d: number;
  i: number;
  o: number;
}

export interface DehydratedGraphConfiguration {
  d: DataSetConfiguration | null;
  r: Requirement[];
  io: ImportExport[];
  p: ActiveProcess[];
  u: string;
}

/** Decode a persisted proc-rs URL or URL fragment. */
export function decodeUrl(url: string): DehydratedGraphConfiguration | null {
  const fragment = url.slice(url.indexOf('#') + 1);
  const encoded = new URLSearchParams(fragment).get('s0');
  if (encoded === null || encoded === '') return null;

  const bytes = decodeBase64Url(encoded);
  const [dataset, requirements, importsExports, processes, units] = decode(bytes) as [
    [string, string] | null,
    [string, number][],
    [string][],
    [string, string, number, number, number][],
    string,
  ];

  return {
    d: dataset === null ? null : { id: dataset[0], style: dataset[1] },
    r: requirements.map(([i, q]) => ({ i, q })),
    io: importsExports.map(([i]) => ({ i })),
    p: processes.map(([p, f, d, i, o]) => ({ p, f, d, i, o })),
    u: units,
  };
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 =
    value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
