import {
  LinearExpr,
  type BoolVar,
  type CpModel,
  type IntVar,
  type LinearExprLike,
} from 'or-tools-wasm/cp-sat';

interface Rectangle {
  x: IntVar;
  y: IntVar;
  w: IntVar;
  h: IntVar;
  right: IntVar;
  bottom: IntVar;
}

/** Choose one labelled geometry from each feasible rotation/reflection orbit. */
export function addBobPlacementSymmetry(
  model: CpModel,
  width: IntVar,
  height: IntVar,
  rectangles: Rectangle[],
  maxWidth: number,
  maxHeight: number,
  leftToRight: boolean,
) {
  const always = model.newBoolVar('symmetry:always');
  model.add(always.eq(1));
  const fits = (value: IntVar, bound: number, name: string) => {
    const flag = model.newBoolVar(name);
    model.add(value.le(bound)).onlyEnforceIf(flag);
    model.add(value.gt(bound)).onlyEnforceIf(flag.not());
    return flag;
  };
  const transposeFits = model.newBoolVar('symmetry:transpose-fits');
  const fitsWidth = fits(height, maxWidth, 'symmetry:fits-width');
  const fitsHeight = fits(width, maxHeight, 'symmetry:fits-height');
  model.addImplication(transposeFits, fitsWidth);
  model.addImplication(transposeFits, fitsHeight);
  model.addBoolOr([fitsWidth.not(), fitsHeight.not(), transposeFits]);
  const original = [width, height, ...rectangles.flatMap((r) => [r.x, r.y, r.w, r.h])];
  for (const transpose of [false, true]) {
    for (const flipX of [false, true]) {
      for (const flipY of [false, true]) {
        if (!transpose && !flipX && !flipY) continue;
        // Sources must stay on the left and sinks on the right.
        if (leftToRight && (transpose || flipX)) continue;
        const transformed: LinearExprLike[] = [
          transpose ? height : width,
          transpose ? width : height,
        ];
        for (const r of rectangles) {
          const x = flipX ? width.minus(r.right) : r.x;
          const y = flipY ? height.minus(r.bottom) : r.y;
          transformed.push(...(transpose ? [y, x, r.h, r.w] : [x, y, r.w, r.h]));
        }
        lexLessOrEqual(
          model,
          original,
          transformed,
          transpose ? transposeFits : always,
          `symmetry:${transpose}:${flipX}:${flipY}`,
        );
      }
    }
  }
}

/** Prefix equality makes the first unequal coordinate decide the ordering. */
function lexLessOrEqual(
  model: CpModel,
  left: LinearExprLike[],
  right: LinearExprLike[],
  guard: BoolVar,
  name: string,
) {
  let prefix = guard;
  for (let i = 0; i < left.length; i++) {
    const a = LinearExpr.from(left[i]);
    model.add(a.le(right[i])).onlyEnforceIf(prefix);
    if (i === left.length - 1) break;
    const equal = model.newBoolVar(`${name}:${i}:equal`);
    model.add(a.eq(right[i])).onlyEnforceIf(equal);
    model.add(a.ne(right[i])).onlyEnforceIf(equal.not());
    const next = model.newBoolVar(`${name}:${i}:prefix`);
    model.addImplication(next, prefix);
    model.addImplication(next, equal);
    model.addBoolOr([prefix.not(), equal.not(), next]);
    prefix = next;
  }
}
