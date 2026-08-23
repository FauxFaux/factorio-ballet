import { complexityOf, resourceName, staticData } from './data.ts';
import type { Recipe, ResourceId } from './types.ts';

export interface RecipeMatch {
  id: string;
  recipe: Recipe;
  name: string;
}

export type Term =
  | { kind: 'makes' | 'uses'; query: string; resources: Set<ResourceId> }
  | { kind: 'text'; text: string };

function smatch(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle);
}

const isResourceId = (q: string): q is ResourceId =>
  q.startsWith('item:') || q.startsWith('fluid:');

/** The name part of a resource id, e.g. `item:iron-plate` -> `iron-plate`. */
export function bareName(id: ResourceId): string {
  return id.slice(id.indexOf(':') + 1);
}

/**
 * The resources a `makes:`/`uses:` query refers to. Exact ids win outright, then exact
 * names (internal or human), then anything containing the query.
 */
export function resolveResources(query: string): Set<ResourceId> {
  const q = query.toLowerCase();
  if (!q) return new Set();
  const ids = Object.keys(staticData.resources) as ResourceId[];

  if (isResourceId(q) && staticData.resources[q as ResourceId]) return new Set([q as ResourceId]);

  const exact = ids.filter(
    (id) => bareName(id).toLowerCase() === q || staticData.resources[id].human?.toLowerCase() === q,
  );
  if (exact.length) return new Set(exact);

  return new Set(ids.filter((id) => smatch(id, q) || smatch(resourceName(id), q)));
}

/**
 * The other direction of a search that is exactly one `makes:`/`uses:` term, e.g.
 * `uses:item:foo` -> `makes:item:foo`; `null` if there's no single term to flip.
 */
export function flipDirection(search: string): string | null {
  const word = search.trim();
  if (/\s/.test(word)) return null;
  const colon = word.indexOf(':');
  const rest = word.slice(colon + 1);
  if (!rest) return null;
  switch (word.slice(0, colon).toLowerCase()) {
    case 'uses':
      return `makes:${rest}`;
    case 'makes':
      return `uses:${rest}`;
    default:
      return null;
  }
}

/** Split a search string into terms; whitespace separates, and all terms must match. */
export function parseSearch(search: string): Term[] {
  return search
    .split(/\s+/)
    .filter((word) => word)
    .map((word): Term => {
      const colon = word.indexOf(':');
      const kind = colon === -1 ? '' : word.slice(0, colon).toLowerCase();
      if (kind === 'makes' || kind === 'uses') {
        const query = word.slice(colon + 1);
        return { kind, query, resources: resolveResources(query) };
      }
      return { kind: 'text', text: word.toLowerCase() };
    });
}

function matches(term: Term, id: string, recipe: Recipe, name: string): boolean {
  switch (term.kind) {
    case 'makes':
      return recipe.products.some((p) => term.resources.has(p.resource));
    case 'uses':
      return recipe.ingredients.some((i) => term.resources.has(i.resource));
    case 'text':
      return smatch(id, term.text) || smatch(name, term.text);
  }
}

/** Every recipe matching all the terms of `search`, simplest first; see `complexityOf`. */
export function searchRecipes(search: string): RecipeMatch[] {
  const terms = parseSearch(search);
  if (!terms.length) return [];

  const found: RecipeMatch[] = [];
  for (const [id, recipe] of Object.entries(staticData.recipes)) {
    const name = recipe.human ?? id;
    if (terms.every((term) => matches(term, id, recipe, name))) found.push({ id, recipe, name });
  }
  return found.sort(
    (a, b) =>
      complexityOf(a.recipe) - complexityOf(b.recipe) ||
      a.name.localeCompare(b.name) ||
      a.id.localeCompare(b.id),
  );
}
