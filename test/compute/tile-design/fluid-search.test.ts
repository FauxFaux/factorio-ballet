import { describe, expect, it } from 'vitest';
import {
  solveTileDesign,
  type TileDesignSearchResult,
} from '../../../src/compute/tile-design/search.ts';
import { normalizeTileDesignInput } from '../../../src/compute/tile-design/problem.ts';
import { assemblerProblem } from '../../../src/compute/kernel-problems.ts';
import { validateTileDesign } from '../../../src/compute/design-validation/validate.ts';
import { orientFluidPort } from '../../../src/compute/tile-design/orientation.ts';
import type {
  FluidAccess,
  TileDesignInput,
  TileMachineOrientation,
} from '../../../src/compute/tile-design/types.ts';

function access(
  resource: `fluid:${string}`,
  boxIndex: number,
  side: 'west' | 'east',
  row = 1,
  height = 3,
): FluidAccess {
  return {
    resource,
    boxIndex,
    positions: [
      { position: { x: side === 'west' ? -1 : 1, y: row - (height - 1) / 2 }, direction: side },
    ],
  };
}
function problem(height = 3): TileDesignInput {
  return {
    machines: [
      {
        id: 'plant',
        size: { width: 3, height },
        orientations: [{ rotation: 'north', mirrored: false }],
        inputs: {
          items: [{ resource: 'item:a', rate: 6 }],
          fluids: [access('fluid:water', 0, 'west', Math.floor(height / 2), height)],
        },
        outputs: {
          items: [{ resource: 'item:b', rate: 6 }],
          fluids: [access('fluid:steam', 1, 'east', Math.floor(height / 2), height)],
        },
      },
    ],
    boundary: {
      inputs: { items: [{ resource: 'item:a', rate: 6 }], fluids: ['fluid:water'] },
      outputs: { items: [{ resource: 'item:b', rate: 6 }], fluids: ['fluid:steam'] },
    },
    transport: {
      beltLaneCapacity: 15,
      undergroundBeltReach: 4,
      undergroundPipeReach: 10,
      inserters: [{ id: 'ordinary', capacity: 3, reach: 1 }],
      fluidThroughput: 'unlimited',
    },
    envelope: {
      maxWidth: 12,
      maxPitch: 10,
      maxStates: 100_000,
      primitives: ['surface', 'underground', 'branch'],
    },
    repeat: { count: 2, moduleHeight: 30 },
  };
}
function found(result: TileDesignSearchResult) {
  expect(result.status, JSON.stringify(result)).toBe('found');
  if (result.status !== 'found') throw new Error(result.reason);
  expect(result.validation).toMatchObject({ valid: true, issues: [] });
  return result;
}
function noItems(input: TileDesignInput) {
  for (const side of ['inputs', 'outputs'] as const) {
    input.machines[0][side].items = [];
    input.boundary[side].items = [];
  }
}
function codes(input: TileDesignInput, candidate: ReturnType<typeof found>['candidate']) {
  return validateTileDesign(input, candidate).issues.map(({ code }) => code);
}

function pairedOutputsProblem(items = false): TileDesignInput {
  const input = problem();
  if (!items) noItems(input);
  else {
    input.machines[0].inputs.items[0].rate = 1;
    input.boundary.inputs.items[0].rate = 1;
    input.machines[0].outputs.items = [];
    input.boundary.outputs.items = [];
    input.transport.inserters.push({ id: 'long', capacity: 2, reach: 2 });
  }
  input.machines[0].orientations = [
    { rotation: 'east', mirrored: false },
    { rotation: 'east', mirrored: true },
  ];
  input.machines[0].inputs.fluids = [
    {
      resource: 'fluid:water',
      boxIndex: 0,
      positions: [{ position: { x: 0, y: -1 }, direction: 'north' }],
    },
  ];
  input.machines[0].outputs.fluids = [
    {
      resource: 'fluid:steam',
      boxIndex: 1,
      positions: [{ position: { x: -1, y: 1 }, direction: 'south' }],
    },
    {
      resource: 'fluid:acid',
      boxIndex: 2,
      positions: [{ position: { x: 1, y: 1 }, direction: 'south' }],
    },
  ];
  input.boundary.outputs.fluids = ['fluid:steam', 'fluid:acid'];
  return input;
}

