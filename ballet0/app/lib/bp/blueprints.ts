// https://github.com/FauxFaux/factorio-loader/blob/98eb701ed55afb0dc01d40f5b05fb63921fa2eb3/web/muffler/blueprints.ts

import { atob, btoa } from 'abab';
import pako from 'pako';

export interface Blueprint {
  entities?: Entity[];
  tiles?: { name: string; position?: unknown }[];

  icons?: unknown[];

  // from the map version
  version: number;
  label?: string;
  item: 'blueprint';

  // incomplete
}

export interface Entity {
  entity_number?: number;

  // presumably always an item; this is *not* colon'd
  name: string;
  inventory?: unknown;
  // e.g. { speed_module: 6 } for factories, not an inventory apparently
  items?: Record<string, number>;
  position?: unknown;
  recipe?: string;
  direction?: number;
  // massively over-specified
  control_behavior?: {
    logistic_condition: {
      first_signal: {
        type: 'item';
        name: string;
      };
      constant: number;
      comparator: '<';
    };
    connect_to_logistic_network: true;
  };
  // e.g. power poles
  neighbours?: number[];

  request_filters?: { name: string; count: number; index?: number }[];
}

export function decode(data: string): Blueprint {
  if (data[0] !== '0') throw new Error(`unsupported version ${data[0]}`);
  const un64 = Uint8Array.from(atob(data.slice(1))!, (c) => c.charCodeAt(0));
  const obj = JSON.parse(pako.inflate(un64, { to: 'string' }));
  const keys = Object.keys(obj);
  if (keys.length !== 1 || keys[0] !== 'blueprint')
    throw new Error(`invalid top level: ${keys}`);
  return obj.blueprint as Blueprint;
}

export function encode(blueprint: Blueprint): string {
  const obj = {
    blueprint,
  };
  const un64 = pako.deflate(JSON.stringify(obj), { level: 9 });
  return '0' + btoa(String.fromCharCode(...un64));
}
