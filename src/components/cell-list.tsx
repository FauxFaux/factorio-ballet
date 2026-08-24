import './cell-list.css';
import { activeAfterRemoval, newCell, withoutCell, type Cell } from '../cell.ts';
import { atIndex, type State } from '../ts.ts';
import type { ChosenModules } from '../data.ts';
import { CellBox } from './cell/box.tsx';

/**
 * The cells being planned, and the controls for which one is being worked on. Adding a recipe from
 * the search goes to that one, so the whole list is really one editor plus its neighbours.
 */
export function CellList({
  cells,
  active,
  progress,
  modules,
  setSearch,
}: {
  cells: State<Cell[]>;
  active: State<number>;
  /** Where the player is through the game, which decides the machine a recipe defaults to. */
  progress: number;
  /** Which module the header means by each family a row can spend; see `ChosenModules`. */
  modules: ChosenModules;
  setSearch: (search: string) => void;
}) {
  const [list, setList] = cells;
  const [current, setCurrent] = active;

  const add = () => {
    setList((prev) => [...prev, newCell()]);
    setCurrent(list.length);
  };

  /* The index of the cell being worked on has to survive the removal of another; see
   * {@link activeAfterRemoval}. */
  const remove = (index: number) => {
    const left = list.length - 1;
    setList((prev) => withoutCell(prev, index));
    setCurrent((prev) => activeAfterRemoval(prev, index, left));
  };

  return (
    <section class="cells">
      <header class="cells-head">
        <h2>Cells</h2>
        <button type="button" class="cell-btn" title="Start an empty cell" onClick={add}>
          + cell
        </button>
      </header>
      {list.length === 0 ? (
        <p class="recipe-hint">
          No cells yet: add a recipe from the search with <code>+</code> to start one.
        </p>
      ) : null}
      {list.map((_, i) => (
        <CellBox
          key={i}
          cell={atIndex(cells, i)}
          active={i === current}
          progress={progress}
          modules={modules}
          onActivate={() => setCurrent(i)}
          onRemove={() => remove(i)}
          /* Searching from a cell means working on it: the `@in`/`@out` queries read the cell being
           * worked on, so a search launched from another one would answer about the wrong cell. */
          onSearch={(search) => {
            setCurrent(i);
            setSearch(search);
          }}
        />
      ))}
    </section>
  );
}
