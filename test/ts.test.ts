import { describe, expect, it } from 'vitest';
import { decimalPlacesForSignificantFigures } from '../src/ts.ts';

describe('decimalPlacesForSignificantFigures', () => {
  it('finds the fixed precision needed for a magnitude', () => {
    expect(decimalPlacesForSignificantFigures(1268, 3)).toBe(0);
    expect(decimalPlacesForSignificantFigures(31.74, 3)).toBe(1);
    expect(decimalPlacesForSignificantFigures(0.03174, 3)).toBe(4);
  });

  it('does not ask for decimal places for zero', () => {
    expect(decimalPlacesForSignificantFigures(0, 3)).toBe(0);
  });
});
