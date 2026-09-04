# Styling and responsive layouts

The app uses plain global CSS. Component styles live beside their TSX files and use prefixed class
names; `src/index.css` owns only document-wide values, while `src/app.css` owns the application
shell. Vite combines those files, so selectors are not scoped even though the files are organised
by component.

## Breakpoints

There are four supported viewport layouts. The media-query thresholds are CSS pixels and describe
available layout space; browser zoom and device pixel density therefore participate naturally.

| Viewport width | Cell layout | Application shell | Scale |
| --- | --- | --- | --- |
| up to 800px | one column | resource and recipe lists stack | 16px root |
| 801–1400px | two columns | resource and recipe lists sit side by side | 16px through 1024px, then 18px |
| 1401–1599px | three columns | resource and recipe lists sit side by side | 18px root |
| 1600px and up | three columns | resource and recipe lists sit side by side | fluid, up to 1.5× |

The structural breakpoints are implemented where the structures live:

- `src/app.css` stacks `.columns` at `max-width: 800px`.
- `src/components/cell/box.css` changes `.cell-body` at `1400px` and `800px`.
- `src/index.css` changes the root type scale below `1024px` and above `1600px`.

Do not duplicate these queries in JavaScript. The markup and behavior stay the same at every size;
CSS changes only flow, tracks, sizing, borders, and spacing.

## One-column layout: up to 800px

This is the narrow-screen layout. The resource list and recipe list form one vertical stream. A
cell also becomes one column in the order inputs, outputs, then work. Keeping the two interface
sides together before the recipe rows makes the cell readable as a summary followed by its detail.

The header is allowed to wrap rather than gaining a separate mobile component. Controls must remain
usable without horizontal page scrolling. New fixed-width controls should be avoided here; prefer
`min-width: 0`, wrapping, and widths bounded by the viewport.

The root font is 16px at widths up to 1024px. Typography and sprite icons use `rem`, so they shrink
together without a second set of component overrides.

## Two-column layout: 801px to 1400px

The application shell has its normal two search columns: a 24rem resource list and a flexible
recipe list capped at 32rem. Cells use two columns. Inputs and outputs share the narrower left
column, stacked vertically, while recipe work keeps the wider right column across both rows.

This layout exists to protect the recipe rows and their machine/module controls before there is
enough room for both interface sides. Additions to a row should wrap within the work column rather
than forcing the cell back to three columns or widening the page.

## Three-column layout: 1401px to 1599px

Cells show their intended Sankey-like shape: inputs on the left, recipe work in the wider middle,
and outputs on the right. The tracks are `minmax(9rem, 1fr) minmax(0, 2.5fr) minmax(9rem, 1fr)`.
The middle column owns the vertical separators and must retain `min-width: 0` so long recipe content
can truncate or wrap without expanding the grid.

Changes should preserve the visual direction from inputs through work to outputs. Side content may
wrap internally, but should not reorder or compete with the middle column for primary width.

## Three-column layout with scaling: 1600px and up

The structure is the same as the three-column layout. Instead of introducing a fourth arrangement,
the root font grows fluidly from 18px at 1600px to 27px at 2560px and is capped there:

```css
font-size: clamp(18px, calc(0.9375vw + 3px), 27px);
```

This makes `rem` typography, icons, controls, and rem-based tracks reach 1.5× together. Sprite-sheet
coordinates and sheet dimensions are emitted in `rem` by `src/components/icon.tsx`, so the artwork
itself grows with its box instead of leaving a larger box around a 32px image.

Use `rem` for font sizes and dimensions which should participate in this scaling. Keep thin details
such as borders in `px`; use viewport media queries for structural changes rather than
trying to reproduce full-page zoom. A new component should look unchanged at an 18px root and grow
coherently at 2560px without its text, icon, or control becoming misaligned.

## Component-width fallback

Recipe-row controls also have a container query in `src/components/cell/row.css`. `.cell-middle` is
an inline-size container, and at 650px or narrower its machine, module, and remove controls move to
a second line. This is intentionally independent of the viewport: a middle column can become narrow
because of its parent layout, not only because the window crossed a global breakpoint.

Prefer a container query when a component's own available width determines whether it fits. Prefer
the shared viewport breakpoints when the relationship between major page or cell columns changes.

## Review expectations

For layout or sizing changes, inspect at 800/801px, 1400/1401px, 1600px, and 2560px, plus a width
where the cell-middle container crosses 650px. Check for horizontal overflow, wrapping controls,
truncated names, aligned connection-table numbers, and sprite icons whose crop or scale differs from
their box. Run the normal test, build, and lint commands after implementation.
