import { RATE_SCALE, type BobNode, type BobPort, type BobProblem, type Rates } from './types.ts';
import type { ResourceId } from '../../types.ts';

export const MAX_BOB_CAPACITY = 703012;

/** Shared integer gross demands, including catalysts and reconciled rounding. */
export function bobTransportData(problem: BobProblem) {
  const resources = [
    ...new Set(
      problem.machines.flatMap((m) => [...Object.keys(m.inputs), ...Object.keys(m.outputs)]),
    ),
  ] as ResourceId[];
  const quantize = (rates: Rates): Rates =>
    Object.fromEntries(
      Object.entries(rates).map(([r, rate]) => [r, Math.round(rate! * RATE_SCALE)]),
    );
  const inputs = new Map(problem.machines.map((m) => [m.id, quantize(m.inputs)]));
  const outputs = new Map(problem.machines.map((m) => [m.id, quantize(m.outputs)]));
  for (const resource of resources) {
    if (problem.inputs.includes(resource) || problem.outputs.includes(resource)) continue;
    const original = problem.machines.reduce(
      (n, m) => n + (m.outputs[resource] ?? 0) - (m.inputs[resource] ?? 0),
      0,
    );
    if (Math.abs(original) > 1e-6)
      throw new Error(`Internal resource ${resource} is not balanced.`);
    const difference =
      [...inputs.values()].reduce((n, r) => n + (r[resource] ?? 0), 0) -
      [...outputs.values()].reduce((n, r) => n + (r[resource] ?? 0), 0);
    const producer = [...outputs.values()].find((r) => (r[resource] ?? 0) > 0);
    if (difference && producer) producer[resource] = producer[resource]! + difference;
  }
  for (const resource of resources) {
    const net =
      [...inputs.values()].reduce((n, r) => n + (r[resource] ?? 0), 0) -
      [...outputs.values()].reduce((n, r) => n + (r[resource] ?? 0), 0);
    if (
      (net > 0 && !problem.inputs.includes(resource)) ||
      (net < 0 && !problem.outputs.includes(resource))
    ) {
      throw new Error(`Declare the external ${net > 0 ? 'input' : 'output'} for ${resource}.`);
    }
    if (problem.inputs.includes(resource))
      outputs.set(`source:${resource}`, { [resource]: Math.max(0, net) });
    if (problem.outputs.includes(resource))
      inputs.set(`sink:${resource}`, { [resource]: Math.max(0, -net) });
  }
  const nodes: BobNode[] = [
    ...problem.machines.map((m) => ({
      id: m.id,
      label: m.label,
      kind: 'assembler' as const,
      size: m.size,
      position: { x: 0, y: 0 },
    })),
    ...problem.inputs.map((resource) => ({
      id: `source:${resource}`,
      label: `Source: ${resource}`,
      kind: 'source' as const,
      resource,
      size: { width: 1, height: 1 },
      position: { x: 0, y: 0 },
    })),
    ...problem.outputs.map((resource) => ({
      id: `sink:${resource}`,
      label: `Sink: ${resource}`,
      kind: 'sink' as const,
      resource,
      size: { width: 1, height: 1 },
      position: { x: 0, y: 0 },
    })),
  ];
  const ports: BobPort[] = nodes.flatMap((node) =>
    (['input', 'output'] as const).flatMap((side) =>
      Object.entries((side === 'input' ? inputs : outputs).get(node.id) ?? {})
        .filter(([, rate]) => rate! > 0)
        .map(([resource, rate]) => ({
          node: node.id,
          resource: resource as ResourceId,
          side,
          rate: rate! / RATE_SCALE,
        })),
    ),
  );
  const count = (map: Map<string, Rates>) =>
    [...map.values()].reduce(
      (n, rates) =>
        n + Math.ceil(Object.values(rates).reduce<number>((n, r) => n + r!, 0) / MAX_BOB_CAPACITY),
      0,
    );
  // Source arms and sink arms are distinct: their nonzero net resources have
  // opposite signs, so no active source-to-sink connection can serve both.
  const boundaryArms = nodes
    .filter((n) => n.kind !== 'assembler')
    .reduce((n, node) => {
      const rates = (node.kind === 'source' ? outputs : inputs).get(node.id) ?? {};
      return (
        n + Math.ceil(Object.values(rates).reduce<number>((n, r) => n + r!, 0) / MAX_BOB_CAPACITY)
      );
    }, 0);
  return {
    nodes,
    resources,
    inputs,
    outputs,
    ports,
    minInserters: Math.max(count(inputs), count(outputs), boundaryArms),
  };
}

export type BobTransportData = ReturnType<typeof bobTransportData>;
export const pointKey = (p: { x: number; y: number }) => `${p.x},${p.y}`;
export const portKey = (p: BobPort) => `${p.node}:${p.side}:${p.resource}`;
