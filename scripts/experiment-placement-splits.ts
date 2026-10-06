import { readFile, writeFile } from 'node:fs/promises';
import loadHighs from 'highs';
import { solveSplits, scoreSplit, type SplitProblem } from './placement-milp.ts';
import { processingUnitProblem } from './placement-milp-example.ts';
import { fixedSplitBaseline } from './placement-split-baselines.ts';

// node scripts/experiment-placement-splits.ts [problem.json | -] [report.json]
const problem: SplitProblem =
  process.argv[2] && process.argv[2] !== '-'
    ? JSON.parse(await readFile(process.argv[2], 'utf8'))
    : processingUnitProblem;
const highs = await loadHighs();
const baselines = [false, true].map((balanced) => {
  const candidate = fixedSplitBaseline(problem, balanced);
  return {
    name: balanced ? 'balanced fixed split' : 'capacity-first fixed split',
    candidate,
    scored: scoreSplit(problem, candidate),
  };
});
console.table(
  baselines.map(({ name, scored }) => ({ name, score: scored.score, ...scored.metrics })),
);
const cases = [
  { name: '75-building baseline', extraSlots: 0, maxExtraBuildings: 0 },
  { name: 'soft building budget', extraSlots: 0, maxExtraBuildings: 6 },
  { name: 'more split opportunities', extraSlots: 1, maxExtraBuildings: 6 },
  {
    name: 'strong adjacency',
    extraSlots: 1,
    maxExtraBuildings: 6,
    weights: { exclusiveOutput: 20, exclusiveInput: 10, mutual: 5 },
  },
  { name: '30-item belts', extraSlots: 1, maxExtraBuildings: 6, beltCapacity: 30 },
  {
    name: 'cheaper extra buildings',
    extraSlots: 1,
    maxExtraBuildings: 6,
    weights: { extraBuilding: 5, exclusiveOutput: 12 },
  },
];
const results = cases.map(({ name, ...options }) => {
  console.log(`Solving ${name}...`);
  const result = solveSplits(highs, problem, { ...options, timeLimit: 10 });
  console.log(
    JSON.stringify(
      { name, ...result.diagnostics, ...result.scored?.metrics, score: result.scored?.score },
      null,
      2,
    ),
  );
  if (result.candidate)
    console.table(
      result.candidate.placements.map((placement) => ({
        id: placement.id,
        recipe: placement.recipe,
        workload: +placement.workload.toFixed(6),
        buildings: placement.buildings,
        capacity: placement.layout.capacity,
      })),
    );
  return {
    name,
    options,
    ...result,
    commonScore: result.candidate ? scoreSplit(problem, result.candidate) : undefined,
  };
});
console.log('All alternatives rescored at 60 items/s with the default weights:');
console.table(
  [
    ...baselines.map(({ name, scored }) => ({ name, score: scored.score, ...scored.metrics })),
    ...results
      .filter((result) => result.commonScore)
      .map(({ name, commonScore }) => ({
        name,
        score: commonScore!.score,
        ...commonScore!.metrics,
      })),
  ].map(({ name, score, buildings, placements, connections, internalBelts, exclusiveOutputs }) => ({
    name,
    score,
    buildings,
    placements,
    connections,
    internalBelts,
    exclusiveOutputs,
  })),
);
if (process.argv[3])
  await writeFile(process.argv[3], `${JSON.stringify({ problem, baselines, results }, null, 2)}\n`);
