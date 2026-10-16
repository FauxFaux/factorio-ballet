import { bobSwings } from './geometry.ts';
import { RATE_SCALE, type Point, type BobLayout, type BobInserter } from './types.ts';

const contains = (point: Point, node: BobLayout['nodes'][number]) =>
  point.x >= node.position.x &&
  point.y >= node.position.y &&
  point.x < node.position.x + node.size.width &&
  point.y < node.position.y + node.size.height;
const tileKey = (p: Point) => `${p.x},${p.y}`;
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Anneal collisions between legal base candidates, keeping the topology and machines fixed. */
export async function annealBobBases(
  layout: BobLayout,
  seconds: number,
  signal?: AbortSignal,
): Promise<BobLayout | undefined> {
  const deadline = performance.now() + seconds * 1000;
  const candidates: BobInserter[][] = [];
  for (const arm of layout.inserters) {
    const from = layout.nodes.find((n) => n.id === arm.from)!;
    const to = layout.nodes.find((n) => n.id === arm.to)!;
    const load = Object.values(arm.rates).reduce<number>((n, r) => n + r!, 0);
    const choices: BobInserter[] = [];
    for (
      let x = Math.max(0, from.position.x - 3);
      x < Math.min(layout.width, from.position.x + from.size.width + 3);
      x++
    ) {
      await pause();
      signal?.throwIfAborted();
      if (performance.now() >= deadline) return;
      for (
        let y = Math.max(0, from.position.y - 3);
        y < Math.min(layout.height, from.position.y + from.size.height + 3);
        y++
      ) {
        const position = { x, y };
        if (layout.nodes.some((n) => contains(position, n))) continue;
        // One best swing per base; endpoints occupy no space.
        const swing = bobSwings()
          .filter((s) => Math.floor(s.capacity * RATE_SCALE) >= Math.round(load * RATE_SCALE))
          .filter(
            (s) =>
              contains({ x: x + s.pickup.x, y: y + s.pickup.y }, from) &&
              contains({ x: x + s.dropoff.x, y: y + s.dropoff.y }, to),
          )
          .sort((a, b) => a.cycleSeconds - b.cycleSeconds)[0];
        if (swing)
          choices.push({
            ...arm,
            position,
            pickup: { x: x + swing.pickup.x, y: y + swing.pickup.y },
            dropoff: { x: x + swing.dropoff.x, y: y + swing.dropoff.y },
            capacity: Math.floor(swing.capacity * RATE_SCALE) / RATE_SCALE,
          });
      }
    }
    if (!choices.length) return;
    candidates.push(choices);
  }
  const selected = candidates.map((choices, i) =>
    choices.reduce((best, c) =>
      Math.abs(c.position.x - layout.inserters[i].position.x) +
        Math.abs(c.position.y - layout.inserters[i].position.y) <
      Math.abs(best.position.x - layout.inserters[i].position.x) +
        Math.abs(best.position.y - layout.inserters[i].position.y)
        ? c
        : best,
    ),
  );
  const occupied = new Map<string, number>();
  const change = (arm: BobInserter, delta: number) =>
    occupied.set(tileKey(arm.position), (occupied.get(tileKey(arm.position)) ?? 0) + delta);
  selected.forEach((a) => change(a, 1));
  let collisions = [...occupied.values()].reduce((n, count) => n + (count * (count - 1)) / 2, 0);
  const start = performance.now();
  while (collisions > 0 && performance.now() < deadline) {
    for (let batch = 0; batch < 256; batch++) {
      const i = Math.floor(Math.random() * selected.length),
        old = selected[i];
      const next = candidates[i][Math.floor(Math.random() * candidates[i].length)];
      if (tileKey(old.position) === tileKey(next.position)) continue;
      const delta =
        (occupied.get(tileKey(next.position)) ?? 0) -
        ((occupied.get(tileKey(old.position)) ?? 1) - 1);
      const temperature = Math.max(
        0.01,
        1 - (performance.now() - start) / Math.max(1, deadline - start),
      );
      if (delta <= 0 || Math.random() < Math.exp(-delta / temperature)) {
        change(old, -1);
        change(next, 1);
        selected[i] = next;
        collisions += delta;
      }
      if (collisions === 0) break;
    }
    await pause();
    signal?.throwIfAborted();
  }
  signal?.throwIfAborted();
  return collisions === 0 ? { ...layout, transport: undefined, inserters: selected } : undefined;
}
