export function _pick<T extends object, K extends keyof T>(
  obj: T,
  keys: readonly K[],
): Pick<T, K> {
  const ret = {} as Pick<T, K>;
  for (const key of keys) {
    ret[key] = obj[key];
  }
  return ret;
}
