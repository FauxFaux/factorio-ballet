import { findPath, type PathSearchInput } from '../src/compute/routing/path-search.ts';

// Fixed inputs make outcomes and expansion counts comparable across routing implementations.
let seed = 1729;
function random(): number {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 2 ** 32;
}

const inputs: PathSearchInput[] = Array.from({ length: 1000 }, () => {
  const width = 16;
  const height = 12;
  const blocked = Uint8Array.from({ length: width * height }, () => Number(random() < 0.32));
  const start = { x: Math.floor(random() * width), y: Math.floor(random() * height) };
  const goal = { x: Math.floor(random() * width), y: Math.floor(random() * height) };
  blocked[start.y * width + start.x] = blocked[goal.y * width + goal.x] = 0;
  return { width, height, blocked, start, goal, undergroundBeltReach: 5 };
});

for (const input of inputs.slice(0, 50)) findPath(input, { remaining: 20_000 });
const outcomes = { found: 0, 'no-path': 0, 'budget-exhausted': 0, invalid: 0 };
const times: number[] = [];
let states = 0;
for (const input of inputs) {
  const budget = { remaining: 20_000 };
  const began = performance.now();
  const result = findPath(input, budget);
  times.push(performance.now() - began);
  states += 20_000 - budget.remaining;
  outcomes[result.kind]++;
}
const totalMs = times.reduce((sum, time) => sum + time, 0);
times.sort((a, b) => a - b);
console.log(JSON.stringify({ outcomes, states, totalMs, p95Ms: times[949], maxMs: times.at(-1) }));
