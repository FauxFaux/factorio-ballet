import { describe, expect, it } from 'vitest';
import { assemblerProblem } from '../../../src/compute/kernel-problems.ts';
import { solidAccessOptions } from '../../../src/compute/tile-design/access.ts';
import { normalizeTileDesignInput } from '../../../src/compute/tile-design/problem.ts';
import {
  solveTileDesign,
  type TileDesignSearchResult,
} from '../../../src/compute/tile-design/search.ts';
import type { TileDesignOptions } from '../../../src/compute/tile-design/types.ts';

const options: TileDesignOptions = {
  transport: {
    beltLaneCapacity: 15,
    undergroundBeltReach: 4,
    undergroundPipeReach: 10,
    inserters: [{ id: 'ordinary', capacity: 3, reach: 1 }],
    fluidThroughput: 'unlimited',
  },
  envelope: { maxWidth: 12, maxPitch: 10, primitives: ['surface'], maxStates: 100 },
};

function found(
  result: TileDesignSearchResult,
): Extract<TileDesignSearchResult, { status: 'found' }> {
  expect(result.status).toBe('found');
  if (result.status !== 'found') throw new Error(result.reason);
  return result;
}

describe('solveTileDesign starter allocation', () => {
  it('takes a normalized 1/s input and 2/s output through independent validation', () => {
    const normalized = normalizeTileDesignInput(
      assemblerProblem({ solidInputs: [1], solidOutputs: [2] }),
      options,
    );
    expect(normalized.success).toBe(true);
    if (!normalized.success) return;

    expect(found(solveTileDesign(normalized.input))).toMatchObject({
      status: 'found',
      validation: { valid: true, issues: [], supportedCopies: 7 },
      candidate: {
        width: 7,
        pitch: 3,
        boundary: [
          { x: 0, kind: 'belt', lanes: { left: 'item:1' } },
          { x: 6, kind: 'belt', lanes: { right: 'item:2' } },
        ],
        transfers: [
          { side: 'input', resource: 'item:1', rate: 1, beltLane: 'left' },
          { side: 'output', resource: 'item:2', rate: 2, beltLane: 'right' },
        ],
      },
    });
  });

  it('uses additional distinct access sites when the first inserter has insufficient capacity', () => {
    const normalized = normalizeTileDesignInput(
      assemblerProblem({ solidInputs: [7], solidOutputs: [2] }),
      options,
    );
    expect(normalized.success).toBe(true);
    if (!normalized.success) return;
    const result = found(solveTileDesign(normalized.input));
    expect(
      result.candidate.transfers.filter(({ side }) => side === 'input').map(({ rate }) => rate),
    ).toEqual([3, 3, 1]);
    expect(result.validation.valid).toBe(true);
  });

  it('reports failure when the first direct lane exceeds repeat capacity', () => {
    const normalized = normalizeTileDesignInput(
      assemblerProblem({ solidInputs: [8], solidOutputs: [2] }),
      { ...options, repeatCount: 2 },
    );
    expect(normalized.success).toBe(true);
    if (!normalized.success) return;
    expect(solveTileDesign(normalized.input)).toMatchObject({ status: 'first-choice-rejected' });
  });

  it('derives sites on all four faces of a rectangular footprint', () => {
    const normalized = normalizeTileDesignInput(
      assemblerProblem({ solidInputs: [1], solidOutputs: [2], size: { width: 2, height: 3 } }),
      options,
    );
    expect(normalized.success).toBe(true);
    if (!normalized.success) return;
    const accesses = solidAccessOptions(
      normalized.input.machines[0]!,
      { x: 2, y: 2 },
      normalized.input.transport,
    );
    expect(accesses.filter(({ side }) => side === 'input').map(({ face }) => face)).toEqual([
      'west',
      'west',
      'west',
      'east',
      'east',
      'east',
      'north',
      'north',
      'south',
      'south',
    ]);
    expect(found(solveTileDesign(normalized.input))).toMatchObject({
      validation: { valid: true },
    });
  });
});
