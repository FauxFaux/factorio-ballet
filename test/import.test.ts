import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { cellFromConfiguration, decodeImportUrl, decodeUrl } from '../src/import.ts';

describe('decodeUrl', () => {
  it('decodes the persisted proc-rs URL', () => {
    const url =
      '#s0=lZK-ZmFjdG9yaW8tMi4wLjczLWFuZ2VsYm9iLTIuMC42rHJlY2lwZWxpc3RlcpGSqmJvYi1ydWJ5LTXLQAgAAAAAAA' +
      'CQmZWqYm9iLXJ1YnktNbRhc3NlbWJsaW5nLW1hY2hpbmUtMcs_8AAAAAAAAMs_8AAAAAAAAMs_8AAAAAAAAJWqYm9iLXJ1YnktNLRhc3' +
      'NlbWJsaW5nLW1hY2hpbmUtMss_8AAAAAAAAMs_8AAAAAAAAMs_8AAAAAAAAJWqYm9iLXJ1YnktM7Rhc3NlbWJsaW5nLW1hY2hpbmUtMcs' +
      '_8AAAAAAAAMs_8AAAAAAAAMs_8AAAAAAAAJW9YW5nZWxzLW9yZTctY3J5c3RhbGxpemF0aW9uLTOzYW5nZWxzLWNyeXN0YWxsaXplcss' +
      '_8AAAAAAAAMs_8AAAAAAAAMs_8AAAAAAAAJXZIWFuZ2Vscy1jcnlzdGFsLXNsdXJyeS1maWx0ZXJpbmctMrhhbmdlbHMtZmlsdHJhdGlvbi11bml0LTLLP' +
      '_AAAAAAAADLP_AAAAAAAADLP_AAAAAAAACVuWFuZ2Vscy1nZW9kZS1ibHVlLWxpcXVpZnmwYW5nZWxzLWxpcXVpZmllcss_8AAAAAAAAMs' +
      '_8AAAAAAAAMs_8AAAAAAAAJW2Ym9iLXBvbGlzaGluZy1jb21wb3VuZLdhbmdlbHMtY2hlbWljYWwtcGxhbnQtMss_8AAAAAAAAMs' +
      '_8AAAAAAAAMs_8AAAAAAAAJWyYm9iLWdyaW5kaW5nLXdoZWVstGFzc2VtYmxpbmctbWFjaGluZS0xyz_wAAAAAAAAyz_wAAAAAAAAyz' +
      '_wAAAAAAAAlbNib2ItcG9saXNoaW5nLXdoZWVstGFzc2VtYmxpbmctbWFjaGluZS0xyz_wAAAAAAAAyz_wAAAAAAAAyz_wAAAAAAAApnNlY29uZA';

    expect(decodeUrl(url)).toMatchSnapshot();
  });
});

describe('decodeImportUrl', () => {
  it('inflates a compressed FactorioLab v11 URL and preserves its wire parameters', () => {
    const url = readFileSync(
      new URL('./assets/factoriolab-cpu.txt', import.meta.url),
      'utf8',
    ).trim();
    const decoded = decodeImportUrl(url);

    expect(decoded).toMatchObject({
      source: 'factoriolab',
      dataset: 'bobang',
      screen: 'list',
      hashed: true,
      version: '11',
      parameters: {
        o: '1s*4*1**E2*0*0',
        e: ['*k', '3', '6', '*9', '*BP', '6*BP', '*l'],
        v: '11',
      },
      decoded: {
        objectives: [
          {
            targetId: 'bob-integrated-electronics',
            value: '4',
            unit: '1',
            machineId: 'bob-assembling-machine-5',
            moduleIndexes: [0],
            beaconIndexes: [0],
          },
        ],
      },
    });
    expect(decoded && 'source' in decoded ? decoded.parameters.r : undefined).toHaveLength(17);
    expect(decoded && 'source' in decoded ? decoded.decoded.recipes[0] : undefined).toMatchObject({
      recipeId: 'bob-silicon-wafer',
      machineId: 'bob-assembling-machine-5',
      moduleIndexes: [0],
      beaconIndexes: [1],
    });
  });

  it('decodes a bare FactorioLab v11 URL', () => {
    expect(
      decodeImportUrl('https://factoriolab.github.io/2.1/list?o=iron-plate*60&odr=0&v=11'),
    ).toEqual({
      source: 'factoriolab',
      dataset: '2.1',
      screen: 'list',
      hashed: false,
      version: '11',
      parameters: { o: 'iron-plate*60', odr: '0', v: '11' },
      decoded: {
        modules: [],
        beacons: [],
        objectives: [{ targetId: 'iron-plate', value: '60' }],
        items: [],
        recipes: [],
        machines: [],
        settings: {},
      },
    });
  });
});

describe('cellFromConfiguration', () => {
  it('imports active processes as recipe and machine entries', () => {
    expect(
      cellFromConfiguration({
        d: null,
        r: [],
        io: [],
        p: [
          { p: 'iron-gear-wheel', f: 'assembling-machine-2', d: 0.5, i: 2, o: 3 },
          { p: 'iron-plate', f: 'stone-furnace', d: 1, i: 1, o: 1 },
        ],
        u: 'minute',
      }),
    ).toEqual({
      entries: [
        { recipe: 'iron-gear-wheel', machine: 'assembling-machine-2' },
        { recipe: 'iron-plate', machine: 'stone-furnace' },
      ],
    });
  });
});
