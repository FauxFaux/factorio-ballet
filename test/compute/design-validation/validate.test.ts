import { describe, expect, it } from 'vitest';
import { validateTileDesign } from '../../../src/compute/design-validation/validate.ts';
import type {
  TileDesignCandidate,
  TileValidationInput,
} from '../../../src/compute/design-validation/types.ts';

const input: TileValidationInput = {
  machines: [
    {
      id: 'm1',
      size: { width: 1, height: 1 },
      orientations: [{ rotation: 'north', mirrored: false }],
      inputs: { items: [{ resource: 'item:a', rate: 2 }], fluids: [] },
      outputs: { items: [{ resource: 'item:b', rate: 2 }], fluids: [] },
    },
  ],
  boundary: {
    inputs: { items: [{ resource: 'item:a', rate: 2 }], fluids: [] },
    outputs: { items: [{ resource: 'item:b', rate: 2 }], fluids: [] },
  },
  transport: {
    beltLaneCapacity: 6,
    undergroundBeltReach: 4,
    undergroundPipeReach: 10,
    inserters: [{ id: 'ordinary', reach: 1, capacity: 3 }],
    fluidThroughput: 'unlimited',
  },
  repeat: { count: 2 },
};

function candidate(): TileDesignCandidate {
  return {
    width: 5,
    pitch: 3,
    machineIds: { 7: 'm1' },
    fluids: [],
    column: {
      entities: [
        ...[0, 1, 2].map((y) => ({
          kind: 'belt' as const,
          position: { x: 0, y },
          direction: 'north' as const,
        })),
        ...[0, 1, 2].map((y) => ({
          kind: 'belt' as const,
          position: { x: 4, y },
          direction: 'north' as const,
        })),
        { kind: 'inserter', position: { x: 1, y: 1 }, direction: 'east' },
        { kind: 'assembler', position: { x: 2, y: 1 }, size: { width: 1, height: 1 }, recipe: 'r' },
        { kind: 'inserter', position: { x: 3, y: 1 }, direction: 'east' },
      ],
    },
    lanes: [
      ...[0, 1, 2].map((entityIndex) => ({
        entityIndex,
        lane: 'left' as const,
        resource: 'item:a',
      })),
      ...[3, 4, 5].map((entityIndex) => ({
        entityIndex,
        lane: 'right' as const,
        resource: 'item:b',
      })),
    ],
    transfers: [
      {
        inserterIndex: 6,
        machineId: 'm1',
        side: 'input',
        resource: 'item:a',
        rate: 2,
        beltLane: 'left',
      },
      {
        inserterIndex: 8,
        machineId: 'm1',
        side: 'output',
        resource: 'item:b',
        rate: 2,
        beltLane: 'right',
      },
    ],
    boundary: [
      { x: 0, kind: 'belt', direction: 'north', lanes: { left: 'item:a' } },
      { x: 4, kind: 'belt', direction: 'north', lanes: { right: 'item:b' } },
    ],
  };
}

describe('validateTileDesign', () => {
  it('accepts a connected tile and derives its repeat capacity', () => {
    expect(validateTileDesign(input, candidate())).toEqual({
      valid: true,
      issues: [],
      supportedCopies: 3,
    });
  });

  it('rejects a declaration that overuses a shared inserter', () => {
    const tile = candidate();
    tile.transfers[0].rate = 4;
    expect(validateTileDesign(input, tile).issues.map(({ code }) => code)).toContain(
      'inserter-capacity',
    );
  });

  it('finds a broken advertised trunk from emitted belts', () => {
    const tile = candidate();
    tile.column.entities[1] = { kind: 'belt', position: { x: 0, y: 1 }, direction: 'east' };
    expect(validateTileDesign(input, tile).issues.map(({ code }) => code)).toContain(
      'boundary-continuity',
    );
  });

  it('rejects a lane claim that cannot feed its machine', () => {
    const tile = candidate();
    tile.lanes[1].resource = 'item:wrong';
    expect(validateTileDesign(input, tile).valid).toBe(false);
  });

  it('checks the assigned fluid box against the connected pipe network', () => {
    const fluidInput: TileValidationInput = {
      ...input,
      machines: [
        {
          id: 'm1',
          size: { width: 1, height: 1 },
          orientations: [{ rotation: 'north', mirrored: false }],
          inputs: {
            items: [],
            fluids: [
              {
                resource: 'fluid:a',
                boxIndex: 0,
                positions: [{ position: { x: 0, y: 0 }, direction: 'west' }],
              },
            ],
          },
          outputs: { items: [], fluids: [] },
        },
      ],
      boundary: { inputs: { items: [], fluids: ['fluid:a'] }, outputs: { items: [], fluids: [] } },
      repeat: { count: 1, moduleHeight: 6 },
    };
    const tile: TileDesignCandidate = {
      width: 2,
      pitch: 3,
      machineIds: { 3: 'm1' },
      lanes: [],
      transfers: [],
      column: {
        entities: [
          ...[0, 1, 2].map((y) => ({ kind: 'pipe' as const, position: { x: 0, y } })),
          {
            kind: 'assembler',
            position: { x: 1, y: 1 },
            size: { width: 1, height: 1 },
            recipe: 'r',
          },
        ],
      },
      fluids: [{ pipeIndex: 0, resource: 'fluid:a' }],
      boundary: [{ x: 0, kind: 'pipe', resource: 'fluid:a' }],
    };
    expect(validateTileDesign(fluidInput, tile)).toEqual({
      valid: true,
      issues: [],
      supportedCopies: 2,
    });
    tile.fluids[0].resource = 'fluid:other';
    expect(validateTileDesign(fluidInput, tile).issues.map(({ code }) => code)).toContain(
      'fluid-port',
    );
  });
});
