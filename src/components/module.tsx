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
 * What "none" looks like: the family's cheapest module with its lights off.
 *
 * An empty icon box would do the layout's job — "none" has to be the same width as a tier, or
 * picking it shifts every picker to its right along the header — but not the picker's, which is
 * that the three families read as three families whichever of them is set to nothing. Bob's module
 * artwork states the tier as how many of the case's lights are lit, so an unlit case is the icon
 * this wants and the game does not draw; {@link UnlitFilter} is how we get one without drawing it
 * either.
 */
export function UnlitIcon({ modules, class: box }: { modules: ModuleMatch[]; class: string }) {
  const cheapest = modules[0];
  return (
    <span
      class={`${box} is-unlit`}
      style={cheapest ? resourceIconStyle(`item:${cheapest.id}`) : undefined}
      aria-hidden="true"
    />
  );
}

/**
 * The lights out, as a filter: `.is-unlit` is `filter: url(#module-unlit)` and this is the `#`.
 *
 * It has to be an SVG filter rather than the `filter` shorthand's own functions, and the reason is
 * worth writing down because desaturating is the obvious thing to try and it does not work. Every
 * shorthand function — `grayscale`, `saturate`, `brightness`, `contrast` — is monotonic in
 * lightness, so whatever it does to the icon, the lit gem stays the brightest thing in it and goes
 * on reading as lit; `grayscale(1)` is worse than the original, a glaring white dot on a grey case.
 * "Unlit" is specifically *not* monotonic: the top of the range has to come back *down*, so that
 * the gem ends up no brighter than the case around it.
 *
 * So: measure the luminance, turn that into a gain — 1 up to the middle of the range, falling to
 * 0.3 at white — and multiply the icon by it. What that leaves alone is the point of doing it this
 * way round: gain is one number per pixel applied to all three channels, so hue and saturation come
 * through untouched and a speed module with its lights off is still unmistakably the blue one.
 * Rolling each channel down separately is a good deal simpler and does not survive contact with the
 * artwork — it hue-shifts the saturated pixels, and Angel's yellow case comes out edged in blue.
 *
 * The numbers are picked by eye against the artwork, so `sRGB` rather than the filter default of
 * linear light, and the `1` in the matrix's alpha row is what makes the gain map opaque: it is
 * multiplied in premultiplied space, where an alpha of its own would eat the icon's edges.
 */
export function UnlitFilter() {
  const rolldown = '1 1 0.95 0.7 0.42 0.3';
  return (
    <svg class="module-defs" width={0} height={0} aria-hidden="true" focusable="false">
      <filter id="module-unlit" color-interpolation-filters="sRGB">
        <feColorMatrix
          type="matrix"
          result="gain"
          values="0.2126 0.7152 0.0722 0 0
                  0.2126 0.7152 0.0722 0 0
                  0.2126 0.7152 0.0722 0 0
                  0      0      0      0 1"
        />
        <feComponentTransfer in="gain" result="gain">
          <feFuncR type="table" tableValues={rolldown} />
          <feFuncG type="table" tableValues={rolldown} />
          <feFuncB type="table" tableValues={rolldown} />
        </feComponentTransfer>
        <feComposite
          in="SourceGraphic"
          in2="gain"
          operator="arithmetic"
          k1="1"
          k2="0"
          k3="0"
          k4="0"
        />
      </filter>
    </svg>
  );
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
    </div>
  );
}
