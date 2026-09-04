import './progress-slider.css';
import { type Landmark, packLandmarks, resourceName } from '../data/index.ts';
import type { State } from '../ts.ts';
import { iconStyle } from './icon.tsx';

/**
 * How near, in whole percent, the slider has to be for it to be sitting *at* a pack. The kept packs
 * are at least `MIN_PACK_GAP` (4%) apart, so this cannot light two of them at once.
 */
const NEAR_PACK = 1.5;

/** How far the slider is from a pack, in the slider's own whole-percent units. */
const gap = (pack: Landmark, gp: number) => Math.abs(pack.complexity * 100 - gp);

/**
 * How far through the game you are, 0% at the crash site to 100% with the tree researched. Searches
 * sort by distance from it, so this is the difference between "show me the simplest thing that
 * makes iron plates" and "show me what I could be building right now".
 *
 * Labelled with science packs rather than numbers because that is the scale players actually have:
 * a save is "just past blue science", never "37%". They sit at their real `complexity`, which is
 * why they are unevenly spaced — the gaps are the tech tree's, not a design choice — and clicking
 * one jumps there, since naming the pack is easier than aiming at a percentage.
 */
export function ProgressSlider({ progress: [gp, setGp] }: { progress: State<number> }) {
  // The nearest pack, if the slider is close enough to be *at* it. Only marking the nearest one
  // unconditionally meant a box around white science while you were days of play short of it, which
  // reads as a claim rather than a marker. `undefined` also covers a regenerated dataset with no
  // research ingredients at all, which leaves the slider unlabelled rather than crashing it.
  const nearest = packLandmarks.reduce<Landmark | undefined>(
    (best, pack) => (!best || gap(pack, gp) < gap(best, gp) ? pack : best),
    undefined,
  );
  const at = nearest && gap(nearest, gp) <= NEAR_PACK ? nearest : undefined;
  // Failing that, the last pack you are definitely past — true wherever the slider is, where
  // "around <nearest>" would overclaim in exactly the way the box did.
  const passed = at ? undefined : packLandmarks.findLast((pack) => pack.complexity * 100 < gp);
  const era = at ? `at ${resourceName(at.id)}` : passed ? `past ${resourceName(passed.id)}` : '';

  return (
    <fieldset class="progress-slider">
      <legend>Overall game progress</legend>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={gp}
        aria-label="Game progress"
        // the number means nothing to anyone; the pack it lands on or past does
        aria-valuetext={era ? `${gp}%, ${era}` : `${gp}%`}
        onInput={(e) => setGp(Number((e.target as HTMLInputElement).value))}
      />
      <div class="progress-packs">
        {packLandmarks.map((pack) => {
          const name = resourceName(pack.id);
          const percent = Math.round(pack.complexity * 100);
          return (
            <button
              key={pack.id}
              type="button"
              class={`progress-pack${pack === at ? ' is-here' : ''}`}
              style={`left: ${pack.complexity * 100}%`}
              title={`${name} — ${percent}%`}
              aria-label={`Set progress to ${name}`}
              onClick={() => setGp(percent)}
            >
              <span class="progress-pack-icon" style={iconStyle(pack.id, 'item:item-unknown')} />
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
