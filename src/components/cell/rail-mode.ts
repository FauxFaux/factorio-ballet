/** The documented rail brick can stack its input stations only when there are at least two. */
export function stackedRailStations(inputCount: number, outputCount: number): boolean {
  return inputCount >= 2 && inputCount + outputCount >= 6;
}
