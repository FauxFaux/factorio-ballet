/** Leave one logical processor available and cap solver parallelism. */
export function bobSolverWorkers(): number {
  const cores = typeof navigator === 'undefined' ? 2 : (navigator.hardwareConcurrency ?? 2);
  return Math.max(1, cores - 1);
}
