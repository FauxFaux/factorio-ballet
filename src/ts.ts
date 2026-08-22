import type { Dispatch, StateUpdater } from 'preact/hooks';

export const debounce = <F extends (...args: Parameters<F>) => ReturnType<F>>(
  func: F,
  waitFor: number,
) => {
  let timeoutKey: ReturnType<typeof setTimeout>;

  return (...args: Parameters<F>) => {
    clearTimeout(timeoutKey);
    timeoutKey = setTimeout(() => func(...args), waitFor);
  };
};

export type Setter<S> = Dispatch<StateUpdater<S>>;
export type State<T> = [T, Setter<T>];

/** A `State` for one key of a larger state object, writing back through its setter. */
export function field<T, K extends keyof T>([value, setValue]: State<T>, key: K): State<T[K]> {
  return [
    value[key],
    (update) =>
      setValue((prev) => ({
        ...prev,
        [key]: typeof update === 'function' ? (update as (prev: T[K]) => T[K])(prev[key]) : update,
      })),
  ];
}
