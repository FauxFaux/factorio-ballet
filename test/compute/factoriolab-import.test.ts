import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeFactorioLabUrl } from '../../src/compute/factoriolab-import.ts';
import bobang from '../../src/assets/factoriolab-bobang-hash.json';

describe('decodeFactorioLabUrl', () => {
  it('inflates a compressed FactorioLab v11 URL and preserves its wire parameters', () => {
    const url = readFileSync(
      new URL('../assets/factoriolab-cpu.txt', import.meta.url),
      'utf8',
    ).trim();
    const decoded = decodeFactorioLabUrl(url, { bobang });

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

  it('requires injected hash data for compressed datasets', () => {
    const url = readFileSync(
      new URL('../assets/factoriolab-cpu.txt', import.meta.url),
      'utf8',
    ).trim();

    expect(() => decodeFactorioLabUrl(url)).toThrow(
      'No bundled FactorioLab hash table for dataset: bobang',
    );
  });

  it('decodes a bare FactorioLab v11 URL', () => {
    expect(
      decodeFactorioLabUrl('https://factoriolab.github.io/2.1/list?o=iron-plate*60&odr=0&v=11'),
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
