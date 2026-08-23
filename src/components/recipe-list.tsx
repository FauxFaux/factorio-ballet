import { useMemo } from 'preact/hooks';
import { flipDirection, searchRecipes } from '../search.ts';
import type { State } from '../ts.ts';
import type { ResourceId } from '../types.ts';
import { RecipeCard } from './recipe.tsx';
import { SearchBox } from './search-box.tsx';

const LIMIT = 20;

/**
 * Recipes matching a search: `makes:<resource>`, `uses:<resource>`, or free text against
 * the recipe's name and id. Multiple, space separated terms must all match. `progress` is where the
 * player is in the tech tree, 0 to 1, which orders the matches; see `relevanceOf`.
 */
export function RecipeList({
  search: [search, setSearch],
  progress,
}: {
  search: State<string>;
  progress: number;
}) {
  const found = useMemo(() => searchRecipes(search, progress), [search, progress]);
  const onPick = (id: ResourceId) => setSearch(`makes:${id}`);
  const flipped = flipDirection(search);

  return (
    <div class="recipe-list">
      <SearchBox
        search={[search, setSearch]}
        placeholder="makes:item:iron-plate, uses:water, circuit..."
      >
        {flipped ? (
          <button
            type="button"
            class="search-btn"
            aria-label={`Search for ${flipped}`}
            title={`Search for ${flipped}`}
            onClick={() => setSearch(flipped)}
          >
            ⇄
          </button>
        ) : null}
      </SearchBox>
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
