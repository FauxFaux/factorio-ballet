import type { BobProblem } from './types.ts';

export function checkBobInput(problem: BobProblem, maxMachines = 24) {
  if (!problem.machines.length) throw new Error('Add a recipe to place assemblers.');
  if (problem.machines.length > maxMachines)
    throw new Error(`This experimental search supports at most ${maxMachines} assemblers.`);
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
}
