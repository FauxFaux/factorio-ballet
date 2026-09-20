import './design-card.css';
import type { KernelProblem, ResourceRates } from '../../kernel-problems.ts';
import { CARBON_LIGHT_SHORT } from '../../data/colours.ts';
import { generateAssemblerDesign, type AssemblerDesignThroughput } from '../../assembler-design.ts';
import { GenericFluidIcon, GenericSolidIcon } from '../icon.tsx';
import { HelpInfo } from '../help-info.tsx';
import { DesignPreview } from './design-preview.tsx';
import type { DesignSceneItems, DesignSceneRecipes } from './design-scene.tsx';
import type { ResourceId } from '../../types.ts';
import type { DesignColumn } from '../../design.ts';
import { beltInputItemTraces, beltItemLaneCounts, beltItemTraces } from './design-belt-traces.ts';

/** A read-only summary of one kernel problem and its proposed factory design. */
export function DesignCard({
  index,
  problem,
  throughput,
}: {
  index: number;
  problem: KernelProblem;
  throughput: AssemblerDesignThroughput;
}) {
  const title = problem.name;
  const resourceColours = resourceColoursFor(problem);
  const design = generateAssemblerDesign(problem, throughput);
  const { recipes, items } = designSceneFlows(problem, resourceColours);
  const stackLimit = design
    ? beltStackLimit(design.columns[0], recipes, problem, throughput.beltItemsPerSecond)
    : undefined;

  return (
    <article class="design-card" aria-labelledby={`design-card-title-${index}`}>
      <aside class="design-card-description" aria-label={`${title} description`}>
        <h3 id={`design-card-title-${index}`}>{title}</h3>
        <FlowSummary
          inputs={problem.inputs}
          outputs={problem.outputs}
          resourceColours={resourceColours}
        />
        {stackLimit !== undefined && (
          <dl class="design-card-stack-limit" aria-label="Max column height">
            <dt>
              <HelpInfo label="About maximum column height">
                The number of times you could stack this blueprint (kernel) on top of itself,
                without running out of belt throughput on the allocated belts.
                </HelpInfo>
              Max column height
            </dt>
            <dd>×{stackLimit}</dd>
          </dl>
        )}
      </aside>
      <div class="design-card-grid">
        {design ? (
          <DesignPreview
            column={design.columns[0]}
            label={`${title} preview`}
            recipes={recipes}
            items={items}
          />
        ) : (
          <span class="design-card-no-solution">[no solution]</span>
        )}
      </div>
    </article>
  );
}

function FlowSummary({
  inputs,
  outputs,
  resourceColours,
}: Pick<KernelProblem, 'inputs' | 'outputs'> & { resourceColours: ResourceColours }) {
  return (
    <section class="design-card-flow" aria-label="Problem inputs and outputs">
      <RateSummary
        rates={{ ...inputs.solids, ...inputs.fluids }}
        resourceColours={resourceColours}
      />
      <span class="design-card-flow-arrow" aria-hidden="true">
        →
      </span>
      <RateSummary
        rates={{ ...outputs.solids, ...outputs.fluids }}
        resourceColours={resourceColours}
      />
    </section>
  );
}

type ResourceColours = Record<string, string>;

function RateSummary({
  rates,
  resourceColours,
}: {
  rates: ResourceRates;
  resourceColours: ResourceColours;
}) {
  const entries = Object.entries(rates);
  if (entries.length === 0) return <span>none</span>;

  return (
    <span class="design-card-rate-summary">
      {entries.map(([resource, rate], index) => (
        <span class="design-card-rate" key={resource} aria-label={`${rate} ${resource}`}>
          {index > 0 && <span class="design-card-rate-plus">+</span>}
          <span>{rate}</span>
          <ResourceIcon resource={resource} color={resourceColours[resource]} />
        </span>
      ))}
    </span>
  );
}

function ResourceIcon({ resource, color }: { resource: string; color: string }) {
  const Icon = resource.startsWith('fluid ') ? GenericFluidIcon : GenericSolidIcon;

  return (
    <span class="design-card-rate-icon" title={resource}>
      <Icon color={color} />
    </span>
  );
}

function resourceColoursFor(problem: KernelProblem): ResourceColours {
  const resourceNames = [
    ...Object.keys(problem.inputs.solids),
    ...Object.keys(problem.inputs.fluids),
    ...Object.keys(problem.outputs.solids),
    ...Object.keys(problem.outputs.fluids),
    ...problem.assemblers.flatMap((assembler) => [
      ...Object.keys(assembler.inputPerSecond),
      ...Object.keys(assembler.outputPerSecond),
    ]),
  ];
  const palette = Object.values(CARBON_LIGHT_SHORT);

  return Object.fromEntries(
    [...new Set(resourceNames)].map((resource, index) => [
      resource,
      palette[index % palette.length],
    ]),
  );
}

function designSceneFlows(
  problem: KernelProblem,
  colours: ResourceColours,
): { recipes: DesignSceneRecipes; items: DesignSceneItems } {
  const itemId = (name: string): ResourceId => `item:${name}`;
  const recipes = Object.fromEntries(
    problem.assemblers.map((assembler) => [
      assembler.name,
      {
        ingredients: Object.keys(assembler.inputPerSecond)
          .filter((name) => name.startsWith('item '))
          .map((name) => ({ resource: itemId(name) })),
        products: Object.keys(assembler.outputPerSecond)
          .filter((name) => name.startsWith('item '))
          .map((name) => ({ resource: itemId(name) })),
      },
    ]),
  );
  const rates = Object.assign(
    {},
    ...problem.assemblers.map((assembler) => ({
      ...assembler.inputPerSecond,
      ...assembler.outputPerSecond,
    })),
  ) as ResourceRates;
  const items = Object.fromEntries(
    Object.entries(rates)
      .filter(([name]) => name.startsWith('item '))
      .map(([name, rate]) => [itemId(name), { name, rate, colour: colours[name] }]),
  );
  return { recipes, items };
}

function beltStackLimit(
  column: DesignColumn,
  recipes: DesignSceneRecipes,
  problem: KernelProblem,
  beltItemsPerSecond: number,
): number | undefined {
  const inputLanes = beltItemLaneCounts(column, recipes, beltInputItemTraces(column, recipes));
  const outputLanes = beltItemLaneCounts(column, recipes, beltItemTraces(column, recipes, true));
  const laneItemsPerSecond = beltItemsPerSecond / 2;
  const limits = [
    ...sideStackLimits(problem.inputs.solids, inputLanes, laneItemsPerSecond),
    ...sideStackLimits(problem.outputs.solids, outputLanes, laneItemsPerSecond),
  ];
  return limits.length > 0 ? Math.floor(Math.min(...limits)) : undefined;
}

function sideStackLimits(
  rates: ResourceRates,
  laneCounts: ReadonlyMap<ResourceId, number>,
  laneItemsPerSecond: number,
): number[] {
  return Object.entries(rates).map(([resource, rate]) => {
    const lanes = laneCounts.get(`item:${resource}`) ?? 0;
    return (lanes * laneItemsPerSecond) / rate;
  });
}
