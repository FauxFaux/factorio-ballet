import type { ModuleMatch } from '../data.ts';
import { resourceIconStyle } from './icon.tsx';

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
