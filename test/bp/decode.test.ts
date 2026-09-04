import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { decode, decodeDocument } from '../../src/bp/decode.ts';

const fixtures = [
  ['4x-train-layout.base64', 215],
  ['empty-grid-v0.base64', 898],
  ['empty-plus-left-four.base64', 945],
  ['empty-plus-right-four.base64', 949],
] as const;

const fixturePath = (name: string) => new URL(`../../docs/bluprints/${name}`, import.meta.url);

describe('blueprint string decoding', () => {
  test.each(fixtures)('decodes %s', (name, entityCount) => {
    const blueprint = decode(readFileSync(fixturePath(name), 'utf8'));

    expect(blueprint.item).toBe('blueprint');
    expect(blueprint.version).toBe(562949958205441);
    expect(blueprint.entities).toHaveLength(entityCount);
    expect(blueprint.wires?.every((wire) => wire.length === 4)).toBe(true);
  });

  test('retains the top-level JSON wrapper', () => {
    const document = decodeDocument(readFileSync(fixturePath('empty-grid-v0.base64'), 'utf8'));

    expect(document).toHaveProperty('blueprint.label', 'Empty Grid v0');
  });

  test('rejects blueprint versions it does not understand', () => {
    expect(() => decode('1not-a-version-zero-blueprint')).toThrow('unsupported version 1');
    expect(() => decode('')).toThrow('unsupported version (missing)');
  });
});
