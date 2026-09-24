import type { CellEntry } from '../cell.ts';
import { recipeName, resourceName } from '../data';
import type { Solution } from '../solve';
import { isFluid, type Belt, type ResourceId } from '../types.ts';

const EPSILON = 1e-7;

export interface SplitBoundary {
  resources: number;
  routes: number;
}

export interface ProposedSplitGroup {
  id: string;
  name: string;
  entries: number[];
  installedMachines: number;
  inputs: SplitBoundary;
  outputs: SplitBoundary;
}

export interface SplitRatio {
  producer: string;
  producerMachines: number;
  consumer: string;
  consumerMachines: number;
}

export interface ProposedSplit {
  id: string;
  name: string;
  reason: string;
  groups: ProposedSplitGroup[];
  ratios: SplitRatio[];
}

interface CandidateGroup {
  entries: number[];
  name: string;
}

function totalRates(rates: Map<ResourceId, number>[], counts: (number | undefined)[]) {
  const totals = new Map<ResourceId, number>();
  for (let index = 0; index < rates.length; index++) {
    const count = counts[index];
    if (count === undefined) continue;
    for (const [resource, rate] of rates[index]!) {
      totals.set(resource, (totals.get(resource) ?? 0) + rate * count);
    }
  }
  return totals;
}

function ratesForEntries(
  rates: Map<ResourceId, number>[],
  counts: (number | undefined)[],
  entries: number[],
) {
  return totalRates(
    entries.map((entry) => rates[entry]!),
    entries.map((entry) => counts[entry]),
  );
}

function routeCount(resource: ResourceId, rate: number, belt: Belt) {
  if (isFluid(resource)) return 1;
  return Math.ceil(Math.max(0, rate - EPSILON) / belt.itemsPerSecond);
}

function boundaryOf(entries: number[], solution: Solution, belt: Belt) {
  const rates = ratesForEntries(solution.rates, solution.counts, entries);
  const inputs: SplitBoundary = { resources: 0, routes: 0 };
  const outputs: SplitBoundary = { resources: 0, routes: 0 };
  for (const [resource, rate] of rates) {
    if (Math.abs(rate) <= EPSILON) continue;
    const boundary = rate < 0 ? inputs : outputs;
    boundary.resources += 1;
    boundary.routes += routeCount(resource, Math.abs(rate), belt);
  }
  return { inputs, outputs };
}

function installedMachines(entries: number[], counts: (number | undefined)[]) {
  return entries.reduce((total, entry) => total + Math.ceil(counts[entry]! - EPSILON), 0);
}

function sharesFlow(left: number, right: number, solution: Solution) {
  for (const resource of solution.outputRates[left]!.keys()) {
    if (solution.inputRates[right]!.has(resource)) return true;
  }
  for (const resource of solution.outputRates[right]!.keys()) {
    if (solution.inputRates[left]!.has(resource)) return true;
  }
  return false;
}

function isConnected(entries: number[], solution: Solution) {
  const visited = new Set([entries[0]!]);
  while (visited.size < entries.length) {
    const next = entries.find(
      (entry) =>
        !visited.has(entry) && [...visited].some((seen) => sharesFlow(entry, seen, solution)),
    );
    if (next === undefined) return false;
    visited.add(next);
  }
  return true;
}

function utilityGroup(solution: Solution, belt: Belt): CandidateGroup | undefined {
  const entryCount = solution.counts.length;
  if (entryCount > 15) return undefined;
  let best: { entries: number[]; installed: number; output: ResourceId } | undefined;

  for (let mask = 1; mask < 2 ** entryCount - 1; mask++) {
    const entries = Array.from({ length: entryCount }, (_, index) => index).filter(
      (index) => mask & (1 << index),
    );
    if (entries.length < 2 || !isConnected(entries, solution)) continue;
    const installed = installedMachines(entries, solution.counts);
    if (installed > 32) continue;
    const boundary = boundaryOf(entries, solution, belt);
    if (boundary.inputs.resources !== 0 || boundary.outputs.resources !== 1) continue;
    const output = [...ratesForEntries(solution.rates, solution.counts, entries)].find(
      ([, rate]) => rate > EPSILON,
    )?.[0];
    if (!output) continue;
    if (
      !best ||
      installed < best.installed ||
      (installed === best.installed && entries.length > best.entries.length)
    ) {
      best = { entries, installed, output };
    }
  }

  return best ? { entries: best.entries, name: `${resourceName(best.output)} utility` } : undefined;
}

function terminalGroup(
  entries: CellEntry[],
  solution: Solution,
  excluded: ReadonlySet<number>,
): { group: CandidateGroup; terminal: number; producers: number[] } | undefined {
  const consumed = totalRates(solution.inputRates, solution.counts);
  const produced = totalRates(solution.outputRates, solution.counts);
  let terminal: number | undefined;
  let terminalRate = 0;
  for (let index = 0; index < entries.length; index++) {
    if (excluded.has(index)) continue;
    for (const [resource, rate] of solution.outputRates[index]!) {
      const external = (produced.get(resource) ?? 0) - (consumed.get(resource) ?? 0);
      const entryRate = rate * solution.counts[index]!;
      if (external > EPSILON && entryRate > terminalRate + EPSILON) {
        terminal = index;
        terminalRate = entryRate;
      }
    }
  }
  if (terminal === undefined) return undefined;

  const producers = entries
    .map((_, index) => index)
    .filter(
      (index) =>
        index !== terminal &&
        !excluded.has(index) &&
        [...solution.outputRates[index]!.keys()].some((resource) =>
          solution.inputRates[terminal]!.has(resource),
        ),
    );
  if (producers.length === 0 || producers.length > 4) return undefined;
  const members = [...producers, terminal];
  if (installedMachines(members, solution.counts) > 128) return undefined;
  return {
    group: {
      entries: members,
      name: `${recipeName(entries[terminal]!.recipe)} finishing`,
    },
    terminal,
    producers,
  };
}

