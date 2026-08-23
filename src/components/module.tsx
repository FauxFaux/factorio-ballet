import './module.css';
import {
  defaultModule,
  headlineEffect,
  moduleCategories,
  moduleName,
  modulesIn,
  type ModuleCategory,
  type ModuleChoice,
  type ModuleMatch,
} from '../data.ts';
import { useMenu } from './menu.ts';
import { fmt, type State } from '../ts.ts';
import type { Module, ModuleId } from '../types.ts';
import { resourceIconStyle } from './icon.tsx';

/** One of a module's effects as a percentage, sign and all: `+40%`, `−15%`. */
const percent = (value: number): string => `${value < 0 ? '−' : '+'}${fmt(Math.abs(value) * 100)}%`;

/** Everything a module does, for a tooltip: the headline first, then what it cost to get it. */
function effectSummary(category: ModuleCategory, module: Module): string {
  const other = category.effect === 'speed' ? 'productivity' : 'speed';
  const headline = `${percent(headlineEffect(category, module))} ${category.effect}`;
  const trade = module[other];
  return trade ? `${headline}, ${percent(trade)} ${other}` : headline;
}

/**
 * Which module of one family to reach for, as a dropdown: a {@link MachinePicker} for modules, and
 * the same shape for the same reason — the choice is usually already made, so the list of the other
 * four tiers is worth none of the header's width until it is asked for.
 *
 * It is a preference and not a loadout: how many of them go in which machine is the cell's
 * business, and this only says which tier is meant by "a speed module".
 */
export function ModulePicker({
  category,
  modules,
  chosen,
  pinned,
  onChoose,
}: {
  category: ModuleCategory;
  modules: ModuleMatch[];
  /** The module in use, whether that was chosen or defaulted. */
  chosen?: ModuleId;
  /** Whether {@link chosen} was the user's choice rather than the default standing in for one. */
  pinned: boolean;
  onChoose: (id: ModuleId | undefined) => void;
}) {
  const { open, setOpen, box } = useMenu();

  if (modules.length === 0) return null;

  const current = modules.find(({ id }) => id === chosen);
  const label = current
    ? `${moduleName(current.id)}: ${effectSummary(category, current.module)}${
        pinned ? '' : ', by default for this progress'
      }`
    : `No ${category.human} module`;

  const choose = (id: ModuleId | undefined) => {
    onChoose(id);
    setOpen(false);
  };

  return (
    <div class="module-picker" ref={box}>
      <button
        type="button"
        class={pinned ? 'module is-active' : 'module'}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`${label} — click to change`}
        onClick={() => setOpen(!open)}
      >
        {current ? (
          <>
            <span
              class="module-icon"
              style={resourceIconStyle(`item:${current.id}`)}
              aria-hidden="true"
            />
            <span class="module-effect">{percent(headlineEffect(category, current.module))}</span>
          </>
        ) : (
          <span class="module-effect">—</span>
        )}
        <span class="module-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div class="module-menu" role="listbox" aria-label={`${category.human} module`}>
          {/* As the machine picker's "auto": not the same choice as the tier it happens to resolve
              to, because it follows the progress slider instead of staying put. */}
          <button
            type="button"
            class={pinned ? 'module-option' : 'module-option is-chosen'}
            role="option"
            aria-selected={!pinned}
            title={`Whichever ${category.human} module suits how far through the game you are`}
            onClick={() => choose(undefined)}
          >
            <span class="module-icon" aria-hidden="true" />
            <span class="module-option-effect">—</span>
            <span class="module-option-name">auto</span>
          </button>
          {modules.map(({ id, module }) => (
            <button
              key={id}
              type="button"
              class={pinned && id === chosen ? 'module-option is-chosen' : 'module-option'}
              role="option"
              aria-selected={pinned && id === chosen}
              title={`${id}: ${effectSummary(category, module)}`}
              onClick={() => choose(id)}
            >
              <span
                class="module-icon"
                style={resourceIconStyle(`item:${id}`)}
                aria-hidden="true"
              />
              <span class="module-option-effect">{percent(headlineEffect(category, module))}</span>
              <span class="module-option-name">{moduleName(id)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One picker per family of modules the dataset has — speed, productivity, agricultural. Which tier
 * you would use is a fact about the save rather than about any one machine, so it belongs in the
 * header beside the progress slider it defaults from, not repeated down every cell.
 */
export function ModuleBar({
  modules: [chosen, setChosen],
  progress,
}: {
  modules: State<ModuleChoice>;
  progress: number;
}) {
  return (
    <div class="module-bar">
      {moduleCategories.map((category) => {
        const modules = modulesIn(category.id);
        const picked = chosen[category.id];
        return (
          <ModulePicker
            key={category.id}
            category={category}
            modules={modules}
            chosen={picked ?? defaultModule(modules, progress)?.id}
            pinned={!!picked}
            onChoose={(id) =>
              setChosen((prev) => {
                // "auto" is the absence of a choice, so choosing it takes the key back out rather
                // than storing anything — one less thing in the URL, and one less thing to mean.
                const next = { ...prev };
                if (id) next[category.id] = id;
                else delete next[category.id];
                return next;
              })
            }
          />
        );
      })}
    </div>
  );
}
