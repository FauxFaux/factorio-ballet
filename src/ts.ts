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

/**
 * `Object.values` / `Object.entries` with the element type kept. Both lie a little — a runtime
 * object can carry keys its type does not mention, and `Object.keys` stringifies numeric ones —
 * which is the usual price for these helpers.
 *
 * The reason to reach for them: over a *union* of object types the built-ins give up silently.
 * `Object.values` cannot infer one element type from `Record<string, A> | Record<string, B>`, so
 * overload resolution falls through to `(o: {}) => any[]` and the loop body stops being checked
 * with nothing to warn you. That bites whenever a list of `keyof RawData` is walked in a loop
 * (`scripts/raw-keys.ts`); these resolve to `A | B` instead.
 */
export const valuesOf = Object.values as <T extends object>(obj: T) => Array<T[keyof T]>;
export const entriesOf = Object.entries as <T extends object>(
  obj: T,
) => Array<[keyof T, T[keyof T]]>;

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

/**
 * A `State` for one element of a state array, writing back through its setter; `field` for a list.
 * The index is captured, so a setter outlives its element only as far as the render it came from —
 * which is exactly how long a click handler lives.
 */
export function atIndex<T>([value, setValue]: State<T[]>, index: number): State<T> {
  return [
    value[index],
    (update) =>
      setValue((prev) =>
        prev.map((item, i) =>
          i !== index
            ? item
            : typeof update === 'function'
              ? (update as (prev: T) => T)(item)
              : update,
        ),
      ),
  ];
}

/** A number with enough precision to be useful, and no more. */
export function fmt(value: number): string {
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : value >= 1 ? 2 : 3;
  const fixed = value.toFixed(digits);
  return fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
}

/** Decimal places needed to show this magnitude to the requested significant-figure precision. */
export function decimalPlacesForSignificantFigures(value: number, figures: number): number {
  if (value === 0) return 0;
  return Math.max(0, figures - 1 - Math.floor(Math.log10(Math.abs(value))));
}