function productionName(entries: number[], solution: Solution) {
  const outputs = [...ratesForEntries(solution.rates, solution.counts, entries)].filter(
    ([, rate]) => rate > EPSILON,
  );
  return outputs.length === 1
    ? `${resourceName(outputs[0]![0])} production`
    : 'Intermediate production';
}

function sharedImportGroup(
  entries: CellEntry[],
  solution: Solution,
  excluded: ReadonlySet<number>,
): CandidateGroup | undefined {
  const produced = totalRates(solution.outputRates, solution.counts);
  const consumers = new Map<ResourceId, number[]>();
  for (let index = 0; index < entries.length; index++) {
    if (excluded.has(index)) continue;
    for (const resource of solution.inputRates[index]!.keys()) {
      if ((produced.get(resource) ?? 0) > EPSILON) continue;
      const found = consumers.get(resource) ?? [];
      found.push(index);
      consumers.set(resource, found);
    }
  }

  return [...consumers]
    .filter(([, members]) => members.length >= 2 && members.length <= 4)
    .map(([resource, members]) => ({
      entries: members,
      name: `${resourceName(resource)} conversion`,
      installed: installedMachines(members, solution.counts),
    }))
    .filter(({ installed }) => installed <= 16)
    .sort((left, right) => left.installed - right.installed || left.name.localeCompare(right.name))
    .map(({ entries: members, name }) => ({ entries: members, name }))[0];
}

function gcd(left: number, right: number): number {
  return right === 0 ? left : gcd(right, left % right);
}

function smallRatio(producer: number, consumer: number) {
  const ratio = producer / consumer;
  for (let denominator = 1; denominator <= 12; denominator++) {
    const numerator = Math.round(ratio * denominator);
    if (numerator === 0 || Math.abs(numerator / denominator - ratio) > 1e-7) continue;
    const divisor = gcd(numerator, denominator);
    return [numerator / divisor, denominator / divisor] as const;
  }
  return undefined;
}

function ratiosFor(
  entries: CellEntry[],
  solution: Solution,
  terminal: number,
  producers: number[],
): SplitRatio[] {
  return producers.flatMap((producer) => {
    const ratio = smallRatio(solution.counts[producer]!, solution.counts[terminal]!);
    return ratio
      ? [
          {
            producer: recipeName(entries[producer]!.recipe),
            producerMachines: ratio[0],
            consumer: recipeName(entries[terminal]!.recipe),
            consumerMachines: ratio[1],
          },
        ]
      : [];
  });
}

function finishGroup(
  id: string,
  candidate: CandidateGroup,
  solution: Solution,
  belt: Belt,
): ProposedSplitGroup {
  const boundary = boundaryOf(candidate.entries, solution, belt);
  return {
    id,
    name: candidate.name,
    entries: candidate.entries,
    installedMachines: installedMachines(candidate.entries, solution.counts),
    ...boundary,
  };
}

function asPlan(
  id: string,
  name: string,
  reason: string,
  candidates: CandidateGroup[],
  solution: Solution,
  belt: Belt,
  ratios: SplitRatio[],
): ProposedSplit {
  return {
    id,
    name,
    reason,
    groups: candidates.map((candidate, index) =>
      finishGroup(`${id}-${index}`, candidate, solution, belt),
    ),
    ratios,
  };
}

/** Suggest compatible whole-cell partitions from the current solved rates. */
export function proposedSplits(
  entries: CellEntry[],
  solution: Solution,
  belt: Belt,
): ProposedSplit[] {
  if (
    entries.length < 4 ||
    !solution.complete ||
    solution.counts.some((count) => count === undefined || !Number.isFinite(count) || count <= 0)
  ) {
    return [];
  }

  const utility = utilityGroup(solution, belt);
  const utilityEntries = new Set(utility?.entries ?? []);
  const terminal = terminalGroup(entries, solution, utilityEntries);
  if (!terminal) return [];

  const claimed = new Set([...utilityEntries, ...terminal.group.entries]);
  const upstreamEntries = entries.map((_, index) => index).filter((index) => !claimed.has(index));
  if (upstreamEntries.length === 0) return [];
  const ratios = ratiosFor(entries, solution, terminal.terminal, terminal.producers);
  const plans: ProposedSplit[] = [];
  const coarse = [
    ...(utility ? [utility] : []),
    { entries: upstreamEntries, name: 'Preparation' },
    terminal.group,
  ];
  plans.push(
    asPlan(
      'three-regions',
      `${coarse.length} regions`,
      'Keeps direct inputs beside final production and leaves preparation as one region.',
      coarse,
      solution,
      belt,
      ratios,
    ),
  );

  const hub = sharedImportGroup(entries, solution, claimed);
  if (hub) {
    const hubEntries = new Set(hub.entries);
    const remaining = upstreamEntries.filter((entry) => !hubEntries.has(entry));
    if (remaining.length > 0) {
      plans.push(
        asPlan(
          'transport-first',
          `${coarse.length + 1} units`,
          'Separates the small shared-input conversion hub from the remaining production stack.',
          [
            ...(utility ? [utility] : []),
            hub,
            { entries: remaining, name: productionName(remaining, solution) },
            terminal.group,
          ],
          solution,
          belt,
          ratios,
        ),
      );
    }
  }

  return plans;
}
