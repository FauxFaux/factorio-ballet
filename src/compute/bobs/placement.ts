import {
  CpModel,
  LinearExpr,
  sum,
  type IntVar,
  type IntervalVar,
  type CpResult,
  type BoolVar,
} from 'or-tools-wasm/cp-sat';
import { bobSwings } from './geometry.ts';
import { MAX_BOB_CAPACITY, portKey, type BobTransportData } from './problem-data.ts';
import {
  RATE_SCALE,
  type BobLayout,
  type BobNode,
  type BobOptions,
  type BobPort,
} from './types.ts';

const total = (values: Iterable<IntVar>) => LinearExpr.from(sum(values));

/** Pack machines and boundary chests; only promoted ports introduce arm geometry. */
export function buildBobPlacement(
  data: BobTransportData,
  options: BobOptions,
  promoted: BobPort[],
  previous: BobLayout[],
  minimumPerimeter = 0,
) {
  const model = new CpModel();
  const width = model.newIntVar(1, options.maxWidth, 'width');
  const height = model.newIntVar(1, options.maxHeight, 'height');
  const horizontal: IntervalVar[] = [];
  const vertical: IntervalVar[] = [];
  const rectangle = (definition: BobNode, optional = false) => {
    const { id, size } = definition;
    const present = model.newBoolVar(`${id}:present`);
    if (!optional) model.add(present.eq(1));
    const x = model.newIntVar(0, Math.max(2, options.maxWidth - 1), `${id}:x`);
    const y = model.newIntVar(0, Math.max(2, options.maxHeight - 1), `${id}:y`);
    const w = model.newIntVar(
      Math.min(size.width, size.height),
      Math.max(size.width, size.height),
      `${id}:w`,
    );
    const h = model.newIntVar(
      Math.min(size.width, size.height),
      Math.max(size.width, size.height),
      `${id}:h`,
    );
    model.addAllowedAssignments(
      [w, h],
      [
        [size.width, size.height],
        [size.height, size.width],
      ],
    );
    const right = model.newIntVar(
      1,
      options.maxWidth + Math.max(size.width, size.height),
      `${id}:right`,
    );
    const bottom = model.newIntVar(
      1,
      options.maxHeight + Math.max(size.width, size.height),
      `${id}:bottom`,
    );
    model.add(right.eq(x.plus(w)));
    model.add(bottom.eq(y.plus(h)));
    model.add(right.le(width)).onlyEnforceIf(present);
    model.add(bottom.le(height)).onlyEnforceIf(present);
    model.add(x.eq(0)).onlyEnforceIf(present.not());
    model.add(y.eq(0)).onlyEnforceIf(present.not());
    horizontal.push(
      model.newOptionalIntervalVar(
        x,
        size.width === size.height ? size.width : w,
        right,
        present,
        `${id}:horizontal`,
      ),
    );
    vertical.push(
      model.newOptionalIntervalVar(
        y,
        size.width === size.height ? size.height : h,
        bottom,
        present,
        `${id}:vertical`,
      ),
    );
    return { definition, x, y, w, h, right, bottom, present };
  };
  const nodes = data.nodes.map((d) => rectangle(d));
  for (const node of nodes) {
    if (node.definition.kind === 'assembler') continue;
    const sides = Array.from({ length: 4 }, (_, i) =>
      model.newBoolVar(`${node.definition.id}:side:${i}`),
    );
    model.addBoolOr(sides);
    [node.x.eq(0), node.y.eq(0), node.right.eq(width), node.bottom.eq(height)].forEach((c, i) =>
      model.add(c).onlyEnforceIf(sides[i]),
    );
  }
  const relays = promoted.slice(0, options.maxChests).map((_, i) =>
    rectangle(
      {
        id: `chest:reserved:${i}`,
        label: `Reserved relay ${i + 1}`,
        kind: 'chest',
        size: { width: 1, height: 1 },
        position: { x: 0, y: 0 },
      },
      true,
    ),
  );
  const resources = [...new Set(promoted.map((p) => p.resource))];
  const incoming = new Map<string, IntVar[]>();
  const outgoing = new Map<string, IntVar[]>();
  const addFlow = (
    node: string,
    side: BobPort['side'],
    resource: BobPort['resource'],
    flow: IntVar,
  ) => {
    const map = side === 'input' ? incoming : outgoing;
    const key = portKey({ node, side, resource, rate: 0 });
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(flow);
  };
  const uniquePartner = (port: BobPort) => {
    const partners = data.nodes.filter(
      (n) =>
        n.id !== port.node &&
        ((port.side === 'input' ? data.outputs : data.inputs).get(n.id)?.[port.resource] ?? 0) > 0,
    );
    return partners.length === 1 ? partners[0].id : undefined;
  };
  // With no relays and exactly one producer/consumer, mirrored ports describe
  // the same set of arms. Keep one bank of optional slots for that connection.
  const anchors = promoted.filter((port, i) => {
    if (options.maxChests) return true;
    const partner = uniquePartner(port);
    return !promoted
      .slice(0, i)
      .some(
        (other) =>
          other.resource === port.resource &&
          other.side !== port.side &&
          other.node === partner &&
          uniquePartner(other) === port.node,
      );
  });
  const arms = anchors.flatMap((port, p) => {
    const count = Math.ceil((port.rate * RATE_SCALE) / MAX_BOB_CAPACITY);
    const slots = Array.from({ length: count }, (_, a) => {
      const id = `reserved-arm:${p}:${a}`;
      const base = rectangle(
        {
          id,
          label: id,
          kind: 'chest',
          size: { width: 1, height: 1 },
          position: { x: 0, y: 0 },
        },
        true,
      );
      const offsets = ['px', 'py', 'dx', 'dy'].map((s) => model.newIntVar(-3, 3, `${id}:${s}`));
      const capacity = model.newIntVar(0, MAX_BOB_CAPACITY, `${id}:capacity`);
      model.addAllowedAssignments(
        [...offsets, capacity],
        [
          [0, 0, 0, 0, 0],
          ...bobSwings().map((s) => [
            s.pickup.x,
            s.pickup.y,
            s.dropoff.x,
            s.dropoff.y,
            Math.floor(s.capacity * RATE_SCALE),
          ]),
        ],
      );
      model.add(capacity.eq(0)).onlyEnforceIf(base.present.not());
      model.add(capacity.ge(1)).onlyEnforceIf(base.present);
      const px = base.x.plus(offsets[0]);
      const py = base.y.plus(offsets[1]);
      const dx = base.x.plus(offsets[2]);
      const dy = base.y.plus(offsets[3]);
      const own = nodes.find((n) => n.definition.id === port.node)!;
      const contains = (node: typeof own, ex: typeof px, ey: typeof py, selected: BoolVar) => {
        model.add(ex.ge(node.x)).onlyEnforceIf(selected);
        model.add(ey.ge(node.y)).onlyEnforceIf(selected);
        model.add(ex.lt(node.right)).onlyEnforceIf(selected);
        model.add(ey.lt(node.bottom)).onlyEnforceIf(selected);
      };
      contains(own, port.side === 'input' ? dx : px, port.side === 'input' ? dy : py, base.present);
      const ownRates = (port.side === 'input' ? data.inputs : data.outputs).get(port.node) ?? {};
      const rates = new Map(
        resources.map((resource) => [
          resource,
          model.newIntVar(
            0,
            Math.min(MAX_BOB_CAPACITY, ownRates[resource] ?? 0),
            `${id}:flow:${resource}`,
          ),
        ]),
      );
      model.add(total(rates.values()).le(capacity));
      model.add(rates.get(port.resource)!.ge(base.present));
      for (const [resource, flow] of rates) addFlow(port.node, port.side, resource, flow);
      const partners = [
        ...nodes.filter(
          (n) =>
            n !== own &&
            ((port.side === 'input' ? data.outputs : data.inputs).get(n.definition.id)?.[
              port.resource
            ] ?? 0) > 0,
        ),
        ...relays,
      ];
      const selected = partners.map((node, n) => {
        const chosen = model.newBoolVar(`${id}:partner:${n}`);
        model.addImplication(chosen, node.present);
        contains(node, port.side === 'input' ? px : dx, port.side === 'input' ? py : dy, chosen);
        for (const [resource, flow] of rates) {
          const limit =
            node.definition.kind === 'chest'
              ? MAX_BOB_CAPACITY
              : ((port.side === 'input' ? data.outputs : data.inputs).get(node.definition.id)?.[
                  resource
                ] ?? 0);
          model.add(flow.le(limit)).onlyEnforceIf(chosen);
          if (!limit) continue;
          const transferred = model.newIntVar(
            0,
            Math.min(MAX_BOB_CAPACITY, limit),
            `${id}:${n}:flow:${resource}`,
          );
          model.add(transferred.eq(flow)).onlyEnforceIf(chosen);
          model.add(transferred.eq(0)).onlyEnforceIf(chosen.not());
          addFlow(
            node.definition.id,
            port.side === 'input' ? 'output' : 'input',
            resource,
            transferred,
          );
        }
        return chosen;
      });
      model.add(total(selected).eq(base.present));
      return { base, offsets, capacity, partners, selected, port, rates };
    });
    slots.forEach((slot, i) => {
      if (!i) return;
      const previous = slots[i - 1];
      model.addImplication(slot.base.present, previous.base.present);
      model
        .add(
          previous.base.x
            .times(options.maxHeight)
            .plus(previous.base.y)
            .lt(slot.base.x.times(options.maxHeight).plus(slot.base.y)),
        )
        .onlyEnforceIf(slot.base.present);
    });
    return slots;
  });
  for (const node of data.nodes)
    for (const side of ['input', 'output'] as const)
      for (const resource of resources) {
        const key = portKey({ node: node.id, side, resource, rate: 0 });
        const flow = total((side === 'input' ? incoming : outgoing).get(key) ?? []);
        const demand =
          (side === 'input' ? data.inputs : data.outputs).get(node.id)?.[resource] ?? 0;
        // The same physical arm contributes at both ends, and may carry several resources.
        model.add(promoted.some((p) => portKey(p) === key) ? flow.eq(demand) : flow.le(demand));
      }
  model.add(total(arms.map((a) => a.base.present)).le(options.maxInserters));
  model.addNoOverlap2D(horizontal, vertical);
  const area = model.newIntVar(1, options.maxWidth * options.maxHeight, 'area');
  model.addMultiplicationEquality(area, [width, height]);
  model.add(
    area.ge(data.nodes.reduce((n, d) => n + d.size.width * d.size.height, 0) + data.minInserters),
  );
  model.add(width.plus(height).ge(minimumPerimeter));
  for (const layout of previous) {
    const oldNodes = data.nodes.map((d) => layout.nodes.find((n) => n.id === d.id)!);
    model.addForbiddenAssignments(
      [width, height, ...nodes.flatMap((n) => [n.x, n.y, n.w, n.h])],
      [
        [
          layout.width,
          layout.height,
          ...oldNodes.flatMap((n) => [n.position.x, n.position.y, n.size.width, n.size.height]),
        ],
      ],
    );
  }
  model.minimize(
    width
      .plus(height)
      .times(options.maxChests + options.maxInserters + 1)
      .plus(total([...relays.map((n) => n.present), ...arms.map((a) => a.base.present)])),
  );
  const read = (result: CpResult): BobLayout => {
    const value = (v: IntVar) => Number(result.value(v));
    return {
      width: value(width),
      height: value(height),
      nodes: [...nodes, ...relays]
        .filter((n) => result.booleanValue(n.present))
        .map((n) => ({
          ...n.definition,
          position: { x: value(n.x), y: value(n.y) },
          size: { width: value(n.w), height: value(n.h) },
        })),
      inserters: arms
        .filter((arm) => result.booleanValue(arm.base.present))
        .map((arm) => {
          const position = { x: value(arm.base.x), y: value(arm.base.y) };
          const partner =
            arm.partners[arm.selected.findIndex((s) => result.booleanValue(s))].definition.id;
          return {
            position,
            pickup: {
              x: position.x + value(arm.offsets[0]),
              y: position.y + value(arm.offsets[1]),
            },
            dropoff: {
              x: position.x + value(arm.offsets[2]),
              y: position.y + value(arm.offsets[3]),
            },
            from: arm.port.side === 'input' ? partner : arm.port.node,
            to: arm.port.side === 'input' ? arm.port.node : partner,
            capacity: value(arm.capacity) / RATE_SCALE,
            rates: Object.fromEntries(
              [...arm.rates].flatMap(([r, v]) => (value(v) ? [[r, value(v) / RATE_SCALE]] : [])),
            ),
          };
        }),
    };
  };
  return { model, read };
}
