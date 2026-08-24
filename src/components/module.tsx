import './module.css';
import {
  defaultModule,
  headlineEffect,
  moduleCategories,
  moduleName,
  modulesIn,
  type BeaconChoice,
  type ModuleCategory,
  type ModuleChoice,
  type ModuleMatch,
} from '../data.ts';
import { BeaconPicker } from './beacon.tsx';
import { useMenu } from './menu.ts';
import { fmt, type State } from '../ts.ts';
import type { Module, ModuleId } from '../types.ts';
import { resourceIconStyle } from './icon.tsx';
import { UnlitIcon } from './unlit-module-icon.tsx';

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
 * business, and this only says which tier is meant by "a speed module" — or that none of them is,
 * which is a choice a player who is not using the family makes once and keeps.
 */
export function ModulePicker({
  category,
  modules,
  choice,
  chosen,
  onChoose,
}: {
  category: ModuleCategory;
  modules: ModuleMatch[];
  /** What the user picked: a module, `null` for none, or absent for auto. */
  choice?: ModuleId | null;
  /** The module in use, whether that was chosen or defaulted; absent means none is. */
  chosen?: ModuleId;
  onChoose: (id: ModuleId | null | undefined) => void;
}) {
  const { open, setOpen, box } = useMenu();

  if (modules.length === 0) return null;

  const pinned = choice !== undefined;
  const current = chosen ? modules.find(({ id }) => id === chosen) : undefined;
  const what = current
    ? `${moduleName(current.id)}: ${effectSummary(category, current.module)}`
    : `No ${category.human} modules`;
  const label = pinned ? what : `${what}, by default for this progress`;

  const choose = (id: ModuleId | null | undefined) => {
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
          <>
            <UnlitIcon modules={modules} class="module-icon" />
            <span class="module-effect">—</span>
          </>
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
            title={`Whichever ${category.human} module you could have built by now`}
            onClick={() => choose(undefined)}
          >
            <span class="module-icon" aria-hidden="true" />
            <span class="module-option-effect">—</span>
            <span class="module-option-name">auto</span>
          </button>
          {/* What "auto" resolves to for the whole early game, and a real choice of its own after
              that: empty slots, whatever the slider says. */}
          <button
            type="button"
            class={choice === null ? 'module-option is-chosen' : 'module-option'}
            role="option"
            aria-selected={choice === null}
            title={`No ${category.human} modules, however far through the game you are`}
            onClick={() => choose(null)}
          >
            <UnlitIcon modules={modules} class="module-icon" />
            <span class="module-option-effect">—</span>
            <span class="module-option-name">none</span>
          </button>
          {modules.map(({ id, module }) => (
            <button
              key={id}
              type="button"
              class={choice === id ? 'module-option is-chosen' : 'module-option'}
              role="option"
              aria-selected={choice === id}
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
 * One picker per family of modules the dataset has — speed, productivity, agricultural — and, at the
 * end of them, the beacon the speed ones overflow into. Which tier you would use is a fact about the
 * save rather than about any one machine, so it belongs in the header beside the progress slider it
 * defaults from, not repeated down every cell; the beacon is the same kind of fact, so it is the
 * same kind of picker and sits in the same bar.
 */
export function ModuleBar({
  modules: [chosen, setChosen],
  beacon,
  progress,
}: {
  modules: State<ModuleChoice>;
  /** Which beacon a row builds when its speed modules overflow the machine; see `BeaconPicker`. */
  beacon: State<BeaconChoice>;
  progress: number;
}) {
  return (
    <div class="module-bar">
      {moduleCategories.map((category) => {
        const modules = modulesIn(category.id);
        const choice = category.id in chosen ? chosen[category.id] : undefined;
        return (
          <ModulePicker
            key={category.id}
            category={category}
            modules={modules}
            choice={choice}
            chosen={
              choice === undefined ? defaultModule(modules, progress)?.id : (choice ?? undefined)
            }
            onChoose={(id) =>
              setChosen((prev) => {
                // "auto" is the absence of a choice, so choosing it takes the key back out rather
                // than storing anything — one less thing in the URL, and one less thing to mean.
                // `null` is a choice, though, and the one it is is "none".
                const next = { ...prev };
                if (id === undefined) delete next[category.id];
                else next[category.id] = id;
                return next;
              })
            }
          />
        );
      })}
      <BeaconPicker beacon={beacon} progress={progress} />
    </div>
  );
}
