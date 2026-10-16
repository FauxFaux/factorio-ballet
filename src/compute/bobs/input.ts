import type { BobProblem, BobOptions } from './types.ts';

export function checkBobInput(problem: BobProblem, options: BobOptions) {
  if (!problem.machines.length) throw new Error('Add a recipe to place assemblers.');
  if (problem.machines.length > 24)
    throw new Error('This experimental search supports at most 24 assemblers.');
  if (
    new Set(problem.machines.map((m) => m.id)).size !== problem.machines.length ||
    problem.machines.some((m) => /^(source|sink|chest):/.test(m.id))
  ) {
    throw new Error('Machine IDs must be unique and must not use reserved chest IDs.');
  }
  for (const m of problem.machines) {
    if (![m.size.width, m.size.height].every((n) => Number.isInteger(n) && n > 0))
      throw new Error('Machine footprints must use positive whole tiles.');
    for (const [resource, rate] of [...Object.entries(m.inputs), ...Object.entries(m.outputs)]) {
      if (!resource.startsWith('item:'))
        throw new Error('Inserter transport requires item resources.');
      if (!Number.isFinite(rate) || rate! < 0 || rate! > 1e6)
        throw new Error('Item rates must be finite, nonnegative and at most 1,000,000/s.');
    }
  }
  if (
    ![options.maxWidth, options.maxHeight].every((n) => Number.isInteger(n) && n > 0 && n <= 128) ||
    !Number.isInteger(options.maxChests) ||
    options.maxChests < 0 ||
    options.maxChests > 32 ||
    !Number.isInteger(options.maxInserters) ||
    options.maxInserters < 0 ||
    options.maxInserters > 128 ||
    !Number.isFinite(options.maxTimeInSeconds) ||
    options.maxTimeInSeconds <= 0 ||
    options.maxTimeInSeconds > 120
  ) {
    throw new Error(
      'Use bounds of 1–128 tiles, 0–32 relay chests, 0–128 inserters and 0–120 seconds.',
    );
  }
}
