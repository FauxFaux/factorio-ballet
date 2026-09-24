import './design-card.css';
import { useMemo } from 'preact/hooks';
import type { KernelProblem, ResourceRates } from '../../compute/kernel-problems.ts';
import { CARBON_LIGHT_SHORT } from '../../compute/colours.ts';
import {
  generateAssemblerDesign,
  isAssemblerDesignFailure,
  type AssemblerDesignThroughput,
} from '../../compute/assembler-design.ts';
import { GenericFluidIcon, GenericSolidIcon } from '../icon.tsx';
import { HelpInfo } from '../help-info.tsx';
import { DesignPreview } from './design-preview.tsx';
import type { DesignSceneItems, DesignSceneRecipes } from './design-scene.tsx';
import type { ResourceId } from '../../types.ts';
import { beltStackLimit } from './design-stack-limit.ts';
import { solveKernelTileDesign } from '../../compute/tile-design/kernel-result.ts';

/** A read-only summary of one kernel problem and its proposed factory design. */
export function DesignCard({
  index,
  problem,
  throughput,
  onUseProblem,
}: {
  index: number;
  problem: KernelProblem;
  throughput: AssemblerDesignThroughput;
  onUseProblem?: () => void;
}) {
  const title = problem.assemblers.map(({ name }) => name).join(', ');
  const resourceColours = resourceColoursFor(problem);
  const design = generateAssemblerDesign(problem, throughput);
  const tileResult = useMemo(
    () => solveKernelTileDesign(problem, throughput),
    [
      problem,
      throughput.beltItemsPerSecond,
      throughput.inserterItemsPerSecond,
      throughput.longInserterItemsPerSecond,
    ],
  );
  const { recipes, items } = designSceneFlows(problem, resourceColours);
  const machinesByRecipe = Object.fromEntries(
    problem.assemblers.flatMap((assembler, index) => [
      [assembler.name, assembler],
      [assembler.id ?? `machine-${index + 1}`, assembler],
    ]),
  );
  const stackLimit = isAssemblerDesignFailure(design)
    ? undefined
    : beltStackLimit(design.columns[0], recipes, problem, throughput.beltItemsPerSecond);

  return (
    <article class="design-card" aria-labelledby={`design-card-title-${index}`}>
      <aside class="design-card-description" aria-label={`${title} description`}>
        <h3 id={`design-card-title-${index}`}>{title}</h3>
        <FlowSummary
          inputs={problem.inputs}
          outputs={problem.outputs}
          resourceColours={resourceColours}
        />
        {onUseProblem && (
          <button type="button" class="design-card-use-problem" onClick={onUseProblem}>
            Use this problem
          </button>
        )}
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
        <section class="design-card-result" aria-label="Assembler design result">
          <h4>design v0</h4>
          {!isAssemblerDesignFailure(design) ? (
            <DesignPreview
              column={design.columns[0]}
              label={`${title} assembler design preview`}
              recipes={recipes}
              machinesByRecipe={machinesByRecipe}
              items={items}
            />
          ) : (
            <span class="design-card-no-solution" role="note">
              {design.failure.join(' ')}
            </span>
          )}
        </section>
        <section class="design-card-result design-card-result-v1" aria-label="Tile design result">
          <h4>design v1</h4>
          {'success' in tileResult ? (
            <span class="design-card-no-solution" role="note">
              {tileResult.message}
            </span>
          ) : tileResult.status === 'found' ? (
            <DesignPreview
              column={tileResult.candidate.column}
              lanes={tileResult.candidate.lanes}
              label={`${title} tile design preview`}
              recipes={recipes}
              machinesByRecipe={machinesByRecipe}
              items={items}
            />
          ) : (
            <span class="design-card-no-solution" role="note">
              {tileResult.reason}
            </span>
          )}
        </section>
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
  const Icon = resource.startsWith('fluid:') ? GenericFluidIcon : GenericSolidIcon;

  return (
    <span class="design-card-rate-icon" title={resource}>
      <Icon color={color} />
    </span>
  );
}

export function resourceColoursFor(problem: KernelProblem): ResourceColours {
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
  const resourceId = (name: string): ResourceId =>
    name.startsWith('fluid:') || name.startsWith('item:') ? (name as ResourceId) : `item:${name}`;
  const recipes = Object.fromEntries(
    problem.assemblers.flatMap((assembler, index) => {
      const recipe = {
        ingredients: Object.keys(assembler.inputPerSecond).map((name) => ({
          resource: resourceId(name),
        })),
        products: Object.keys(assembler.outputPerSecond).map((name) => ({
          resource: resourceId(name),
        })),
      };
      return [
        [assembler.name, recipe],
        [assembler.id ?? `machine-${index + 1}`, recipe],
      ];
    }),
  );
  const rates = Object.assign(
    {},
    ...problem.assemblers.map((assembler) => ({
      ...assembler.inputPerSecond,
      ...assembler.outputPerSecond,
    })),
  ) as ResourceRates;
  const items = Object.fromEntries(
    Object.entries(rates).map(([name, rate]) => [
      resourceId(name),
      { name, rate, colour: colours[name] },
    ]),
  );
  return { recipes, items };
}
