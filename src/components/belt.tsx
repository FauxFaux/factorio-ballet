import { beltName, defaultBelt, type BeltChoice } from '../data/index.ts';
import { useDataset } from '../dataset/context.tsx';
import { useMenu } from './menu.ts';
import { fmt, type State } from '../ts.ts';
import type { Belt, BeltId, StaticData } from '../types.ts';
import { resourceIconStyle } from './icon.tsx';
import type { IconMap } from '../data/icon-map.ts';

/**
 * The belt tier a future throughput check will use. Like the module and beacon controls, this is a
 * save-wide preference: auto follows progress, while a pinned tier stays put.
 */
export function BeltPicker({
  belt: [choice, setChoice],
  progress,
}: {
  belt: State<BeltChoice>;
  progress: number;
}) {
  const ds = useDataset();
  const { data, beltTiers, iconMap } = ds;
  const { open, setOpen, box } = useMenu();

  if (beltTiers.length === 0) return null;

  const pinned = choice !== undefined;
  const current = pinned ? beltTiers.find(({ id }) => id === choice)! : defaultBelt(ds, progress);
  const what = current ? `${beltName(data, current.id)}: ${rate(current.belt)}` : 'No belts';
  const label = pinned ? what : `${what}, by default for this progress`;
  const choose = (id: BeltChoice) => {
    setChoice(id);
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
        <span
          class="module-icon"
          style={beltIconStyle(iconMap, current.id, data)}
          aria-hidden="true"
        />
        <span class="module-effect">{rate(current.belt)}</span>
        <span class="module-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div class="module-menu" role="listbox" aria-label="Belt">
          <button
            type="button"
            class={pinned ? 'module-option' : 'module-option is-chosen'}
            role="option"
            aria-selected={!pinned}
            title="Whichever belt you could have built by now"
            onClick={() => choose(undefined)}
          >
            <span class="module-icon" aria-hidden="true" />
            <span class="module-option-effect">—</span>
            <span class="module-option-name">auto</span>
          </button>
          {beltTiers.map(({ id, belt }) => (
            <button
              key={id}
              type="button"
              class={
                choice === id
                  ? 'module-option is-chosen'
                  : !pinned && current.id === id
                    ? 'module-option is-default'
                    : 'module-option'
              }
              role="option"
              aria-selected={choice === id}
              title={`${id}: ${rateSummary(belt)}`}
              onClick={() => choose(id)}
            >
              <span
                class="module-icon"
                style={beltIconStyle(iconMap, id, data)}
                aria-hidden="true"
              />
              <span class="module-option-effect">{rate(belt)}</span>
              <span class="module-option-name">{beltName(data, id)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const rate = (belt: Belt): string => `${fmt(belt.itemsPerSecond)}/s`;

function rateSummary(belt: Belt): string {
  return `${fmt(belt.itemsPerSecond)} items per second, both lanes fully compressed`;
}

function beltIconStyle(iconMap: IconMap, id: BeltId, data: StaticData): string {
  return resourceIconStyle(iconMap, `item:${data.belts[id]?.item ?? id}`);
}
