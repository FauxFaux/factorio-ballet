import {
  CpModel,
  LinearExpr,
  sum,
  type IntVar,
  type BoolVar,
  type CpResult,
} from 'or-tools-wasm/cp-sat';
import { bobSwings } from './geometry.ts';
import { pointKey, type BobTransportData } from './problem-data.ts';
import {
  RATE_SCALE,
  type BobLayout,
  type BobOptions,
  type BobNode,
  type BobConflict,
  type Point,
} from './types.ts';
import type { ResourceId } from '../../types.ts';

const total = (values: Iterable<IntVar>) => LinearExpr.from(sum(values));

export class BobTransportTimeout extends Error {
  readonly conflicts: BobConflict[];
  constructor(conflicts: BobConflict[]) {
    super('Transport candidate enumeration exhausted the time budget.');
    this.conflicts = conflicts;
  }
}

type Pose = { pickup: Point; dropoff: Point; capacity: number; reach: number };
type Candidate = {
  position: Point;
  from: string;
  to: string;
  poses: Pose[];
  resources: ResourceId[];
  used: BoolVar;
  rates: Map<ResourceId, IntVar>;
};

/** Fixed geometry: only select concrete connections, chest tiles and integer flows. */
export async function buildBobTransport(
  data: BobTransportData,
  layout: BobLayout,
  options: BobOptions,
  allowRelays: boolean,
  signal?: AbortSignal,
  deadline = Infinity,
  reservationMode: 'fixed' | 'hints' = 'fixed',
) {
  const model = new CpModel();
  const occupancy = new Map<string, BobNode>();
  for (const node of layout.nodes) {
    if (reservationMode === 'hints' && node.kind === 'chest') continue;
    for (let x = node.position.x; x < node.position.x + node.size.width; x++)
      for (let y = node.position.y; y < node.position.y + node.size.height; y++)
        occupancy.set(pointKey({ x, y }), node);
  }
  const bases: Point[] = [];
  for (let x = 0; x < layout.width; x++)
    for (let y = 0; y < layout.height; y++) {
      if (!occupancy.has(pointKey({ x, y }))) bases.push({ x, y });
    }
  const reservedBases = new Map(layout.inserters.map((arm) => [pointKey(arm.position), arm]));
  const reservedChests = new Map(
    layout.nodes.filter((n) => n.kind === 'chest').map((n) => [pointKey(n.position), n]),
  );
  const optionalChests: BobNode[] = bases
    .filter(
      (p) =>
        (allowRelays || (reservationMode === 'hints' && reservedChests.has(pointKey(p)))) &&
        (reservationMode === 'hints' || !reservedBases.has(pointKey(p))),
    )
    .map(
      (p) =>
        reservedChests.get(pointKey(p)) ?? {
          id: `chest:${pointKey(p)}`,
          label: 'Relay chest',
          kind: 'chest',
          position: p,
          size: { width: 1, height: 1 },
        },
    );
  const nodes = [
    ...layout.nodes.filter((n) => reservationMode === 'fixed' || n.kind !== 'chest'),
    ...optionalChests,
  ];
  const chestAt = new Map(optionalChests.map((n) => [pointKey(n.position), n]));
  const chests = nodes.filter((n) => n.kind === 'chest');
  const present = new Map(chests.map((n) => [n.id, model.newBoolVar(`${n.id}:present`)]));
  for (const node of layout.nodes.filter((n) => n.kind === 'chest')) {
    if (reservationMode === 'fixed') model.add(present.get(node.id)!.eq(1));
    else if (present.has(node.id)) model.addHint(present.get(node.id)!, 1);
  }
  model.add(total(present.values()).le(options.maxChests));
  const incoming = new Map<string, Map<ResourceId, IntVar[]>>();
  const outgoing = new Map<string, Map<ResourceId, IntVar[]>>();
  const add = (map: typeof incoming, id: string, resource: ResourceId, rate: IntVar) => {
    if (!map.has(id)) map.set(id, new Map());
    const rates = map.get(id)!;
    if (!rates.has(resource)) rates.set(resource, []);
    rates.get(resource)!.push(rate);
  };
  const supports = (node: BobNode, resource: ResourceId, output: boolean) =>
    node.kind === 'chest' ||
    ((output ? data.outputs : data.inputs).get(node.id)?.[resource] ?? 0) > 0;
  const candidates: Candidate[] = [];
  const byBase = new Map<string, BoolVar[]>();
  const limits = new Map(
    data.resources.map((r) => [
      r,
      [...data.inputs.values()].reduce((n, rates) => n + (rates[r] ?? 0), 0),
    ]),
  );
  const conflicts = (timedOut: boolean): BobConflict[] => {
    const ranked = data.ports
      .map((port) => {
        const available = new Map<string, number>();
        for (const c of candidates)
          if (
            (port.side === 'input' ? c.to : c.from) === port.node &&
            c.resources.includes(port.resource)
          ) {
            const key = pointKey(c.position);
            available.set(
              key,
              Math.max(available.get(key) ?? 0, ...c.poses.map((p) => p.capacity)),
            );
          }
        const capacity = [...available.values()].reduce((n, c) => n + c, 0) / RATE_SCALE;
        return { port, available, capacity, deficit: capacity < port.rate };
      })
      .sort(
        (a, b) =>
          Number(b.deficit) - Number(a.deficit) ||
          a.available.size / a.port.rate - b.available.size / b.port.rate,
      );
    return ranked.slice(0, 2).map(({ port, available, capacity, deficit }) => {
      const node = nodes.find((n) => n.id === port.node)!;
      const tiles: Point[] = [];
      for (
        let x = Math.max(0, node.position.x - 3);
        x < Math.min(layout.width, node.position.x + node.size.width + 3);
        x++
      )
        for (
          let y = Math.max(0, node.position.y - 3);
          y < Math.min(layout.height, node.position.y + node.size.height + 3);
          y++
        ) {
          const distance =
            Math.max(node.position.x - x, 0, x - (node.position.x + node.size.width - 1)) +
            Math.max(node.position.y - y, 0, y - (node.position.y + node.size.height - 1));
          if (distance > 0 && distance <= 3) tiles.push({ x, y });
        }
      return {
        kind: timedOut ? 'timeout' : !available.size ? 'space' : deficit ? 'capacity' : 'routing',
        message: timedOut
          ? `${node.label}: transport search timed out; highlighted region is a candidate bottleneck.`
          : deficit
            ? `${node.label}: ${port.resource} ${port.side} needs ${port.rate}/s; candidate bases offer at most ${capacity.toFixed(1)}/s.`
            : `${node.label}: ${port.resource} ${port.side} is a candidate bottleneck in the failed transport selection.`,
        tiles,
        ports: [port],
      };
    });
  };
  const swings = bobSwings();
  for (let b = 0; b < bases.length; b++) {
    if (b % 32 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      signal?.throwIfAborted();
      if (performance.now() >= deadline) throw new BobTransportTimeout(conflicts(true));
    }
    const position = bases[b];
    const key = pointKey(position);
    const hint = reservedBases.get(key);
    const fixed = reservationMode === 'fixed' ? hint : undefined;
    const groups = new Map<
      string,
      { from: BobNode; to: BobNode; poses: Pose[]; resources: ResourceId[] }
    >();
    for (const swing of swings) {
      const pickup = { x: position.x + swing.pickup.x, y: position.y + swing.pickup.y };
      const dropoff = { x: position.x + swing.dropoff.x, y: position.y + swing.dropoff.y };
      const from = occupancy.get(pointKey(pickup)) ?? chestAt.get(pointKey(pickup));
      const to = occupancy.get(pointKey(dropoff)) ?? chestAt.get(pointKey(dropoff));
      if (!from || !to || from === to || from.kind === 'sink' || to.kind === 'source') continue;
      if (options.maxChests < 2 && from.kind === 'chest' && to.kind === 'chest') continue;
      if (
        fixed &&
        (from.id !== fixed.from ||
          to.id !== fixed.to ||
          pickup.x !== fixed.pickup.x ||
          pickup.y !== fixed.pickup.y ||
          dropoff.x !== fixed.dropoff.x ||
          dropoff.y !== fixed.dropoff.y)
      )
        continue;
      const pair = `${from.id}>${to.id}`;
      let group = groups.get(pair);
      if (!group) {
        const resources = data.resources.filter(
          (r) => supports(from, r, true) && supports(to, r, false),
        );
        if (!resources.length) continue;
        group = { from, to, poses: [], resources };
        groups.set(pair, group);
      }
      const pose = {
        pickup,
        dropoff,
        capacity: Math.floor(swing.capacity * RATE_SCALE),
        reach:
          Math.abs(swing.pickup.x) +
          Math.abs(swing.pickup.y) +
          Math.abs(swing.dropoff.x) +
          Math.abs(swing.dropoff.y),
      };
      // Endpoints occupy no space: retain only the capacity/reach Pareto frontier.
      if (group.poses.some((p) => p.capacity >= pose.capacity && p.reach <= pose.reach)) continue;
      group.poses = group.poses.filter((p) => p.capacity > pose.capacity || p.reach < pose.reach);
      group.poses.push(pose);
    }
    const selections: BoolVar[] = [];
    for (const group of groups.values()) {
      const index = candidates.length;
      const used = model.newBoolVar(`edge:${index}`);
      if (reservationMode === 'hints' && hint)
        model.addHint(used, Number(hint.from === group.from.id && hint.to === group.to.id));
      const capacity = Math.max(...group.poses.map((p) => p.capacity));
      const rates = new Map(
        group.resources.map((r) => [
          r,
          model.newIntVar(0, Math.min(capacity, limits.get(r)!), `flow:${index}:${r}`),
        ]),
      );
      const flow = total(rates.values());
      model.add(flow.le(used.times(capacity)));
      model.add(flow.ge(used));
      for (const node of [group.from, group.to])
        if (present.has(node.id)) model.addImplication(used, present.get(node.id)!);
      for (const [resource, rate] of rates) {
        add(outgoing, group.from.id, resource, rate);
        add(incoming, group.to.id, resource, rate);
      }
      candidates.push({
        position,
        from: group.from.id,
        to: group.to.id,
        poses: group.poses,
        resources: group.resources,
        used,
        rates,
      });
      selections.push(used);
    }
    byBase.set(key, selections);
    const tileChest = chestAt.get(key);
    model.addAtMostOne(tileChest ? [...selections, present.get(tileChest.id)!] : selections);
    if (fixed) {
      model.addExactlyOne(selections);
      for (const resource of Object.keys(fixed.rates) as ResourceId[]) {
        model.add(
          total(
            candidates
              .filter((c) => c.position === position)
              .flatMap((c) => (c.rates.has(resource) ? [c.rates.get(resource)!] : [])),
          ).ge(1),
        );
      }
    }
  }
  for (const node of nodes)
    for (const resource of data.resources) {
      const ins = total(incoming.get(node.id)?.get(resource) ?? []);
      const outs = total(outgoing.get(node.id)?.get(resource) ?? []);
      if (node.kind === 'chest') model.add(ins.eq(outs));
      else {
        model.add(ins.eq(data.inputs.get(node.id)?.[resource] ?? 0));
        model.add(outs.eq(data.outputs.get(node.id)?.[resource] ?? 0));
      }
    }
  for (const node of chests)
    model.add(total([...(incoming.get(node.id)?.values() ?? [])].flat()).ge(present.get(node.id)!));
  model.add(total(candidates.map((c) => c.used)).le(options.maxInserters));
  // Entity count dominates the bounded reach preference. No flow is rewarded.
  const reachBound = 6 * options.maxInserters + 1;
  model.minimize(
    total([...present.values(), ...candidates.map((c) => c.used)])
      .times(reachBound)
      .plus(
        LinearExpr.from(
          sum(candidates.map((c) => c.used.times(Math.min(...c.poses.map((p) => p.reach))))),
        ),
      ),
  );
  const read = (result: CpResult): BobLayout => ({
    ...layout,
    nodes: nodes.filter((n) => n.kind !== 'chest' || result.booleanValue(present.get(n.id)!)),
    inserters: candidates
      .filter((c) => result.booleanValue(c.used))
      .map((c) => {
        const rates = Object.fromEntries(
          [...c.rates].flatMap(([r, v]) =>
            Number(result.value(v)) ? [[r, Number(result.value(v)) / RATE_SCALE]] : [],
          ),
        );
        const load = Math.round(Object.values(rates).reduce((n, r) => n + r, 0) * RATE_SCALE);
        const pose = c.poses
          .filter((p) => p.capacity >= load)
          .sort((a, b) => a.reach - b.reach || b.capacity - a.capacity)[0];
        return {
          position: c.position,
          from: c.from,
          to: c.to,
          pickup: pose.pickup,
          dropoff: pose.dropoff,
          capacity: pose.capacity / RATE_SCALE,
          rates,
        };
      }),
  });
  return { model, read, conflicts, candidateCount: candidates.length, byBase };
}