describe('fluid tile search', () => {
  it('uses a reflected two-plant repeat for separate fluid outputs', () => {
    const input = pairedOutputsProblem();
    const result = found(solveTileDesign(input));
    expect(result.diagnostics.scope).toBe('mirrored-fluid-pair/horizontal-branches');
    expect(result.candidate.pitch).toBe(6);
    expect(
      result.candidate.column.entities.filter(({ kind }) => kind === 'assembler'),
    ).toMatchObject([{ direction: 'east' }, { direction: 'east', mirrored: true }]);
    const outputOrder = result.candidate.column.entities
      .filter((entity) => entity.kind === 'assembler')
      .flatMap((entity) =>
        input.machines[0].outputs.fluids.map((access) => ({
          resource: access.resource,
          y:
            entity.position.y +
            orientFluidPort(access.positions[0], entity.size, {
              rotation: entity.direction ?? 'north',
              mirrored: entity.mirrored ?? false,
            }).position.y,
        })),
      )
      .sort((a, b) => a.y - b.y)
      .map(({ resource }) => resource);
    expect(outputOrder).toEqual(['fluid:steam', 'fluid:acid', 'fluid:acid', 'fluid:steam']);
    expect(result.candidate.boundary.filter(({ kind }) => kind === 'pipe')).toHaveLength(3);
    expect(validateTileDesign(input, result.candidate).valid).toBe(true);
    const unmirrored = structuredClone(result.candidate);
    const second = unmirrored.column.entities.findIndex(
      (entity, index) => entity.kind === 'assembler' && index > 0,
    );
    const assembler = unmirrored.column.entities[second];
    if (assembler.kind === 'assembler') assembler.mirrored = false;
    expect(codes(input, unmirrored)).toContain('machine-identity');
  });

  it('stacks reflected layouts when their item and fluid trunks line up', () => {
    const input = pairedOutputsProblem(true);
    const result = found(solveTileDesign(input));
    expect(result.diagnostics.scope).toBe('mirrored-fluid-pair/horizontal-branches');
    expect(
      result.candidate.column.entities.filter(({ kind }) => kind === 'assembler'),
    ).toHaveLength(2);
    expect(result.candidate.transfers).toHaveLength(2);
    expect(result.candidate.boundary.find(({ kind }) => kind === 'belt')?.laneFlows).toMatchObject({
      left: { side: 'input', rate: 2 },
    });
  });

  it('finds the mirrored pair through the kernel problem adapter', () => {
    const settings = pairedOutputsProblem();
    const normalized = normalizeTileDesignInput(
      assemblerProblem({
        fluidInputs: [200],
        fluidOutputs: [100, 100],
        fluidBoxes: [
          {
            productionType: 'input',
            connections: [
              { position: { x: 0, y: -1 }, direction: 'north', flowDirection: 'input' },
            ],
          },
          {
            productionType: 'output',
            connections: [
              { position: { x: -1, y: 1 }, direction: 'south', flowDirection: 'output' },
            ],
          },
          {
            productionType: 'output',
            connections: [
              { position: { x: 1, y: 1 }, direction: 'south', flowDirection: 'output' },
            ],
          },
        ],
      }),
      { transport: settings.transport, envelope: settings.envelope },
    );
    if (!normalized.success) throw new Error(normalized.message);
    const result = found(solveTileDesign(normalized.input));
    expect(result.diagnostics.scope).toBe('mirrored-fluid-pair/horizontal-branches');
    expect(
      result.candidate.column.entities.filter(({ kind }) => kind === 'assembler'),
    ).toHaveLength(2);
  });

  it('finds the 5/5/9 item-input fluid-output layout within the debug search budget', () => {
    const settings = problem();
    settings.transport.inserters = [
      { id: 'ordinary', capacity: 8, reach: 1 },
      { id: 'long', capacity: 4, reach: 2 },
    ];
    settings.envelope = { ...settings.envelope, maxWidth: 16, maxPitch: 12, maxStates: 10_000 };
    const normalized = normalizeTileDesignInput(
      assemblerProblem({ solidInputs: [5, 5, 9], fluidOutputs: [200] }),
      settings,
    );
    if (!normalized.success) throw new Error(normalized.message);
    const result = found(solveTileDesign(normalized.input));
    expect(result.candidate).toMatchObject({ width: 8, pitch: 3 });
    expect(validateTileDesign(normalized.input, result.candidate).valid).toBe(true);
    expect(result.candidate.boundary.filter(({ kind }) => kind === 'belt')).toHaveLength(2);
    expect(
      result.candidate.column.entities.filter(({ kind }) => kind === 'underground-pipe'),
    ).toHaveLength(2);
    expect(
      result.candidate.column.entities.filter(({ kind }) => kind === 'underground-belt'),
    ).toHaveLength(2);
    expect(
      result.candidate.column.entities
        .filter((entity) => entity.kind === 'inserter')
        .every((entity) => entity.reach === undefined || entity.reach === 1),
    ).toBe(true);
  });

  it('uses immediately adjacent trunks without underground primitives', () => {
    const input = problem();
    noItems(input);
    input.envelope.primitives = ['surface'];
    const result = found(solveTileDesign(input));
    expect(result.optimal).toBe(true);
    expect(result.candidate).toMatchObject({ width: 5, pitch: 3 });
    expect(result.candidate.column.entities.filter(({ kind }) => kind === 'pipe')).toHaveLength(6);
    expect(result.validation.supportedCopies).toBe(10);
  });

  it('allows a trunk one tile beyond a direct fluid port pipe', () => {
    const input = problem();
    noItems(input);
    input.machines[0].inputs.fluids = [access('fluid:water', 0, 'west')];
    input.machines[0].outputs.fluids = [access('fluid:steam', 1, 'west', 0)];
    input.boundary.outputs.fluids = ['fluid:steam'];
    input.envelope.maxWidth = 7;
    const result = found(solveTileDesign(input));
    expect(result.validation.valid).toBe(true);
    expect(result.candidate.boundary.filter(({ kind }) => kind === 'pipe')).toHaveLength(2);
  });

  it('rotates normalized opposing north/south ports to face trunks', () => {
    const settings = problem();
    const normalized = normalizeTileDesignInput(
      assemblerProblem({
        fluidInputs: [20],
        fluidOutputs: [10],
        solidInputs: [6],
        solidOutputs: [6],
      }),
      settings,
    );
    if (!normalized.success) throw new Error(normalized.message);
    const result = found(solveTileDesign(normalized.input));
    const machine = result.candidate.column.entities.find(({ kind }) => kind === 'assembler')!;
    expect(machine.kind === 'assembler' && ['east', 'west'].includes(machine.direction!)).toBe(
      true,
    );
    expect(result.candidate.fluids.length).toBeGreaterThan(0);
  });

  it('pairs horizontal pipes and replaces obstructed belts with loaded underground pairs', () => {
    const input = problem();
    const result = found(solveTileDesign(input));
    expect(result.optimal).toBe(true);
    expect(result.candidate).toMatchObject({ width: 9, pitch: 3 });
    expect(
      result.candidate.column.entities.filter(({ kind }) => kind === 'underground-pipe'),
    ).toHaveLength(4);
    expect(
      result.candidate.column.entities.filter(({ kind }) => kind === 'underground-belt'),
    ).toHaveLength(4);
    expect(result.candidate.transfers).toHaveLength(4);
    expect(result.validation.supportedCopies).toBe(2);
    expect(
      result.candidate.boundary
        .filter(({ kind }) => kind === 'belt')
        .every((track) => Object.values(track.laneFlows!).every((flow) => flow.rate === 6)),
    ).toBe(true);
  });

  it('keeps mirror state and logical fluid identities on asymmetric ports', () => {
    const input = problem(5);
    input.machines[0].orientations = [{ rotation: 'south', mirrored: true }];
    input.machines[0].inputs.fluids[0] = access('fluid:water', 0, 'west', 1, 5);
    input.machines[0].outputs.fluids[0] = access('fluid:steam', 1, 'east', 3, 5);
    const result = found(solveTileDesign(input));
    const machine = result.candidate.column.entities.find(({ kind }) => kind === 'assembler')!;
    expect(machine).toMatchObject({ direction: 'south', mirrored: true });
    // Mirror then south rotation leaves x faces unchanged but flips the row.
    const connections = result.candidate.column.entities.filter(
      ({ kind }) => kind === 'underground-pipe',
    );
    expect(connections.some(({ position }) => position.y === 3)).toBe(true);
    const changed = structuredClone(result.candidate);
    const changedMachine = changed.column.entities.find(({ kind }) => kind === 'assembler')!;
    if (changedMachine.kind === 'assembler') changedMachine.mirrored = false;
    expect(codes(input, changed)).toContain('machine-geometry');
    expect(codes(input, changed)).toContain('fluid-port');
  });

  it('handles even rectangular footprints and half-cell prototype coordinates', () => {
    const input = problem();
    noItems(input);
    input.machines[0].size = { width: 2, height: 4 };
    input.machines[0].orientations = [{ rotation: 'east', mirrored: true }];
    input.machines[0].inputs.fluids[0].positions = [
      { position: { x: -0.5, y: -1.5 }, direction: 'north' },
    ];
    input.machines[0].outputs.fluids[0].positions = [
      { position: { x: 0.5, y: 1.5 }, direction: 'south' },
    ];
    const result = found(solveTileDesign(input));
    expect(result.candidate).toMatchObject({ width: 6, pitch: 2 });
    expect(result.candidate.column.entities.find(({ kind }) => kind === 'assembler')).toMatchObject(
      { size: { width: 4, height: 2 }, mirrored: true, direction: 'east' },
    );
  });

  it('tries alternative ports while respecting distinct boxes and unselected connections', () => {
    const input = problem();
    noItems(input);
    input.machines[0].inputs.fluids = [access('fluid:water', 0, 'west')];
    input.machines[0].outputs.fluids = [
      {
        ...access('fluid:steam', 1, 'west', 0),
        positions: [
          ...access('fluid:steam', 1, 'west', 0).positions,
          ...access('fluid:steam', 1, 'east').positions,
        ],
      },
    ];
    const result = found(solveTileDesign(input));
    // The steam box's unselected west port prevents a water trunk against the west edge;
    // the one-tile branch can now reach a legal trunk without an underground pair.
    expect(result.validation.valid).toBe(true);
    expect(result.candidate.boundary.filter(({ kind }) => kind === 'pipe')).toHaveLength(2);
    const repeated = structuredClone(input);
    repeated.machines[0].inputs.fluids.push(access('fluid:water', 2, 'east', 2));
    const second = found(solveTileDesign(repeated));
    expect(
      second.candidate.boundary.filter(
        ({ kind, resource }) => kind === 'pipe' && resource === 'fluid:water',
      ).length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('isolates three fluid networks on one face without recipe-specific cases', () => {
    const input = problem(7);
    noItems(input);
    input.machines[0].inputs.fluids = [
      access('fluid:water', 0, 'east', 1, 7),
      access('fluid:acid', 2, 'east', 3, 7),
    ];
    input.machines[0].outputs.fluids = [access('fluid:steam', 1, 'east', 5, 7)];
    input.boundary.inputs.fluids.push('fluid:acid');
    const result = found(solveTileDesign(input));
    expect(result.candidate.boundary.filter(({ kind }) => kind === 'pipe')).toHaveLength(3);
    expect(
      result.candidate.column.entities.filter(({ kind }) => kind === 'underground-pipe'),
    ).toHaveLength(4);
    const reordered = structuredClone(input);
    reordered.machines[0].inputs.fluids.reverse();
    reordered.boundary.inputs.fluids.reverse();
    expect(found(solveTileDesign(reordered)).candidate).toEqual(result.candidate);
    input.transport.undergroundPipeReach = 1;
    expect(solveTileDesign(input).status).toBe('envelope-exhausted');
  });

  it('derives four output sites from a five-row edge with one reserved fluid row', () => {
    const input = problem(5);
    input.machines[0].inputs.items[0].rate = input.boundary.inputs.items[0].rate = 1;
    input.machines[0].outputs.items[0].rate = input.boundary.outputs.items[0].rate = 11;
    input.repeat.count = 1;
    const result = found(solveTileDesign(input));
    expect(result.candidate.transfers.filter(({ side }) => side === 'output')).toHaveLength(4);
    expect(
      result.candidate.transfers.some(
        ({ inserterIndex }) => result.candidate.column.entities[inserterIndex].position.y === 2,
      ),
    ).toBe(false);
  });

  it('routes edge-row ports past belts without a seam-spanning tunnel', () => {
    const input = problem();
    input.machines[0].inputs.fluids[0] = access('fluid:water', 0, 'west', 0);
    input.machines[0].outputs.fluids[0] = access('fluid:steam', 1, 'east', 0);
    const result = found(solveTileDesign(input));
    expect(result.candidate).toMatchObject({ width: 11, pitch: 3 });
    expect(result.candidate.column.entities.some(({ kind }) => kind === 'underground-belt')).toBe(
      false,
    );
    expect(
      result.candidate.column.entities.filter(({ kind }) => kind === 'underground-pipe'),
    ).toHaveLength(4);
    input.envelope.maxWidth = 9;
    expect(solveTileDesign(input).status).toBe('envelope-exhausted');
  });

  it('combines fluid routes with long inserters and several filtered solid products', () => {
    const input = problem();
    input.machines[0].inputs.items = input.boundary.inputs.items = [
      { resource: 'item:a', rate: 1 },
      { resource: 'item:b', rate: 1 },
      { resource: 'item:c', rate: 1 },
    ];
    input.machines[0].outputs.items = input.boundary.outputs.items = [
      { resource: 'item:d', rate: 1 },
      { resource: 'item:e', rate: 1 },
    ];
    input.machines[0].outputs.fluids = [];
    input.boundary.outputs.fluids = [];
    input.transport.inserters.push({ id: 'long', capacity: 2, reach: 2 });
    const result = found(solveTileDesign(input));
    expect(
      result.candidate.boundary.filter(({ kind }) => kind === 'belt').length,
    ).toBeGreaterThanOrEqual(3);
    expect(
      result.candidate.column.entities.some(
        (entity) => entity.kind === 'inserter' && entity.reach === 2,
      ),
    ).toBe(true);
    for (const transfer of result.candidate.transfers.filter(({ side }) => side === 'output'))
      expect(result.candidate.column.entities[transfer.inserterIndex]).toMatchObject({
        filter: transfer.resource,
      });
  });

  it('reports primitive, pitch, repeat and budget limits honestly', () => {
    const input = problem();
    input.envelope.primitives = ['surface'];
    expect(solveTileDesign(input).status).toBe('envelope-exhausted');
    input.envelope.primitives = ['surface', 'underground', 'branch'];
    input.repeat.count = 6;
    expect(solveTileDesign(input).status).toBe('envelope-exhausted');
    input.repeat.count = 2;
    input.envelope.maxPitch = 2;
    expect(solveTileDesign(input).status).toBe('envelope-exhausted');
    input.envelope.maxPitch = 3;
    input.envelope.maxStates = 1;
    expect(solveTileDesign(input)).toMatchObject({
      status: 'budget-exhausted',
      diagnostics: { exploredStates: 1 },
    });
    const complete = found(solveTileDesign(problem()));
    const limited = problem();
    limited.envelope.maxStates = complete.diagnostics.exploredStates - 1;
    const incumbent = found(solveTileDesign(limited));
    expect(incumbent).toMatchObject({ optimal: false, stopReason: 'budget-exhausted' });
  });

  it('rejects invalid port geometry and leaves north/south adapters outside the envelope', () => {
    const input = problem();
    input.machines[0].inputs.fluids[0].positions[0].position.x = 0;
    expect(solveTileDesign(input).status).toBe('invalid-input');
    input.machines[0].inputs.fluids[0].positions = [
      { position: { x: 0, y: -1 }, direction: 'north' },
    ];
    expect(solveTileDesign(input).status).toBe('envelope-exhausted');
  });

  it('independently rejects wrong pipe orientation, missing partners and hidden pickup claims', () => {
    const input = problem();
    const candidate = found(solveTileDesign(input)).candidate;
    const wrong = structuredClone(candidate);
    const pipe = wrong.column.entities.find(({ kind }) => kind === 'underground-pipe')!;
    if (pipe.kind === 'underground-pipe') pipe.direction = 'north';
    expect(codes(input, wrong)).toContain('underground-pipe-pair');
    expect(codes(input, wrong)).toContain('fluid-port');
    const missing = structuredClone(candidate);
    const index = missing.column.entities.findIndex(({ kind }) => kind === 'underground-belt');
    const belt = missing.column.entities[index];
    missing.column.entities[index] = { kind: 'belt', position: belt.position, direction: 'north' };
    expect(codes(input, missing)).toContain('underground-pair');
    const hidden = structuredClone(candidate);
    hidden.column.entities[hidden.transfers[0].inserterIndex].position.y = 1;
    expect(codes(input, hidden)).toContain('transfer-lane');
    const longCandidate = candidate;
    const intercepted = structuredClone(longCandidate);
    const entities = intercepted.column.entities;
    const endpoint = entities.find(
      (entity) => entity.kind === 'underground-pipe' && entity.direction === 'east',
    );
    expect(endpoint).toBeDefined();
    entities.push({
      kind: 'underground-pipe',
      position: { x: endpoint!.position.x - 1, y: endpoint!.position.y },
      direction: 'east',
    });
    expect(codes(input, intercepted)).toContain('underground-pipe-pair');
  });

  it('detects fluid mixing across the periodic seam and disconnected labelled port stubs', () => {
    const input = problem();
    noItems(input);
    const tile = found(solveTileDesign(input)).candidate;
    // Isolated within this tile, but adjacent across the seam.
    const start = tile.column.entities.length;
    tile.column.entities.push(
      { kind: 'pipe', position: { x: tile.width + 1, y: 0 } },
      { kind: 'pipe', position: { x: tile.width + 1, y: 2 } },
    );
    tile.width += 2;
    tile.fluids.push(
      { pipeIndex: start, resource: 'fluid:water' },
      { pipeIndex: start + 1, resource: 'fluid:steam' },
    );
    expect(codes(input, tile)).toContain('fluid-mixing');
    const stub = found(solveTileDesign(input)).candidate;
    const trunk = stub.boundary.find(({ resource }) => resource === 'fluid:water')!;
    stub.boundary = stub.boundary.filter((track) => track !== trunk);
    expect(codes(input, stub)).toContain('fluid-port');
  });
});

describe('fluid port orientation', () => {
  it('reflects local x before each cardinal rotation, including the outward normal', () => {
    const cases: [TileMachineOrientation, number, number, string][] = [
      [{ rotation: 'north', mirrored: false }, -1, 1, 'west'],
      [{ rotation: 'east', mirrored: false }, 3, -1, 'north'],
      [{ rotation: 'south', mirrored: false }, 3, 3, 'east'],
      [{ rotation: 'west', mirrored: false }, 1, 3, 'south'],
      [{ rotation: 'north', mirrored: true }, 3, 1, 'east'],
      [{ rotation: 'east', mirrored: true }, 3, 3, 'south'],
      [{ rotation: 'south', mirrored: true }, -1, 3, 'west'],
      [{ rotation: 'west', mirrored: true }, 1, -1, 'north'],
    ];
    for (const [orientation, x, y, direction] of cases) {
      const size = ['east', 'west'].includes(orientation.rotation)
        ? { width: 5, height: 3 }
        : { width: 3, height: 5 };
      expect(
        orientFluidPort({ position: { x: -1, y: -1 }, direction: 'west' }, size, orientation),
      ).toEqual({ position: { x, y }, direction });
    }
  });
});
