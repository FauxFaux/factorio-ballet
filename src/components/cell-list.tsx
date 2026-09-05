import './cell-list.css';
import { useEffect, useRef, useState } from 'preact/hooks';
import { activeAfterRemoval, newCell, withoutCell, type Cell } from '../cell.ts';
import { atIndex, type State } from '../ts.ts';
import type { Chosen } from '../data/index.ts';
import { CellBox } from './cell/box.tsx';

/**
 * The cells being planned, and the controls for which one is being worked on. Adding a recipe from
 * the search goes to that one, so the whole list is really one editor plus its neighbours.
 */
export function CellList({
  cells,
  active,
  progress,
  chosen,
  setSearch,
}: {
  cells: State<Cell[]>;
  active: State<number>;
  /** Where the player is through the game, which decides the machine a recipe defaults to. */
  progress: number;
  /** What the header says a row has to spend: modules and a beacon; see `Chosen`. */
  chosen: Chosen;
  setSearch: (search: string) => void;
}) {
  const [list, setList] = cells;
  const [current, setCurrent] = active;
  const [designs, setDesigns] = useState<number[]>([]);

  const add = () => {
    setList((prev) => [...prev, newCell()]);
    setCurrent(list.length);
  };

  const addDesign = () => {
    setDesigns((previous) => [...previous, previous.length]);
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
        <button type="button" class="cell-btn" title="Start a blank design" onClick={addDesign}>
          + design
        </button>
      </header>
      {designs.map((design) => (
        <Design key={design} number={design + 1} />
      ))}
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
          chosen={chosen}
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

/** A blank construction area. Its columns are deliberately placeholders until design content exists. */
function Design({ number }: { number: number }) {
  const surface = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(1);

  useEffect(() => {
    const element = surface.current;
    if (!element) return;

    const updateColumnCount = () => {
      setColumnCount(Math.max(1, Math.floor((element.clientWidth + 8) / (600 + 8))));
    };

    updateColumnCount();
    if (!('ResizeObserver' in globalThis)) return;
    const observer = new ResizeObserver(updateColumnCount);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <section class="design" aria-label={`Design ${number}`}>
      <header class="design-head">Design {number}</header>
      <div
        ref={surface}
        class="design-surface"
        style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: columnCount }, (_, index) => (
          <section key={index} class="design-column">
            <h3>Column {index + 1}</h3>
          </section>
        ))}
      </div>
    </section>
  );
}
