import { useMemo } from 'preact/hooks';
import { staticData } from '../data/index.ts';
import type { Chosen } from '../data/index.ts';
import { flipDirection, searchMatches, type SearchScope } from '../search.ts';
import type { State } from '../ts.ts';
import type { MachineId, ResourceId } from '../types.ts';
import { RecipeCard } from './recipe.tsx';
import { ResourceButton } from './resource.tsx';
import { SearchBox } from './search-box.tsx';

const LIMIT = 20;

/** Resources that have one, and only one, recipe that produces them. */
const soleProducer = (() => {
  const producers = new Map<ResourceId, string>();
  const ambiguous = new Set<ResourceId>();
  for (const [id, recipe] of Object.entries(staticData.recipes)) {
    for (const resource of new Set(recipe.products.map((product) => product.resource))) {
      if (ambiguous.has(resource)) continue;
      if (producers.has(resource)) {
        producers.delete(resource);
        ambiguous.add(resource);
      } else {
        producers.set(resource, id);
      }
    }
  }
  return producers;
})();

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
  chosen,
}: {
  search: State<string>;
  progress: number;
  scope?: SearchScope;
  /** Add a recipe to the cell being worked on; absent when there is nothing to add it to. */
  onAdd?: (recipe: string, machine: MachineId | undefined) => void;
  /** Select a resource outside the search, for example to show its void paths. */
  onResourcePick?: (resource: ResourceId) => void;
  inCell?: (recipe: string) => boolean;
  /** The header's resolved module and beacon choices, shared by every search result. */
  chosen: Chosen;
}) {
  const found = useMemo(() => searchMatches(search, progress, scope), [search, progress, scope]);
  const ordered = useMemo(() => {
    const barrelRecipes = found.filter(
      (result) => result.kind === 'recipe' && result.match.id.endsWith('-barrel'),
    );
    const otherResults = found.filter(
      (result) => result.kind !== 'recipe' || !result.match.id.endsWith('-barrel'),
    );
    return [...otherResults, ...barrelRecipes];
  }, [found]);
  const displayed = useMemo(() => {
    /* Removing a resource can bring another recipe into the visible limit. Repeat until every
       hidden resource has its one producer card visibly shown. */
    const hidden = new Set<ResourceId>();
    let changed = true;
    while (changed) {
      const visibleRecipes = new Set(
        ordered
          .filter((result) => result.kind === 'recipe' || !hidden.has(result.match.id))
          .slice(0, LIMIT)
          .filter((result) => result.kind === 'recipe')
          .map((result) => result.match.id),
      );
      changed = false;
      for (const [resource, recipe] of soleProducer) {
        if (visibleRecipes.has(recipe) && !hidden.has(resource)) {
          hidden.add(resource);
          changed = true;
        }
      }
    }
    return ordered.filter((result) => result.kind === 'recipe' || !hidden.has(result.match.id));
  }, [ordered]);
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
      ) : displayed.length === 0 ? (
        <p class="recipe-hint">No resources or recipes match.</p>
      ) : null}
      {displayed.slice(0, LIMIT).map((result) =>
        result.kind === 'recipe' ? (
          <RecipeCard
            key={`recipe:${result.match.id}`}
            match={result.match}
            onPick={onPick}
            onAdd={onAdd && ((machine) => onAdd(result.match.id, machine))}
            inCell={inCell?.(result.match.id)}
            progress={progress}
            chosen={chosen}
          />
        ) : (
          <div key={`resource:${result.match.id}`} class="recipe-resource-match">
            <ResourceButton
              id={result.match.id}
              onPick={(id) => {
                onResourcePick?.(id);
                onPick(id);
              }}
            >
              {' '}
              (show other recipes)
            </ResourceButton>
          </div>
        ),
      )}
      {displayed.length > LIMIT ? (
        <p class="recipe-hint">…and {displayed.length - LIMIT} more; try a narrower search.</p>
      ) : null}
    </div>
  );
}
