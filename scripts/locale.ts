import type { RLocale } from './raw-validators.ts';

export function resolveLocale(
  ls: unknown,
  fallbackId: string,
  locales: Record<string, RLocale>,
): string | undefined {
  // undefined: game defaults to recipe-name.<id>
  if (ls === undefined) return locales['recipe']?.names[fallbackId];

  if (typeof ls === 'string') return ls;

  if (!Array.isArray(ls) || ls.length === 0) return undefined;

  const key = ls[0];
  if (typeof key !== 'string' || key === '?') return undefined;

  if (key === '') {
    const parts: string[] = [];
    for (const el of ls.slice(1)) {
      if (typeof el === 'string') {
        parts.push(el);
      } else {
        const resolved = resolveLocale(el, fallbackId, locales);
        if (resolved === undefined) return undefined;
        parts.push(resolved);
      }
    }
    return parts.join('');
  }

  const dot = key.indexOf('.');
  if (dot === -1) return undefined;

  const category = key.slice(0, dot); // e.g. "item-name"
  const subId = key.slice(dot + 1); // e.g. "angels-void"

  const localeKey = category.replace(/-(name|description)$/, '');

  const name = locales[localeKey]?.names[subId];
  return name === 'Something went wrong' ? undefined : name;
}
