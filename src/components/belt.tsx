import { beltName, beltTiers, defaultBelt, staticData, type BeltChoice } from '../data.ts';
import { useMenu } from './menu.ts';
import { fmt, type State } from '../ts.ts';
import type { Belt, BeltId } from '../types.ts';
import { resourceIconStyle } from './icon.tsx';

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
  const { open, setOpen, box } = useMenu();

  if (beltTiers.length === 0) return null;

  const pinned = choice !== undefined;
  const current = pinned ? beltTiers.find(({ id }) => id === choice) : defaultBelt(progress);
  const what = current ? `${beltName(current.id)}: ${rate(current.belt)}` : 'No belts';
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
        {current ? (
          <>
            <span class="module-icon" style={beltIconStyle(current.id)} aria-hidden="true" />
            <span class="module-effect">{rate(current.belt)}</span>
          </>
        ) : (
          <>
            <UnlitBelt class="module-icon" />
            <span class="module-effect">—</span>
          </>
        )}
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
          <button
            type="button"
            class={choice === null ? 'module-option is-chosen' : 'module-option'}
            role="option"
            aria-selected={choice === null}
            title="No belt, whatever the progress"
            onClick={() => choose(null)}
          >
            <UnlitBelt class="module-icon" />
            <span class="module-option-effect">—</span>
            <span class="module-option-name">none</span>
          </button>
          {beltTiers.map(({ id, belt }) => (
            <button
              key={id}
              type="button"
              class={choice === id ? 'module-option is-chosen' : 'module-option'}
              role="option"
              aria-selected={choice === id}
              title={`${id}: ${rateSummary(belt)}`}
              onClick={() => choose(id)}
            >
              <span class="module-icon" style={beltIconStyle(id)} aria-hidden="true" />
              <span class="module-option-effect">{rate(belt)}</span>
              <span class="module-option-name">{beltName(id)}</span>
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

function beltIconStyle(id: BeltId): string {
  return resourceIconStyle(`item:${staticData.belts[id]?.item ?? id}`);
}

function UnlitBelt({ class: box }: { class: string }) {
  const cheapest = beltTiers[0];
  return (
    <span
      class={`${box} is-unlit`}
      style={cheapest ? beltIconStyle(cheapest.id) : undefined}
      aria-hidden="true"
    />
  );
}
