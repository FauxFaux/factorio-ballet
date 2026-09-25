import { describe, expect, it } from 'vitest';
import { packEnvelope, parseEnvelope, type PackedState } from '../../src/boot/url-envelope.ts';

const packed: PackedState = { v: 1, cs: '', gp: 0, cl: [], ci: 0, mo: {} };

describe('URL envelope', () => {
  it('reads a legacy plan without a dataset ID', () => {
    expect(parseEnvelope(`#${packEnvelope(packed)}`)).toEqual({ kind: 'ok', packed });
  });

  it('reads the dataset ID before any cell hydration', () => {
    const named = { ...packed, dataset: 'another-revision', cl: [{ entries: [{ recipe: 42 }] }] };
    expect(parseEnvelope(`#${packEnvelope(named)}`)).toEqual({ kind: 'ok', packed: named });
  });

  it('rejects invalid dataset IDs and unknown outer versions', () => {
    expect(
      parseEnvelope(`#${packEnvelope({ ...packed, dataset: 42 } as unknown as PackedState)}`).kind,
    ).toBe('unpack-error');
    expect(parseEnvelope('#old-plan').kind).toBe('version-error');
  });
});
