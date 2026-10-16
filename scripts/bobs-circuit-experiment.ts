import { CpSat, setCloudNoticeEnabled } from 'or-tools-wasm/cp-sat';
import { bobTransportData } from '../src/compute/bobs/problem-data.ts';
import { buildBobTransport } from '../src/compute/bobs/transport.ts';
import { buildBobPlacement } from '../src/compute/bobs/placement.ts';
import { solveBobLayout } from '../src/compute/bobs/staged-solver.ts';
import { validateBobLayout } from '../src/compute/bobs/validate.ts';
import { defaultBobOptions, type BobProblem, type Point } from '../src/compute/bobs/types.ts';

const problem: BobProblem = {
  machines: [
    ...Array.from({ length: 2 }, (_, i) => ({
      id: `circuit:${i}`,
      label: `Circuit ${i + 1}`,
      size: { width: 3, height: 3 },
      inputs: { 'item:iron-plate': 1.5, 'item:copper-cable': 4.5 },
      outputs: { 'item:electronic-circuit': 1.5 },
    })),
    ...Array.from({ length: 3 }, (_, i) => ({
      id: `cable:${i}`,
      label: `Cable ${i + 1}`,
      size: { width: 3, height: 3 },
      inputs: { 'item:copper-plate': 1.5 },
      outputs: { 'item:copper-cable': 3 },
    })),
  ],
  inputs: ['item:copper-plate', 'item:iron-plate'],
  outputs: ['item:electronic-circuit'],
};
setCloudNoticeEnabled(false);
const data = bobTransportData(problem);
const options = {
  ...defaultBobOptions(problem),
  maxWidth: 10,
  maxHeight: 6,
  maxChests: 0,
  maxInserters: 11,
};
// Zero-based top-left coordinates; the spare bottom column is x=6.
const positions: Point[] = [
  { x: 0, y: 0 },
  { x: 7, y: 0 },
  { x: 0, y: 3 },
  { x: 3, y: 3 },
  { x: 7, y: 3 },
  { x: 4, y: 0 },
  { x: 3, y: 0 },
  { x: 6, y: 0 },
];
const layout = {
  width: 10,
  height: 6,
  nodes: data.nodes.map((n, i) => ({ ...n, position: positions[i] })),
  inserters: [],
};
const started = performance.now();
const transport = await buildBobTransport(data, layout, options, false);
const selected = await CpSat.solve(transport.model, { numWorkers: 1, maxTimeInSeconds: 1.5 });
console.log(
  'Fixed transport:',
  selected.status,
  'candidates:',
  transport.candidateCount,
  'milliseconds:',
  Math.round(performance.now() - started),
);
if (!selected.hasSolution) throw new Error('Expected fixed transport to succeed.');
const connected = transport.read(selected);
const errors = validateBobLayout(problem, connected);
if (errors.length) throw new Error(errors.join('; '));
console.log(JSON.stringify(connected, null, 2));

// A single promoted cable-input port needs two producer connections. Previously,
// the reservation model allowed only ceil(4.5 / 703.012) = 1 slot and failed here.
const port = data.ports.find((p) => p.node === 'circuit:0' && p.resource === 'item:copper-cable')!;
const placement = buildBobPlacement(data, options, [port], []);
const reserved = await CpSat.solve(placement.model, { numWorkers: 1, maxTimeInSeconds: 2 });
console.log('One promoted cable input, no relays (all placements):', reserved.status);
if (!reserved.hasSolution)
  throw new Error('Expected the promoted cable input to split across producers.');

const searchStarted = performance.now();
const search = await solveBobLayout(problem, {
  maxWidth: 10,
  maxHeight: 6,
  maxInserters: 11,
  maxTimeInSeconds: 10,
});
console.log('Unseeded staged search:', search.status, search.message);
console.log('Search milliseconds:', Math.round(performance.now() - searchStarted));
if (search.layout)
  console.log(
    'Inserters:',
    search.layout.inserters.length,
    'relay chests:',
    search.layout.nodes.filter((n) => n.kind === 'chest').length,
  );
console.log(
  JSON.stringify(
    search.attempts?.map((a) => ({
      id: a.id,
      width: a.layout.width,
      height: a.layout.height,
      stage: a.stage,
      promoted: a.promoted,
      message: a.message,
    })),
    null,
    2,
  ),
);
