import { useMemo } from 'preact/hooks';
import { searchRecipes } from '../search.ts';
import type { State } from '../ts.ts';
import type { ResourceId } from '../types.ts';
import { RecipeCard } from './recipe.tsx';

const LIMIT = 20;

/**
 * Recipes matching a search: `makes:<resource>`, `uses:<resource>`, or free text against
 * the recipe's name and id. Multiple, space separated terms must all match.
 */
export function RecipeList({ search: [search, setSearch] }: { search: State<string> }) {
  const found = useMemo(() => searchRecipes(search), [search]);
  const onPick = (id: ResourceId) => setSearch(`makes:${id}`);

  return (
    <div class="recipe-list">
      <p>
        <input
          type="text"
          value={search}
          onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
          placeholder="makes:item:iron-plate, uses:water, circuit..."
        />
      </p>
      {!search.trim() ? (
        <p class="recipe-hint">Pick a resource, or search for a recipe.</p>
      ) : found.length === 0 ? (
        <p class="recipe-hint">No recipes match.</p>
      ) : null}
      {found.slice(0, LIMIT).map((match) => (
        <RecipeCard key={match.id} match={match} onPick={onPick} />
      ))}
      {found.length > LIMIT ? (
        <p class="recipe-hint">…and {found.length - LIMIT} more; try a narrower search.</p>
      ) : null}
    </div>
  );
}
