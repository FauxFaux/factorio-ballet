import { bobCapacity } from './geometry.ts';
import {
  RATE_SCALE,
  type BobLayout,
  type BobNode,
  type BobProblem,
  type Point,
  type Rates,
} from './types.ts';
import { isItem, type ResourceId } from '../../types.ts';
import { itemOnlyBobProblem } from './item-problem.ts';

/** Reconstruct geometry and gross item flows independently of the CP-SAT variables. */
export function validateBobLayout(
  problem: BobProblem,
  layout: BobLayout,
  options: { minBoundaryHeight?: number } = {},
): string[] {
  problem = itemOnlyBobProblem(problem);
  const errors: string[] = [];
  const minBoundaryHeight = options.minBoundaryHeight ?? 1;
  const tolerance = (problem.machines.length + 1) / RATE_SCALE + 1e-8;
  const nodes = new Map(layout.nodes.map((n) => [n.id, n]));
  const occupied = new Set<string>();
  const inputs = new Map<string, Rates>();
  const outputs = new Map<string, Rates>();
  const contains = (node: BobNode, p: Point) =>
    p.x >= node.position.x &&
    p.x < node.position.x + node.size.width &&
    p.y >= node.position.y &&
    p.y < node.position.y + node.size.height;
  const occupy = (p: Point, w: number, h: number) => {
    if (
      ![p.x, p.y, w, h].every(Number.isInteger) ||
      w <= 0 ||
      h <= 0 ||
      p.x < 0 ||
      p.y < 0 ||
      p.x + w > layout.width ||
      p.y + h > layout.height
    ) {
      errors.push('Entity outside the integer layout bounds');
      return;
    }
    for (let x = p.x; x < p.x + w; x++)
      for (let y = p.y; y < p.y + h; y++) {
        const key = `${x},${y}`;
        if (occupied.has(key)) errors.push(`Overlap at ${key}`);
        occupied.add(key);
      }
  };
  if (
    !Number.isInteger(layout.width) ||
    !Number.isInteger(layout.height) ||
    layout.width <= 0 ||
    layout.height <= 0
  )
    errors.push('Invalid layout rectangle');
  if (nodes.size !== layout.nodes.length) errors.push('Duplicate entity IDs');
  for (const node of layout.nodes) {
    occupy(node.position, node.size.width, node.size.height);
    const boundaryRegion =
      (node.kind === 'source' || node.kind === 'sink') && minBoundaryHeight > 1;
    if (boundaryRegion) {
      if (node.size.width !== 1 || node.size.height < minBoundaryHeight)
        errors.push('Boundary region must be one tile wide and meet the minimum I/O height');
    } else if (node.kind !== 'assembler' && (node.size.width !== 1 || node.size.height !== 1))
      errors.push('Chest must occupy one tile');
    if (node.kind === 'source' || node.kind === 'sink') {
      if (
        node.position.x !== 0 &&
        node.position.y !== 0 &&
        node.position.x + node.size.width !== layout.width &&
        node.position.y + node.size.height !== layout.height
      )
        errors.push(`${node.id} is not on a boundary`);
    }
  }
  for (const kind of ['source', 'sink'] as const) {
    const resources = kind === 'source' ? problem.inputs : problem.outputs;
    if (layout.nodes.filter((n) => n.kind === kind).length !== resources.length)
      errors.push(`Incorrect ${kind} chest count`);
    for (const resource of resources) {
      const node = nodes.get(`${kind}:${resource}`);
      if (node?.kind !== kind || node.resource !== resource)
        errors.push(`Missing ${kind} chest for ${resource}`);
    }
  }
  if (layout.nodes.filter((n) => n.kind === 'assembler').length !== problem.machines.length)
    errors.push('Incorrect assembler count');
  const add = (map: Map<string, Rates>, id: string, rates: Rates) => {
    const target = map.get(id) ?? {};
    for (const [r, rate] of Object.entries(rates))
      target[r as ResourceId] = (target[r as ResourceId] ?? 0) + rate!;
    map.set(id, target);
  };
  for (const inserter of layout.inserters) {
    occupy(inserter.position, 1, 1);
    const from = nodes.get(inserter.from);
    const to = nodes.get(inserter.to);
    if (
      !from ||
      !to ||
      from === to ||
      from.kind === 'sink' ||
      to.kind === 'source' ||
      !contains(from, inserter.pickup) ||
      !contains(to, inserter.dropoff)
    )
      errors.push('Invalid inserter endpoints');
    if (
      ![inserter.pickup.x, inserter.pickup.y, inserter.dropoff.x, inserter.dropoff.y].every(
        Number.isInteger,
      )
    )
      errors.push('Endpoints must be tile centres');
    const capacity = bobCapacity(
      { x: inserter.pickup.x - inserter.position.x, y: inserter.pickup.y - inserter.position.y },
      { x: inserter.dropoff.x - inserter.position.x, y: inserter.dropoff.y - inserter.position.y },
    );
    const rates = Object.values(inserter.rates) as number[];
    if (
      !capacity ||
      !Number.isFinite(inserter.capacity) ||
      inserter.capacity > capacity + 1e-8 ||
      Object.keys(inserter.rates).some((resource) => !isItem(resource)) ||
      rates.some((r) => !Number.isFinite(r) || r < 0) ||
      rates.reduce((n, r) => n + r, 0) > inserter.capacity + 1e-8
    )
      errors.push('Invalid reach, length or throughput');
    add(outputs, inserter.from, inserter.rates);
    add(inputs, inserter.to, inserter.rates);
  }
  const compare = (actual: Rates = {}, expected: Rates, label: string) => {
    for (const resource of new Set([
      ...Object.keys(actual),
      ...Object.keys(expected),
    ]) as Set<ResourceId>) {
      if (Math.abs((actual[resource] ?? 0) - (expected[resource] ?? 0)) > tolerance)
        errors.push(`${label}: ${resource} flow mismatch`);
    }
  };
  const balance: Rates = {};
  for (const machine of problem.machines) {
    const node = nodes.get(machine.id);
    if (
      !node ||
      node.kind !== 'assembler' ||
      !(
        (node.size.width === machine.size.width && node.size.height === machine.size.height) ||
        (node.size.width === machine.size.height && node.size.height === machine.size.width)
      )
    )
      errors.push(`Missing or incorrect machine ${machine.id}`);
    compare(inputs.get(machine.id), machine.inputs, `${machine.id} inputs`);
    compare(outputs.get(machine.id), machine.outputs, `${machine.id} outputs`);
    for (const resource of new Set([
      ...Object.keys(machine.inputs),
      ...Object.keys(machine.outputs),
    ]) as Set<ResourceId>) {
      balance[resource] =
        (balance[resource] ?? 0) +
        (machine.inputs[resource] ?? 0) -
        (machine.outputs[resource] ?? 0);
    }
  }
  for (const resource of problem.inputs)
    compare(
      outputs.get(`source:${resource}`),
      { [resource]: Math.max(0, balance[resource] ?? 0) },
      `Source ${resource}`,
    );
  for (const resource of problem.outputs)
    compare(
      inputs.get(`sink:${resource}`),
      { [resource]: Math.max(0, -(balance[resource] ?? 0)) },
      `Sink ${resource}`,
    );
  for (const node of layout.nodes.filter((n) => n.kind === 'chest'))
    compare(inputs.get(node.id), outputs.get(node.id) ?? {}, node.id);
  return errors;
}
