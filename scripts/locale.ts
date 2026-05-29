import type { RLocale } from './raw-validators.ts';

const SENTINELS = new Set([
  'Something went wrong',
  'Unknown entity',
  'Unknown fluid',
  'Unknown item',
  'Unknown',
  'Unknown recipe',
  'Unknown tile',
  'Unknown signal',
]);

function validName(name: string | undefined): string | undefined {
  return name === undefined || SENTINELS.has(name) ? undefined : name;
}

export function resolveLocale(
  ls: unknown,
  fallbackId: string,
  locales: Record<string, RLocale>,
  fallbackLocale: string,
): string | undefined {
  // undefined: game defaults to <type>-name.<id>
  if (ls === undefined) return validName(locales[fallbackLocale]?.names[fallbackId]);

  if (typeof ls === 'string') return validName(ls);

  if (!Array.isArray(ls) || ls.length === 0) return undefined;

  const key = ls[0];
  if (typeof key !== 'string' || key === '?') return undefined;

  if (key === '') {
    const parts: string[] = [];
    for (const el of ls.slice(1)) {
      if (typeof el === 'string') {
        parts.push(el);
      } else {
        const resolved = resolveLocale(el, fallbackId, locales, fallbackLocale);
        if (resolved === undefined) return undefined;
        parts.push(resolved);
      }
    }
    return validName(parts.join('')) ?? undefined;
  }

  const dot = key.indexOf('.');
  if (dot === -1) return undefined;

  const category = key.slice(0, dot); // e.g. "item-name"
  const subId = key.slice(dot + 1);   // e.g. "angels-void"

  const localeKey = category.replace(/-(name|description)$/, '');

  return validName(locales[localeKey]?.names[subId]);
}
