import { useMemo } from 'preact/hooks';
import { flipDirection, searchMatches, type SearchScope } from '../search.ts';
import type { State } from '../ts.ts';
import type { MachineId, ResourceId } from '../types.ts';
import { RecipeCard } from './recipe.tsx';
import { ResourceButton } from './resource.tsx';
import { SearchBox } from './search-box.tsx';

const LIMIT = 20;

/**
 * Recipes matching a search: `makes:<resource>`, `uses:<resource>`, or free text against
 * the recipe's name and id. Multiple, space separated terms must all match. `progress` is where the
 * player is in the tech tree, 0 to 1, which orders the matches; see `relevanceOf`. `scope` is the
 * cell being worked on, which the `@in`/`@out` queries ask about.
 */
export function RecipeList({
  search: [search, setSearch],
  progress,
  scope,
  onAdd,
  onResourcePick,
  inCell,
}: {
  search: State<string>;
  progress: number;
  scope?: SearchScope;
  /** Add a recipe to the cell being worked on; absent when there is nothing to add it to. */
  onAdd?: (recipe: string, machine: MachineId | undefined) => void;
  /** Select a resource outside the search, for example to show its void paths. */
  onResourcePick?: (resource: ResourceId) => void;
  inCell?: (recipe: string) => boolean;
}) {
  const found = useMemo(() => searchMatches(search, progress, scope), [search, progress, scope]);
  const onPick = (id: ResourceId) => setSearch(`makes:${id}`);
  const flipped = flipDirection(search);

  return (
    <div class="recipe-list">
      <SearchBox
        search={[search, setSearch]}
        id="recipe-search"
        placeholder="Search resources and recipes, makes:item:iron-plate..."
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
        <p class="recipe-hint">Search for a resource or recipe.</p>
      ) : found.length === 0 ? (
        <p class="recipe-hint">No resources or recipes match.</p>
      ) : null}
      {found.slice(0, LIMIT).map((result) =>
        result.kind === 'recipe' ? (
          <RecipeCard
            key={`recipe:${result.match.id}`}
            match={result.match}
            onPick={onPick}
            onAdd={onAdd && ((machine) => onAdd(result.match.id, machine))}
            inCell={inCell?.(result.match.id)}
            progress={progress}
          />
        ) : (
          <div key={`resource:${result.match.id}`} class="recipe-resource-match">
            <ResourceButton
              id={result.match.id}
              onPick={(id) => {
                onResourcePick?.(id);
                onPick(id);
              }}
            />
          </div>
        ),
      )}
      {found.length > LIMIT ? (
        <p class="recipe-hint">…and {found.length - LIMIT} more; try a narrower search.</p>
      ) : null}
    </div>
  );
}
